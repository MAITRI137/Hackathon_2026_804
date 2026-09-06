import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';

import { DEMO_ORGANISATION_ID } from '../config/tenant.js';
import { prisma } from '../db/prisma.js';
import { AppError, versionConflict } from '../lib/app-error.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { realtime } from '../realtime/events.js';
import { recordAudit } from '../services/audit.js';
import { notify, notifyEmployee } from '../services/notifications.js';
import { asDate, invalidateComputedPayruns, isoDate } from '../services/payroll-inputs.js';

export const changeRequestRouter = Router();

const idParam = z.object({ id: z.string().min(1) });
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const decision = z.object({
  decision: z.enum(['APPROVED', 'REFUSED']),
  note: z.string().trim().max(500).default(''),
  version: z.number().int().positive(),
});

/** Profile fields an employee may propose a change to. */
const EDITABLE_PROFILE_FIELDS = ['phone', 'email'] as const;

const serializeProfile = (row: {
  id: string;
  employeeId: string;
  field: string;
  currentValue: string;
  proposedValue: string;
  reason: string;
  status: string;
  requestedById: string;
  decidedById: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  version: number;
  createdAt: Date;
}) => ({
  ...row,
  requestedValue: row.proposedValue,
  requestedAt: row.createdAt.toISOString(),
  decidedAt: row.decidedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

const serializeSalary = (row: {
  id: string;
  employeeId: string;
  contractId: string;
  currentWage: Prisma.Decimal;
  proposedWage: Prisma.Decimal;
  effectiveFrom: Date;
  reason: string;
  status: string;
  requestedById: string;
  decidedById: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  version: number;
  createdAt: Date;
}) => ({
  ...row,
  currentWage: row.currentWage.toFixed(2),
  requestedWage: row.proposedWage.toFixed(2),
  proposedWage: row.proposedWage.toFixed(2),
  effectiveFrom: isoDate(row.effectiveFrom),
  decidedAt: row.decidedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/* ── read ────────────────────────────────────────────────────────────────── */

changeRequestRouter.get('/change-requests', requireAuth, async (request, response) => {
  const actor = request.currentUser!;
  const selfOnly = actor.role === 'EMPLOYEE';
  const scope = selfOnly ? { employeeId: actor.employeeId ?? '__none__' } : {};
  const [profile, salary] = await prisma.$transaction([
    prisma.profileChangeRequest.findMany({ where: scope, orderBy: { createdAt: 'desc' }, take: 200 }),
    // A salary change is payroll-confidential: an employee sees only their own,
    // and roles without payroll access see none at all.
    actor.role === 'EMPLOYEE' || actor.role === 'HR_MANAGER'
      ? prisma.salaryChangeRequest.findMany({
          where: { employeeId: actor.employeeId ?? '__none__' },
          orderBy: { createdAt: 'desc' },
          take: 200,
        })
      : prisma.salaryChangeRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
  ]);
  response.locals.recordsRead = profile.length + salary.length;
  response.json({
    data: { profile: profile.map(serializeProfile), salary: salary.map(serializeSalary) },
  });
});

/* ── profile change ──────────────────────────────────────────────────────── */

changeRequestRouter.post('/change-requests/profile', requireAuth, async (request, response) => {
  const input = z
    .object({
      field: z.enum(EDITABLE_PROFILE_FIELDS),
      proposedValue: z.string().trim().min(1).max(200),
      reason: z.string().trim().min(3).max(500),
      employeeId: z.string().min(1).optional(),
    })
    .parse(request.body);
  const actor = request.currentUser!;
  const employeeId = actor.role === 'EMPLOYEE' ? actor.employeeId : (input.employeeId ?? actor.employeeId);
  if (!employeeId) throw new AppError('EMPLOYEE_REQUIRED', 400, 'This account is not linked to an employee record.');

  const created = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee record not found.');
    const currentValue = String(employee[input.field] ?? '');
    if (currentValue === input.proposedValue) {
      throw new AppError('NO_CHANGE', 409, `Your ${input.field} is already ${input.proposedValue}.`);
    }
    const open = await tx.profileChangeRequest.findFirst({
      where: { employeeId, field: input.field, status: 'PENDING' },
    });
    if (open) {
      throw new AppError('REQUEST_PENDING', 409, `A change to your ${input.field} is already awaiting a decision.`);
    }
    const row = await tx.profileChangeRequest.create({
      data: {
        id: `pcr-${randomUUID()}`,
        organisationId: DEMO_ORGANISATION_ID,
        employeeId,
        field: input.field,
        currentValue,
        proposedValue: input.proposedValue,
        reason: input.reason,
        requestedById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: 'PROFILE_CHANGE_REQUESTED',
      entityType: 'ProfileChangeRequest',
      entityId: row.id,
      summary: `${employee.fullName} proposed a ${input.field} change.`,
      before: { [input.field]: currentValue },
      after: { [input.field]: input.proposedValue },
      reason: input.reason,
      correlationId: request.requestId,
    });
    await notify(tx, {
      kind: 'PROFILE_CHANGE_REQUESTED',
      role: 'HR_MANAGER',
      title: 'Profile change awaiting a decision',
      body: `${employee.fullName} proposed a new ${input.field}.`,
      entityType: 'ProfileChangeRequest',
      entityId: row.id,
    });
    return row;
  });

  realtime.publish({ type: 'employee.updated', entityId: created.id, affectedEmployeeIds: [employeeId] });
  response.status(201).json({ data: serializeProfile(created) });
});

changeRequestRouter.post(
  '/change-requests/profile/:id/decide',
  requirePermission('employee.write'),
  async (request, response) => {
    const { id } = idParam.parse(request.params);
    const input = decision.parse(request.body);
    const actor = request.currentUser!;
    if (input.decision === 'REFUSED' && !input.note) {
      throw new AppError('REASON_REQUIRED', 400, 'A short note is required when refusing a request.');
    }

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.profileChangeRequest.findUnique({ where: { id } });
      if (!current) throw new AppError('REQUEST_NOT_FOUND', 404, 'Change request not found.');
      if (current.status !== 'PENDING') {
        throw new AppError('ALREADY_DECIDED', 409, `This request is already ${current.status.toLowerCase()}.`);
      }
      if (current.version !== input.version) throw versionConflict('change request', current.version);

      const changed = await tx.profileChangeRequest.updateMany({
        where: { id, version: input.version, status: 'PENDING' },
        data: {
          status: input.decision,
          decidedById: actor.id,
          decidedAt: new Date(),
          decisionNote: input.note || null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw versionConflict('change request', current.version);

      // Approval is the thing that writes the employee record. The request row
      // is the evidence; the employee row is the effect.
      if (input.decision === 'APPROVED') {
        await tx.employee.update({
          where: { id: current.employeeId },
          data: { [current.field]: current.proposedValue, version: { increment: 1 } },
        });
      }
      await recordAudit(tx, actor, {
        action: input.decision === 'APPROVED' ? 'PROFILE_CHANGE_APPROVED' : 'PROFILE_CHANGE_REFUSED',
        entityType: 'ProfileChangeRequest',
        entityId: id,
        summary: `${current.field} change ${input.decision.toLowerCase()} for ${current.employeeId}.`,
        before: { [current.field]: current.currentValue, status: 'PENDING' },
        after: { [current.field]: input.decision === 'APPROVED' ? current.proposedValue : current.currentValue, status: input.decision },
        reason: input.note || undefined,
        correlationId: request.requestId,
      });
      await notifyEmployee(tx, current.employeeId, {
        kind: 'PROFILE_CHANGE_DECIDED',
        title: `Profile change ${input.decision.toLowerCase()}`,
        body: `Your ${current.field} change was ${input.decision.toLowerCase()}${input.note ? ` — ${input.note}` : ''}.`,
        severity: input.decision === 'APPROVED' ? 'INFO' : 'WARNING',
        entityType: 'ProfileChangeRequest',
        entityId: id,
      });
      return tx.profileChangeRequest.findUniqueOrThrow({ where: { id } });
    });

    realtime.publish({ type: 'employee.updated', entityId: result.employeeId, affectedEmployeeIds: [result.employeeId] });
    response.json({ data: serializeProfile(result) });
  },
);

/* ── salary change ───────────────────────────────────────────────────────── */

changeRequestRouter.post('/change-requests/salary', requirePermission('contract.write'), async (request, response) => {
  const input = z
    .object({
      employeeId: z.string().min(1),
      proposedWage: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
      effectiveFrom: isoDay,
      reason: z.string().trim().min(3).max(500),
    })
    .parse(request.body);
  const actor = request.currentUser!;

  const created = await prisma.$transaction(async (tx) => {
    const contract = await tx.contract.findFirst({
      where: { employeeId: input.employeeId, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
      include: { employee: { select: { fullName: true } } },
    });
    if (!contract) throw new AppError('NO_ACTIVE_CONTRACT', 409, 'This employee has no active contract to change.');
    const open = await tx.salaryChangeRequest.findFirst({
      where: { employeeId: input.employeeId, status: 'PENDING' },
    });
    if (open) throw new AppError('REQUEST_PENDING', 409, 'A salary change for this employee is already pending.');

    const row = await tx.salaryChangeRequest.create({
      data: {
        id: `scr-${randomUUID()}`,
        organisationId: DEMO_ORGANISATION_ID,
        employeeId: input.employeeId,
        contractId: contract.id,
        currentWage: contract.wage,
        proposedWage: input.proposedWage,
        effectiveFrom: asDate(input.effectiveFrom),
        reason: input.reason,
        requestedById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: 'SALARY_CHANGE_REQUESTED',
      entityType: 'SalaryChangeRequest',
      entityId: row.id,
      summary: `${contract.employee.fullName}: ${contract.wage.toFixed(2)} → ${input.proposedWage} from ${input.effectiveFrom}.`,
      before: { wage: contract.wage.toFixed(2) },
      after: { wage: input.proposedWage, effectiveFrom: input.effectiveFrom },
      reason: input.reason,
      correlationId: request.requestId,
    });
    await notify(tx, {
      kind: 'SALARY_CHANGE_REQUESTED',
      role: 'HR_PAYROLL_MANAGER',
      title: 'Salary change awaiting approval',
      body: `${contract.employee.fullName}: ${contract.wage.toFixed(2)} → ${input.proposedWage} from ${input.effectiveFrom}.`,
      severity: 'WARNING',
      entityType: 'SalaryChangeRequest',
      entityId: row.id,
    });
    return row;
  });

  realtime.publish({ type: 'contract.updated', entityId: created.id, affectedEmployeeIds: [created.employeeId] });
  response.status(201).json({ data: serializeSalary(created) });
});

changeRequestRouter.post(
  '/change-requests/salary/:id/decide',
  requirePermission('payrun.validate'),
  async (request, response) => {
    const { id } = idParam.parse(request.params);
    const input = decision.parse(request.body);
    const actor = request.currentUser!;
    if (input.decision === 'REFUSED' && !input.note) {
      throw new AppError('REASON_REQUIRED', 400, 'A short note is required when refusing a request.');
    }

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.salaryChangeRequest.findUnique({ where: { id } });
      if (!current) throw new AppError('REQUEST_NOT_FOUND', 404, 'Change request not found.');
      if (current.status !== 'PENDING') {
        throw new AppError('ALREADY_DECIDED', 409, `This request is already ${current.status.toLowerCase()}.`);
      }
      if (current.version !== input.version) throw versionConflict('change request', current.version);
      // The person who proposed a pay rise may not also approve it.
      if (current.requestedById === actor.id) {
        throw new AppError(
          'SEPARATION_OF_DUTIES',
          403,
          'A salary change must be approved by someone other than the person who proposed it.',
          'Ask another payroll manager to review this request.',
        );
      }

      const changed = await tx.salaryChangeRequest.updateMany({
        where: { id, version: input.version, status: 'PENDING' },
        data: {
          status: input.decision,
          decidedById: actor.id,
          decidedAt: new Date(),
          decisionNote: input.note || null,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw versionConflict('change request', current.version);

      if (input.decision === 'APPROVED') {
        const contract = await tx.contract.findUnique({ where: { id: current.contractId } });
        if (!contract) throw new AppError('CONTRACT_NOT_FOUND', 404, 'The contract behind this request no longer exists.');
        const effective = current.effectiveFrom;
        const closed = new Date(effective.getTime() - 86_400_000);
        // Effective-dated, exactly like a manual contract revision: the old row
        // closes the day before, so history keeps computing on the old wage.
        await tx.contract.update({
          where: { id: contract.id },
          data: { endDate: closed, status: 'EXPIRED', version: { increment: 1 } },
        });
        await tx.contract.create({
          data: {
            id: `ct-${randomUUID()}`,
            contractRef: `${contract.contractRef}-S${contract.version + 1}`,
            employeeId: contract.employeeId,
            startDate: effective,
            endDate: contract.endDate,
            departmentId: contract.departmentId,
            jobPositionId: contract.jobPositionId,
            employeeType: contract.employeeType,
            wage: current.proposedWage,
            salaryStructureId: contract.salaryStructureId,
            workingScheduleId: contract.workingScheduleId,
            status: 'ACTIVE',
            notes: `Salary change approved: ${current.reason}`,
          },
        });
        await invalidateComputedPayruns(tx, [current.employeeId]);
      }

      await recordAudit(tx, actor, {
        action: input.decision === 'APPROVED' ? 'SALARY_CHANGE_APPROVED' : 'SALARY_CHANGE_REFUSED',
        entityType: 'SalaryChangeRequest',
        entityId: id,
        summary: `${current.employeeId}: salary change ${input.decision.toLowerCase()} (${current.currentWage.toFixed(2)} → ${current.proposedWage.toFixed(2)}).`,
        before: { wage: current.currentWage.toFixed(2), status: 'PENDING' },
        after: {
          wage: input.decision === 'APPROVED' ? current.proposedWage.toFixed(2) : current.currentWage.toFixed(2),
          status: input.decision,
        },
        reason: input.note || undefined,
        correlationId: request.requestId,
      });
      await notifyEmployee(tx, current.employeeId, {
        kind: 'SALARY_CHANGE_DECIDED',
        title: `Salary change ${input.decision.toLowerCase()}`,
        body:
          input.decision === 'APPROVED'
            ? `Your new wage takes effect on ${isoDate(current.effectiveFrom)}.`
            : `The proposed change was refused${input.note ? ` — ${input.note}` : ''}.`,
        entityType: 'SalaryChangeRequest',
        entityId: id,
      });
      return tx.salaryChangeRequest.findUniqueOrThrow({ where: { id } });
    });

    realtime.publish({ type: 'contract.updated', entityId: result.employeeId, affectedEmployeeIds: [result.employeeId] });
    response.json({ data: serializeSalary(result) });
  },
);
