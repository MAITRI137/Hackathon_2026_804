import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError, versionConflict } from '../lib/app-error.js';
import { requirePermission } from '../middleware/auth.js';
import { realtime } from '../realtime/events.js';
import { diffFields, recordAudit } from '../services/audit.js';
import { notifyEmployee } from '../services/notifications.js';
import { asDate, invalidateComputedPayruns, isoDate } from '../services/payroll-inputs.js';

export const contractRouter = Router();

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
const idParam = z.object({ id: z.string().min(1) });

const createSchema = z.object({
  employeeId: z.string().min(1),
  startDate: isoDay,
  endDate: isoDay.nullable().default(null),
  departmentId: z.string().min(1),
  jobPositionId: z.string().min(1),
  employeeType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']),
  wage: money,
  salaryStructureId: z.string().min(1),
  workingScheduleId: z.string().min(1),
  notes: z.string().trim().max(500).default(''),
});

const patchSchema = z.object({
  version: z.number().int().positive(),
  /**
   * The date the new terms take effect. Payroll already run for an earlier
   * period must keep computing from the terms that applied then, so a change
   * with an effective date inside a closed period is refused rather than
   * silently rewriting history.
   */
  effectiveFrom: isoDay,
  endDate: isoDay.nullable().optional(),
  jobPositionId: z.string().min(1).optional(),
  employeeType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional(),
  wage: money.optional(),
  salaryStructureId: z.string().min(1).optional(),
  workingScheduleId: z.string().min(1).optional(),
  notes: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(3).max(500),
});

const serialize = (contract: {
  id: string;
  contractRef: string;
  employeeId: string;
  startDate: Date;
  endDate: Date | null;
  departmentId: string;
  jobPositionId: string;
  employeeType: string;
  wage: Prisma.Decimal;
  salaryStructureId: string;
  workingScheduleId: string;
  status: string;
  notes: string;
  version: number;
}) => ({
  ...contract,
  startDate: isoDate(contract.startDate),
  endDate: contract.endDate ? isoDate(contract.endDate) : null,
  wage: contract.wage.toFixed(2),
});

/**
 * Refuse a contract change that would rewrite an already-decided payroll period.
 *
 * The payslip stores the inputs it used, so history stays explainable either
 * way — but a wage edit dated into a paid month would still make the contract
 * screen disagree with the payslip, and disagreement is the thing this product
 * exists to prevent.
 */
async function assertEffectiveDateIsOpen(db: Prisma.TransactionClient, employeeId: string, effectiveFrom: Date) {
  const closed = await db.payrunEmployee.findFirst({
    where: {
      employeeId,
      excludedAt: null,
      payrun: { status: { in: ['VALIDATED', 'PAID'] }, periodEnd: { gte: effectiveFrom } },
    },
    include: { payrun: { select: { name: true, status: true, periodEnd: true } } },
    orderBy: { payrun: { periodEnd: 'desc' } },
  });
  if (closed) {
    throw new AppError(
      'EFFECTIVE_DATE_CLOSED',
      409,
      `${closed.payrun.name} is already ${closed.payrun.status.toLowerCase()} and covers that effective date.`,
      `Use an effective date after ${isoDate(closed.payrun.periodEnd)}, or reopen that payroll run.`,
    );
  }
}

contractRouter.get('/contracts', requirePermission('contract.read.self'), async (request, response) => {
  const query = z
    .object({
      employeeId: z.string().min(1).optional(),
      status: z.string().min(1).optional(),
      take: z.coerce.number().int().min(1).max(500).default(200),
    })
    .parse(request.query);
  const actor = request.currentUser!;
  const selfOnly = actor.role === 'EMPLOYEE';
  const rows = await prisma.contract.findMany({
    where: {
      ...(selfOnly ? { employeeId: actor.employeeId ?? '__none__' } : query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
    },
    orderBy: [{ employeeId: 'asc' }, { startDate: 'desc' }],
    take: query.take,
  });
  response.locals.recordsRead = rows.length;
  response.json({ data: rows.map(serialize) });
});

contractRouter.post('/contracts', requirePermission('contract.write'), async (request, response) => {
  const input = createSchema.parse(request.body);
  const actor = request.currentUser!;
  if (input.endDate && input.endDate < input.startDate) {
    throw new AppError('INVALID_RANGE', 400, 'The end date cannot be before the start date.');
  }

  const created = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: input.employeeId } });
    if (!employee) throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee record not found.');
    await assertEffectiveDateIsOpen(tx, input.employeeId, asDate(input.startDate));

    const overlap = await tx.contract.findFirst({
      where: {
        employeeId: input.employeeId,
        status: 'ACTIVE',
        startDate: { lte: input.endDate ? asDate(input.endDate) : new Date('9999-12-31T00:00:00.000Z') },
        OR: [{ endDate: null }, { endDate: { gte: asDate(input.startDate) } }],
      },
    });
    if (overlap) {
      throw new AppError(
        'CONTRACT_OVERLAP',
        409,
        `${employee.fullName} already has an active contract covering those dates (${overlap.contractRef}).`,
        'End the existing contract first, or move this start date after it.',
      );
    }

    const contract = await tx.contract.create({
      data: {
        id: `ct-${randomUUID()}`,
        contractRef: `CT-${input.employeeId}-${input.startDate.replace(/-/g, '')}`,
        employeeId: input.employeeId,
        startDate: asDate(input.startDate),
        endDate: input.endDate ? asDate(input.endDate) : null,
        departmentId: input.departmentId,
        jobPositionId: input.jobPositionId,
        employeeType: input.employeeType,
        wage: input.wage,
        salaryStructureId: input.salaryStructureId,
        workingScheduleId: input.workingScheduleId,
        status: 'ACTIVE',
        notes: input.notes,
      },
    });
    await invalidateComputedPayruns(tx, [input.employeeId]);
    await recordAudit(tx, actor, {
      action: 'CONTRACT_CREATED',
      entityType: 'Contract',
      entityId: contract.id,
      summary: `${contract.contractRef} created for ${employee.fullName} from ${input.startDate}.`,
      after: { wage: input.wage, startDate: input.startDate, salaryStructureId: input.salaryStructureId },
      correlationId: request.requestId,
    });
    return contract;
  });

  realtime.publish({ type: 'contract.updated', entityId: created.id, affectedEmployeeIds: [created.employeeId] });
  response.status(201).json({ data: serialize(created) });
});

contractRouter.patch('/contracts/:id', requirePermission('contract.write'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const { version, effectiveFrom, reason, ...patch } = patchSchema.parse(request.body);
  const actor = request.currentUser!;

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.contract.findUnique({
      where: { id },
      include: { employee: { select: { fullName: true } } },
    });
    if (!current) throw new AppError('CONTRACT_NOT_FOUND', 404, 'Contract not found.');
    if (current.version !== version) throw versionConflict('contract', current.version);
    if (current.status === 'TERMINATED') {
      throw new AppError('CONTRACT_TERMINATED', 409, 'A terminated contract cannot be edited.');
    }
    await assertEffectiveDateIsOpen(tx, current.employeeId, asDate(effectiveFrom));

    const changesTerms = patch.wage !== undefined || patch.salaryStructureId !== undefined;
    const effective = asDate(effectiveFrom);

    // Terms that change mid-life become a new effective-dated contract; the old
    // row is closed the day before, so a historical payslip still resolves to
    // the contract that produced it.
    if (changesTerms && effective > current.startDate) {
      const closedEnd = new Date(effective.getTime() - 86_400_000);
      await tx.contract.updateMany({
        where: { id, version },
        data: { endDate: closedEnd, status: 'EXPIRED', version: { increment: 1 } },
      });
      const successor = await tx.contract.create({
        data: {
          id: `ct-${randomUUID()}`,
          contractRef: `${current.contractRef}-R${current.version + 1}`,
          employeeId: current.employeeId,
          startDate: effective,
          endDate: patch.endDate === undefined ? current.endDate : patch.endDate ? asDate(patch.endDate) : null,
          departmentId: current.departmentId,
          jobPositionId: patch.jobPositionId ?? current.jobPositionId,
          employeeType: patch.employeeType ?? current.employeeType,
          wage: patch.wage ?? current.wage,
          salaryStructureId: patch.salaryStructureId ?? current.salaryStructureId,
          workingScheduleId: patch.workingScheduleId ?? current.workingScheduleId,
          status: 'ACTIVE',
          notes: patch.notes ?? current.notes,
        },
      });
      await invalidateComputedPayruns(tx, [current.employeeId]);
      await recordAudit(tx, actor, {
        action: 'CONTRACT_REVISED',
        entityType: 'Contract',
        entityId: successor.id,
        summary: `${current.employee.fullName}: new terms from ${effectiveFrom} (${current.contractRef} closed ${isoDate(closedEnd)}).`,
        before: { contractId: current.id, wage: current.wage.toFixed(2), salaryStructureId: current.salaryStructureId },
        after: { contractId: successor.id, wage: successor.wage.toFixed(2), salaryStructureId: successor.salaryStructureId },
        reason,
        correlationId: request.requestId,
      });
      await notifyEmployee(tx, current.employeeId, {
        kind: 'CONTRACT_REVISED',
        title: 'Your contract terms changed',
        body: `New terms take effect on ${effectiveFrom}. ${reason}`,
        entityType: 'Contract',
        entityId: successor.id,
      });
      return successor;
    }

    // A correction to the current period, not a change of terms: edit in place.
    const changed = await tx.contract.updateMany({
      where: { id, version },
      data: {
        ...patch,
        endDate: patch.endDate === undefined ? undefined : patch.endDate ? asDate(patch.endDate) : null,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw versionConflict('contract', current.version);
    await invalidateComputedPayruns(tx, [current.employeeId]);
    const delta = diffFields(
      { ...current, wage: current.wage.toFixed(2) } as unknown as Record<string, unknown>,
      patch,
    );
    await recordAudit(tx, actor, {
      action: 'CONTRACT_UPDATED',
      entityType: 'Contract',
      entityId: id,
      summary: `${current.employee.fullName}: ${Object.keys(delta.after).join(', ') || 'no field'} updated.`,
      before: delta.before,
      after: delta.after,
      reason,
      correlationId: request.requestId,
    });
    return tx.contract.findUniqueOrThrow({ where: { id } });
  });

  realtime.publish({ type: 'contract.updated', entityId: result.id, affectedEmployeeIds: [result.employeeId] });
  response.json({ data: serialize(result) });
});

contractRouter.post('/contracts/:id/terminate', requirePermission('contract.write'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const { endDate, reason, version } = z
    .object({ endDate: isoDay, reason: z.string().trim().min(3).max(500), version: z.number().int().positive() })
    .parse(request.body);
  const actor = request.currentUser!;

  const terminated = await prisma.$transaction(async (tx) => {
    const current = await tx.contract.findUnique({
      where: { id },
      include: { employee: { select: { fullName: true } } },
    });
    if (!current) throw new AppError('CONTRACT_NOT_FOUND', 404, 'Contract not found.');
    if (current.version !== version) throw versionConflict('contract', current.version);
    if (current.status === 'TERMINATED') {
      throw new AppError('CONTRACT_TERMINATED', 409, 'This contract is already terminated.');
    }
    if (endDate < isoDate(current.startDate)) {
      throw new AppError('INVALID_RANGE', 400, 'The end date cannot be before the contract started.');
    }
    await assertEffectiveDateIsOpen(tx, current.employeeId, asDate(endDate));

    const changed = await tx.contract.updateMany({
      where: { id, version },
      data: { status: 'TERMINATED', endDate: asDate(endDate), notes: reason, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw versionConflict('contract', current.version);
    await tx.employee.updateMany({
      where: { id: current.employeeId },
      data: { status: 'NOTICE', exitDate: asDate(endDate), version: { increment: 1 } },
    });
    await invalidateComputedPayruns(tx, [current.employeeId]);
    await recordAudit(tx, actor, {
      action: 'CONTRACT_TERMINATED',
      entityType: 'Contract',
      entityId: id,
      summary: `${current.employee.fullName}: ${current.contractRef} terminated on ${endDate}.`,
      before: { status: current.status, endDate: current.endDate ? isoDate(current.endDate) : null },
      after: { status: 'TERMINATED', endDate },
      reason,
      correlationId: request.requestId,
    });
    return tx.contract.findUniqueOrThrow({ where: { id } });
  });

  realtime.publish({ type: 'contract.updated', entityId: id, affectedEmployeeIds: [terminated.employeeId] });
  response.json({ data: serialize(terminated) });
});
