import { Router } from 'express';
import { z } from 'zod';
import { monthEnd, monthLabel, monthStart } from '@shared/dates.js';

import { DEMO_ORGANISATION_ID } from '../config/tenant.js';
import { prisma } from '../db/prisma.js';
import { AppError, versionConflict } from '../lib/app-error.js';
import { requirePermission } from '../middleware/auth.js';
import { realtime } from '../realtime/events.js';
import { recordAudit } from '../services/audit.js';
import { idempotencyKeyFrom, runOnce } from '../services/idempotency.js';
import { notify } from '../services/notifications.js';
import { asDate, isoDate } from '../services/payroll-inputs.js';
import {
  assertNoBlockingIssues,
  assertStatus,
  evaluatePayrun,
  persistPayslips,
} from '../services/payrun-decision.js';
import { readSettings } from '../services/settings.js';

export const payrunRouter = Router();

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const payrunParams = z.object({ id: z.string().min(1) });
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const versionedReason = reasonSchema.extend({ version: z.number().int().positive() });

const bankInput = z.object({
  employeeId: z.string().min(1),
  accountName: z.string().trim().min(1).max(120),
  accountNumber: z.string().regex(/^\d{9,18}$/),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
  bankName: z.string().trim().min(1).max(120),
});
const attendanceInput = z.object({
  attendanceId: z.string().min(1),
  checkOut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  reason: z.string().trim().min(3).max(500),
});

const receipt = (item: {
  payrunId: string;
  snapshotHash: string;
  readinessScore: number;
  blockingExceptionCount: number;
  employeeCount: number;
  netTotal: { toFixed: (digits: number) => string };
  preparedById: string;
  preparedByName: string;
  preparedAt: Date;
  validatedById: string | null;
  validatedByName: string | null;
  validatedAt: Date | null;
  paidById: string | null;
  paidByName: string | null;
  paidAt: Date | null;
}) => ({
  payrunId: item.payrunId,
  status: item.paidAt ? 'PAID' : 'VALIDATED',
  snapshotHash: item.snapshotHash,
  readinessScore: item.readinessScore,
  blockingExceptionCount: item.blockingExceptionCount,
  employeeCount: item.employeeCount,
  netTotal: item.netTotal.toFixed(2),
  preparedById: item.preparedById,
  preparedByName: item.preparedByName,
  preparedAt: item.preparedAt.toISOString(),
  validatedById: item.validatedById,
  validatedByName: item.validatedByName,
  validatedAt: item.validatedAt?.toISOString() ?? null,
  paidById: item.paidById,
  paidByName: item.paidByName,
  paidAt: item.paidAt?.toISOString() ?? null,
});

const payrunView = (payrun: {
  id: string;
  name: string;
  periodStart: Date;
  periodEnd: Date;
  salaryStructureId: string;
  status: string;
  isFrozen: boolean;
  frozenAt: Date | null;
  reopenReason: string | null;
  expectedWorkDays: number;
  computedAt: Date | null;
  validatedAt: Date | null;
  paidAt: Date | null;
  inputSnapshotHash: string | null;
  createdById: string;
  version: number;
  employees?: { employeeId: string; excludedAt: Date | null }[];
}) => ({
  id: payrun.id,
  name: payrun.name,
  periodStart: isoDate(payrun.periodStart),
  periodEnd: isoDate(payrun.periodEnd),
  salaryStructureId: payrun.salaryStructureId,
  status: payrun.status,
  isFrozen: payrun.isFrozen,
  frozenAt: payrun.frozenAt?.toISOString() ?? null,
  reopenReason: payrun.reopenReason,
  expectedWorkDays: payrun.expectedWorkDays,
  computedAt: payrun.computedAt?.toISOString() ?? null,
  validatedAt: payrun.validatedAt?.toISOString() ?? null,
  paidAt: payrun.paidAt?.toISOString() ?? null,
  inputSnapshotHash: payrun.inputSnapshotHash,
  createdById: payrun.createdById,
  version: payrun.version,
  employeeIds: (payrun.employees ?? []).filter((row) => !row.excludedAt).map((row) => row.employeeId),
});

/** A payrun whose inputs are frozen or already decided refuses input edits. */
function assertInputsOpen(payrun: { status: string; isFrozen: boolean; name: string }) {
  if (payrun.status === 'VALIDATED' || payrun.status === 'PAID') {
    throw new AppError(
      'PAYRUN_LOCKED',
      409,
      `${payrun.name} is ${payrun.status.toLowerCase()}; its inputs are locked.`,
      'Reopen the payroll run before changing an input it was decided on.',
    );
  }
  if (payrun.isFrozen) {
    throw new AppError(
      'PAYRUN_FROZEN',
      409,
      `${payrun.name} is frozen for the input cutoff.`,
      'Unfreeze the run to make further input changes.',
    );
  }
}

/* ── setup ───────────────────────────────────────────────────────────────── */

payrunRouter.post('/payruns', requirePermission('payrun.create'), async (request, response) => {
  const input = z
    .object({
      periodStart: isoDay,
      salaryStructureId: z.string().min(1),
      includeAllActive: z.boolean().default(true),
    })
    .parse(request.body);
  const actor = request.currentUser!;
  const start = monthStart(input.periodStart);
  const end = monthEnd(input.periodStart);

  const created = await prisma.$transaction(async (tx) => {
    const structure = await tx.salaryStructure.findUnique({ where: { id: input.salaryStructureId } });
    if (!structure) throw new AppError('STRUCTURE_NOT_FOUND', 404, 'That salary structure no longer exists.');
    const clash = await tx.payrun.findUnique({
      where: { periodStart_salaryStructureId: { periodStart: asDate(start), salaryStructureId: structure.id } },
    });
    if (clash) {
      throw new AppError(
        'PAYRUN_EXISTS',
        409,
        `${clash.name} already exists for this structure.`,
        'Open the existing period instead of creating a second one.',
      );
    }

    const holidays = await tx.holiday.findMany({ where: { date: { gte: asDate(start), lte: asDate(end) } } });
    const members = input.includeAllActive
      ? await tx.employee.findMany({
          where: {
            organisationId: DEMO_ORGANISATION_ID,
            status: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
            joinDate: { lte: asDate(end) },
          },
          select: { id: true },
        })
      : [];

    const payrun = await tx.payrun.create({
      data: {
        id: `pr-${start.slice(0, 7)}-${structure.code.toLowerCase()}`,
        organisationId: DEMO_ORGANISATION_ID,
        name: `${monthLabel(start)} payroll`,
        periodStart: asDate(start),
        periodEnd: asDate(end),
        salaryStructureId: structure.id,
        status: 'DRAFT',
        expectedWorkDays: 22 - holidays.length,
        createdById: actor.id,
        employees: { create: members.map((member) => ({ employeeId: member.id })) },
      },
      include: { employees: true },
    });
    await recordAudit(tx, actor, {
      action: 'PAYRUN_CREATED',
      entityType: 'Payrun',
      entityId: payrun.id,
      summary: `${payrun.name} created with ${members.length} employee${members.length === 1 ? '' : 's'}.`,
      after: { periodStart: start, periodEnd: end, members: members.length },
      correlationId: request.requestId,
    });
    return payrun;
  });

  realtime.publish({ type: 'payroll.updated', entityId: created.id, affectedEmployeeIds: [] });
  response.status(201).json({ data: payrunView(created) });
});

payrunRouter.post('/payruns/:id/clone', requirePermission('payrun.create'), async (request, response) => {
  const { id } = payrunParams.parse(request.params);
  const actor = request.currentUser!;

  const created = await prisma.$transaction(async (tx) => {
    const source = await tx.payrun.findUnique({ where: { id }, include: { employees: { where: { excludedAt: null } } } });
    if (!source) throw new AppError('PAYRUN_NOT_FOUND', 404, 'Payroll period not found.');
    const nextStart = monthStart(
      isoDate(new Date(source.periodEnd.getTime() + 86_400_000)),
    );
    const nextEnd = monthEnd(nextStart);
    const clash = await tx.payrun.findUnique({
      where: {
        periodStart_salaryStructureId: { periodStart: asDate(nextStart), salaryStructureId: source.salaryStructureId },
      },
    });
    if (clash) {
      throw new AppError('PAYRUN_EXISTS', 409, `${clash.name} already exists.`, 'Open that period instead.');
    }

    // Cloning carries the membership forward but drops anyone who has since
    // left, so a leaver is never silently paid a second month.
    const stillEmployed = await tx.employee.findMany({
      where: {
        id: { in: source.employees.map((row) => row.employeeId) },
        status: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
      },
      select: { id: true },
    });
    const holidays = await tx.holiday.findMany({
      where: { date: { gte: asDate(nextStart), lte: asDate(nextEnd) } },
    });
    const payrun = await tx.payrun.create({
      data: {
        id: `pr-${nextStart.slice(0, 7)}-clone`,
        organisationId: DEMO_ORGANISATION_ID,
        name: `${monthLabel(nextStart)} payroll`,
        periodStart: asDate(nextStart),
        periodEnd: asDate(nextEnd),
        salaryStructureId: source.salaryStructureId,
        status: 'DRAFT',
        expectedWorkDays: 22 - holidays.length,
        createdById: actor.id,
        employees: { create: stillEmployed.map((member) => ({ employeeId: member.id })) },
      },
      include: { employees: true },
    });
    await recordAudit(tx, actor, {
      action: 'PAYRUN_CLONED',
      entityType: 'Payrun',
      entityId: payrun.id,
      summary: `${payrun.name} cloned from ${source.name} with ${stillEmployed.length} of ${source.employees.length} employees.`,
      before: { sourcePayrunId: source.id, members: source.employees.length },
      after: { members: stillEmployed.length },
      correlationId: request.requestId,
    });
    return payrun;
  });

  realtime.publish({ type: 'payroll.updated', entityId: created.id, affectedEmployeeIds: [] });
  response.status(201).json({ data: payrunView(created) });
});

payrunRouter.post('/payruns/:id/membership', requirePermission('payrun.create'), async (request, response) => {
  const { id } = payrunParams.parse(request.params);
  const input = z
    .object({
      employeeIds: z.array(z.string().min(1)).min(1).max(500),
      include: z.boolean(),
      reason: z.string().trim().max(500).default(''),
    })
    .parse(request.body);
  const actor = request.currentUser!;

  const changed = await prisma.$transaction(async (tx) => {
    const payrun = await tx.payrun.findUnique({ where: { id } });
    if (!payrun) throw new AppError('PAYRUN_NOT_FOUND', 404, 'Payroll period not found.');
    assertInputsOpen(payrun);
    if (!input.include && !input.reason) {
      throw new AppError('REASON_REQUIRED', 400, 'A reason is required when removing someone from payroll.');
    }

    for (const employeeId of input.employeeIds) {
      if (input.include) {
        await tx.payrunEmployee.upsert({
          where: { payrunId_employeeId: { payrunId: id, employeeId } },
          create: { payrunId: id, employeeId },
          update: { excludedAt: null, exclusionReason: null },
        });
      } else {
        await tx.payrunEmployee.updateMany({
          where: { payrunId: id, employeeId },
          data: { excludedAt: new Date(), exclusionReason: input.reason },
        });
      }
    }

    // Membership is an input: changing it invalidates a computed result.
    if (payrun.status === 'COMPUTED') {
      await tx.payrun.update({
        where: { id },
        data: { status: 'DRAFT', computedAt: null, inputSnapshotHash: null, version: { increment: 1 } },
      });
    }
    await recordAudit(tx, actor, {
      action: input.include ? 'PAYRUN_MEMBER_ADDED' : 'PAYRUN_MEMBER_REMOVED',
      entityType: 'Payrun',
      entityId: id,
      summary: `${input.employeeIds.length} employee${input.employeeIds.length === 1 ? '' : 's'} ${input.include ? 'added to' : 'removed from'} ${payrun.name}.`,
      after: { employeeIds: input.employeeIds, include: input.include },
      reason: input.reason || undefined,
      correlationId: request.requestId,
    });
    return input.employeeIds.length;
  });

  realtime.publish({ type: 'payroll.updated', entityId: id, affectedEmployeeIds: input.employeeIds });
  response.json({ data: { changed } });
});

payrunRouter.post('/payruns/:id/freeze', requirePermission('payrun.freeze'), async (request, response) => {
  const { id } = payrunParams.parse(request.params);
  const input = z.object({ frozen: z.boolean(), reason: z.string().trim().max(500).default('') }).parse(request.body);
  const actor = request.currentUser!;

  const updated = await prisma.$transaction(async (tx) => {
    const payrun = await tx.payrun.findUnique({ where: { id } });
    if (!payrun) throw new AppError('PAYRUN_NOT_FOUND', 404, 'Payroll period not found.');
    if (payrun.isFrozen === input.frozen) {
      throw new AppError('NO_CHANGE', 409, `${payrun.name} is already ${input.frozen ? 'frozen' : 'unfrozen'}.`);
    }
    const now = new Date();
    await tx.payrun.update({
      where: { id },
      data: { isFrozen: input.frozen, frozenAt: input.frozen ? now : null, version: { increment: 1 } },
    });
    await recordAudit(tx, actor, {
      action: input.frozen ? 'PAYRUN_FROZEN' : 'PAYRUN_UNFROZEN',
      entityType: 'Payrun',
      entityId: id,
      summary: `${payrun.name} ${input.frozen ? 'frozen for the input cutoff' : 'unfrozen for input changes'}.`,
      before: { isFrozen: payrun.isFrozen },
      after: { isFrozen: input.frozen },
      reason: input.reason || undefined,
      correlationId: request.requestId,
    });
    return tx.payrun.findUniqueOrThrow({ where: { id }, include: { employees: true } });
  });

  realtime.publish({ type: 'payroll.updated', entityId: id, affectedEmployeeIds: [] });
  response.json({ data: payrunView(updated) });
});

payrunRouter.post('/payruns/:id/reopen', requirePermission('payrun.reopen'), async (request, response) => {
  const { id } = payrunParams.parse(request.params);
  const { reason, version } = versionedReason.parse(request.body);
  const actor = request.currentUser!;

  const updated = await prisma.$transaction(async (tx) => {
    const payrun = await tx.payrun.findUnique({ where: { id } });
    if (!payrun) throw new AppError('PAYRUN_NOT_FOUND', 404, 'Payroll period not found.');
    if (payrun.version !== version) throw versionConflict('payroll run', payrun.version);
    if (payrun.status !== 'VALIDATED' && payrun.status !== 'PAID') {
      throw new AppError('INVALID_PAYRUN_STATE', 409, 'Only a validated or paid run can be reopened.');
    }
    const settings = await readSettings(tx);
    if (settings.requireReopenReason && reason.length < 10) {
      throw new AppError(
        'REASON_REQUIRED',
        400,
        'Policy requires a substantive reason to reopen a decided payroll run.',
        'Describe what changed and why the decision must be revisited.',
      );
    }

    const changed = await tx.payrun.updateMany({
      where: { id, version },
      data: {
        status: 'DRAFT',
        computedAt: null,
        validatedAt: null,
        paidAt: null,
        inputSnapshotHash: null,
        isFrozen: false,
        frozenAt: null,
        reopenReason: reason,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw versionConflict('payroll run', payrun.version);
    await tx.payslip.updateMany({ where: { payrunId: id }, data: { status: 'DRAFT' } });
    // The decision receipt is evidence of what was approved and is never
    // deleted by a reopen; the next validation writes a new snapshot beside it.
    await recordAudit(tx, actor, {
      action: 'PAYRUN_REOPENED',
      entityType: 'Payrun',
      entityId: id,
      summary: `${payrun.name} reopened from ${payrun.status.toLowerCase()}.`,
      before: { status: payrun.status },
      after: { status: 'DRAFT' },
      reason,
      correlationId: request.requestId,
    });
    await notify(tx, {
      kind: 'PAYRUN_REOPENED',
      role: 'HR_PAYROLL_MANAGER',
      title: `${payrun.name} was reopened`,
      body: reason,
      severity: 'WARNING',
      entityType: 'Payrun',
      entityId: id,
    });
    return tx.payrun.findUniqueOrThrow({ where: { id }, include: { employees: true } });
  });

  realtime.publish({ type: 'payroll.updated', entityId: id, affectedEmployeeIds: [] });
  response.json({ data: payrunView(updated) });
});

/* ── lifecycle ───────────────────────────────────────────────────────────── */

payrunRouter.post('/payruns/:id/compute', requirePermission('payrun.compute'), async (request, response) => {
  const { id } = payrunParams.parse(request.params);
  const actor = request.currentUser!;

  const outcome = await runOnce('payrun.compute', idempotencyKeyFrom(request), actor.id, { id }, async () =>
    prisma.$transaction(
      async (tx) => {
        const evaluation = await evaluatePayrun(tx, id);
        if (!['DRAFT', 'COMPUTED'].includes(evaluation.payrun.status)) {
          throw new AppError('INVALID_PAYRUN_STATE', 409, 'Paid or validated payroll cannot be recomputed.');
        }
        const payslips = await persistPayslips(tx, evaluation);
        const updated = await tx.payrun.update({
          where: { id },
          data: {
            status: 'COMPUTED',
            computedAt: new Date(),
            inputSnapshotHash: evaluation.snapshotHash,
            version: { increment: 1 },
          },
        });
        await recordAudit(tx, actor, {
          action: 'PAYRUN_COMPUTED',
          entityType: 'Payrun',
          entityId: id,
          summary: `${updated.name} computed: ${payslips} payslip${payslips === 1 ? '' : 's'}, readiness ${evaluation.readinessScore}%.`,
          after: {
            snapshotHash: evaluation.snapshotHash,
            payslips,
            readinessScore: evaluation.readinessScore,
            netTotal: evaluation.netTotal,
          },
          correlationId: request.requestId,
        });
        return {
          payrunId: updated.id,
          status: updated.status,
          version: updated.version,
          snapshotHash: evaluation.snapshotHash,
          readinessScore: evaluation.readinessScore,
          blockingExceptionCount: evaluation.issues.length,
          employeeCount: evaluation.computedCount,
          memberCount: evaluation.memberCount,
          payslipCount: payslips,
          netTotal: evaluation.netTotal,
        };
      },
      { timeout: 120_000, maxWait: 20_000 },
    ),
  );

  if (!outcome.replayed) {
    realtime.publish({ type: 'payroll.computed', entityId: id, affectedEmployeeIds: [] });
    realtime.publish({ type: 'payslip.updated', entityId: id, affectedEmployeeIds: [] });
  }
  response.json({ data: outcome.value });
});

payrunRouter.post('/payruns/:id/validate', requirePermission('payrun.validate'), async (request, response) => {
  const { id } = payrunParams.parse(request.params);
  const actor = request.currentUser!;

  const outcome = await runOnce('payrun.validate', idempotencyKeyFrom(request), actor.id, { id }, async () =>
    prisma.$transaction(
      async (tx) => {
        const evaluation = await evaluatePayrun(tx, id);
        assertStatus(evaluation.payrun, 'COMPUTED');
        assertNoBlockingIssues(evaluation);
        if (evaluation.payrun.inputSnapshotHash !== evaluation.snapshotHash) {
          throw new AppError(
            'PAYRUN_INPUTS_CHANGED',
            409,
            'Payroll inputs changed since the last compute.',
            'Recompute this payroll run before validating it.',
          );
        }
        const now = new Date();
        await tx.payrun.update({
          where: { id },
          data: { status: 'VALIDATED', validatedAt: now, version: { increment: 1 } },
        });
        await tx.payslip.updateMany({ where: { payrunId: id, status: 'COMPUTED' }, data: { status: 'VALIDATED' } });
        const item = await tx.payrollDecisionReceipt.upsert({
          where: { payrunId: id },
          create: {
            payrunId: id,
            snapshotHash: evaluation.snapshotHash,
            readinessScore: evaluation.readinessScore,
            blockingExceptionCount: 0,
            employeeCount: evaluation.computedCount,
            netTotal: evaluation.netTotal,
            preparedById: evaluation.payrun.createdById,
            preparedByName: actor.displayName,
            preparedAt: evaluation.payrun.computedAt ?? now,
            validatedById: actor.id,
            validatedByName: actor.displayName,
            validatedAt: now,
          },
          update: {
            snapshotHash: evaluation.snapshotHash,
            readinessScore: evaluation.readinessScore,
            blockingExceptionCount: 0,
            employeeCount: evaluation.computedCount,
            netTotal: evaluation.netTotal,
            validatedById: actor.id,
            validatedByName: actor.displayName,
            validatedAt: now,
          },
        });
        await recordAudit(tx, actor, {
          action: 'PAYRUN_VALIDATED',
          entityType: 'Payrun',
          entityId: id,
          summary: `${evaluation.payrun.name} validated: ${evaluation.computedCount} payslips, ${evaluation.netTotal} net, 100% ready.`,
          before: { status: 'COMPUTED' },
          after: { status: 'VALIDATED', snapshotHash: evaluation.snapshotHash, netTotal: evaluation.netTotal },
          correlationId: request.requestId,
        });
        return { receipt: receipt(item) };
      },
      { timeout: 120_000, maxWait: 20_000 },
    ),
  );

  if (!outcome.replayed) realtime.publish({ type: 'payroll.validated', entityId: id, affectedEmployeeIds: [] });
  response.json({ data: outcome.value });
});

payrunRouter.post('/payruns/:id/mark-paid', requirePermission('payrun.pay'), async (request, response) => {
  const { id } = payrunParams.parse(request.params);
  const actor = request.currentUser!;

  const outcome = await runOnce('payrun.pay', idempotencyKeyFrom(request), actor.id, { id }, async () =>
    prisma.$transaction(
      async (tx) => {
        const evaluation = await evaluatePayrun(tx, id);
        assertStatus(evaluation.payrun, 'VALIDATED');
        assertNoBlockingIssues(evaluation);
        const existing = await tx.payrollDecisionReceipt.findUnique({ where: { payrunId: id } });
        if (!existing || existing.snapshotHash !== evaluation.snapshotHash) {
          throw new AppError(
            'PAYRUN_INPUTS_CHANGED',
            409,
            'The validated evidence is no longer current.',
            'Recompute and validate before marking this run paid.',
          );
        }
        const now = new Date();
        await tx.payrun.update({
          where: { id },
          data: { status: 'PAID', paidAt: now, isFrozen: true, frozenAt: now, version: { increment: 1 } },
        });
        await tx.payslip.updateMany({
          where: { payrunId: id, status: 'VALIDATED' },
          data: { status: 'PAID', paymentStatus: 'PAID' },
        });
        const item = await tx.payrollDecisionReceipt.update({
          where: { payrunId: id },
          data: { paidById: actor.id, paidByName: actor.displayName, paidAt: now },
        });
        await recordAudit(tx, actor, {
          action: 'PAYRUN_PAID',
          entityType: 'Payrun',
          entityId: id,
          summary: `${evaluation.payrun.name} marked paid in demo mode; no funds were transferred.`,
          before: { status: 'VALIDATED' },
          after: { status: 'PAID', netTotal: evaluation.netTotal, demoMode: true },
          correlationId: request.requestId,
        });
        await notify(tx, {
          kind: 'PAYRUN_PAID',
          role: 'HR_PAYROLL_USER',
          title: `${evaluation.payrun.name} marked paid`,
          body: 'Internal payroll marked paid in demo mode — no funds were transferred.',
          entityType: 'Payrun',
          entityId: id,
        });
        return { receipt: receipt(item) };
      },
      { timeout: 120_000, maxWait: 20_000 },
    ),
  );

  if (!outcome.replayed) {
    realtime.publish({ type: 'payroll.paid', entityId: id, affectedEmployeeIds: [] });
    realtime.publish({ type: 'payslip.updated', entityId: id, affectedEmployeeIds: [] });
  }
  response.json({ data: outcome.value });
});

/* ── blocker resolution ──────────────────────────────────────────────────── */

payrunRouter.post(
  '/payruns/:id/blockers/bank/resolve',
  requirePermission('payrun.validate'),
  async (request, response) => {
    const { id } = payrunParams.parse(request.params);
    const input = bankInput.parse(request.body);
    const actor = request.currentUser!;
    await prisma.$transaction(async (tx) => {
      const payrun = await tx.payrun.findUnique({ where: { id } });
      if (!payrun) throw new AppError('PAYRUN_NOT_FOUND', 404, 'Payroll period not found.');
      assertInputsOpen(payrun);
      const member = await tx.payrunEmployee.findUnique({
        where: { payrunId_employeeId: { payrunId: id, employeeId: input.employeeId } },
      });
      if (!member || member.excludedAt) {
        throw new AppError('EMPLOYEE_NOT_IN_PAYRUN', 409, 'This employee is not included in the payroll run.');
      }
      // Only the masked tail is stored. The product never holds a number that
      // could move money, which is also why the bank advice export is a demo.
      const masked = `••••${input.accountNumber.slice(-4)}`;
      const details = {
        accountName: input.accountName,
        accountNumberMasked: masked,
        ifsc: input.ifsc,
        bankName: input.bankName,
        verifiedAt: new Date(),
      };
      await tx.employeeBankDetail.upsert({
        where: { employeeId: input.employeeId },
        create: { employeeId: input.employeeId, ...details },
        update: details,
      });
      await recordAudit(tx, actor, {
        action: 'BANK_VERIFIED',
        entityType: 'Employee',
        entityId: input.employeeId,
        summary: `Bank details saved and verified for payroll (${input.bankName}, ${masked}).`,
        after: { bankName: input.bankName, accountNumberMasked: masked, ifsc: input.ifsc },
        correlationId: request.requestId,
      });
    });
    realtime.publish({ type: 'employee.updated', entityId: input.employeeId, affectedEmployeeIds: [input.employeeId] });
    response.json({ data: { payrunId: id, employeeId: input.employeeId, resolved: 'MISSING_BANK' } });
  },
);

payrunRouter.post(
  '/payruns/:id/blockers/attendance/resolve',
  requirePermission('attendance.correct'),
  async (request, response) => {
    const { id } = payrunParams.parse(request.params);
    const input = attendanceInput.parse(request.body);
    const actor = request.currentUser!;
    const employeeId = await prisma.$transaction(async (tx) => {
      const [payrun, attendance] = await Promise.all([
        tx.payrun.findUnique({ where: { id } }),
        tx.attendance.findUnique({ where: { id: input.attendanceId } }),
      ]);
      if (!payrun) throw new AppError('PAYRUN_NOT_FOUND', 404, 'Payroll period not found.');
      if (!attendance) throw new AppError('ATTENDANCE_NOT_FOUND', 404, 'Attendance record not found.');
      assertInputsOpen(payrun);
      const member = await tx.payrunEmployee.findUnique({
        where: { payrunId_employeeId: { payrunId: id, employeeId: attendance.employeeId } },
      });
      if (!member || member.excludedAt || !attendance.checkIn) {
        throw new AppError('ATTENDANCE_NOT_ELIGIBLE', 409, 'This attendance record cannot resolve this payroll run.');
      }
      const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
      if (minutes(input.checkOut) <= minutes(attendance.checkIn)) {
        throw new AppError('INVALID_CHECKOUT', 400, 'Checkout must be after check-in.');
      }
      // The break comes from the schedule the person actually works, so a
      // six-hour shift is not silently charged a full lunch break.
      const employee = await tx.employee.findUniqueOrThrow({
        where: { id: attendance.employeeId },
        include: { workingSchedule: { include: { lines: true } } },
      });
      const breakMinutes =
        employee.workingSchedule.lines.find((line) => line.dayOfWeek === attendance.date.getUTCDay())?.breakMinutes ?? 0;
      const workedMinutes = minutes(input.checkOut) - minutes(attendance.checkIn) - breakMinutes;
      if (workedMinutes < 0) {
        throw new AppError('INVALID_ATTENDANCE_DURATION', 400, 'Those times are shorter than the scheduled break.');
      }
      await tx.attendance.update({
        where: { id: attendance.id },
        data: {
          checkOut: input.checkOut,
          workedMinutes,
          status: 'PRESENT',
          source: 'MANAGER',
          correctionReason: input.reason,
          correctedById: actor.id,
          correctedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await recordAudit(tx, actor, {
        action: 'ATTENDANCE_CORRECTED',
        entityType: 'Attendance',
        entityId: attendance.id,
        summary: `Checkout set to ${input.checkOut}; ${workedMinutes} worked minutes.`,
        before: { checkOut: attendance.checkOut, workedMinutes: attendance.workedMinutes },
        after: { checkOut: input.checkOut, workedMinutes },
        reason: input.reason,
        correlationId: request.requestId,
      });
      return attendance.employeeId;
    });
    realtime.publish({ type: 'attendance.updated', entityId: input.attendanceId, affectedEmployeeIds: [employeeId] });
    response.json({ data: { payrunId: id, attendanceId: input.attendanceId, resolved: 'MISSING_CHECKOUT' } });
  },
);
