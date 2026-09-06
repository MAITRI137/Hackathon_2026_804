import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';

import type { User } from '@shared/types.js';

import { prisma } from '../db/prisma.js';
import { AppError } from '../lib/app-error.js';
import { requirePermission } from '../middleware/auth.js';
import { realtime } from '../realtime/events.js';
import { recordAudit } from '../services/audit.js';
import { notify, notifyEmployee } from '../services/notifications.js';
import {
  asDate,
  countLeaveDays,
  invalidateComputedPayruns,
  isoDate,
  workingDaysFor,
} from '../services/payroll-inputs.js';
import { readSettings } from '../services/settings.js';

export const leaveRouter = Router();

type DecisionActor = User;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idParam = z.object({ id: z.string().min(1) });

const requestSchema = z.object({
  employeeId: z.string().min(1).optional(),
  leaveTypeId: z.string().min(1),
  fromDate: isoDay,
  toDate: isoDay,
  halfDayStart: z.boolean().default(false),
  halfDayEnd: z.boolean().default(false),
  reason: z.string().trim().min(3).max(500),
});

const decisionSchema = z.object({
  note: z.string().trim().max(500).default(''),
  version: z.number().int().positive().optional(),
});

const grantSchema = z.object({
  employeeIds: z.array(z.string().min(1)).min(1).max(500),
  leaveTypeId: z.string().min(1),
  days: z.number().positive().max(365),
  validFrom: isoDay,
  validTo: isoDay,
});

function serialize(request: {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  fromDate: Date;
  toDate: Date;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  days: Prisma.Decimal;
  reason: string;
  status: string;
  approverId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  autoDecidedBy: string | null;
  createdAt: Date;
}) {
  return {
    ...request,
    fromDate: isoDate(request.fromDate),
    toDate: isoDate(request.toDate),
    days: Number(request.days),
    decidedAt: request.decidedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
  };
}

/**
 * Consume allocation balance under a version guard.
 *
 * Two approvers clicking Approve on two requests at the same moment must not
 * both see the same remaining balance. The conditional update means the second
 * writer sees zero rows changed and is told the balance moved, rather than
 * silently overdrawing the allocation.
 */
async function consumeAllocation(
  db: Prisma.TransactionClient,
  employeeId: string,
  leaveTypeId: string,
  days: number,
  from: Date,
  to: Date,
) {
  const type = await db.leaveType.findUnique({ where: { id: leaveTypeId } });
  if (!type) throw new AppError('LEAVE_TYPE_NOT_FOUND', 404, 'Leave type not found.');
  if (!type.requiresAllocation) return null;

  const allocation = await db.leaveAllocation.findFirst({
    where: { employeeId, leaveTypeId, validFrom: { lte: from }, validTo: { gte: to } },
    orderBy: { validFrom: 'desc' },
  });
  if (!allocation) {
    throw new AppError(
      'NO_ALLOCATION',
      409,
      `No ${type.name} allocation covers those dates.`,
      'Grant an allocation for this period, then decide the request again.',
    );
  }

  const capacity = Number(allocation.allocated) + Number(allocation.carriedForward);
  const used = Number(allocation.used);
  if (!type.allowNegativeBalance && used + days > capacity) {
    const remaining = Math.max(0, capacity - used);
    throw new AppError(
      'ALLOCATION_EXHAUSTED',
      409,
      `Only ${remaining} day${remaining === 1 ? '' : 's'} of ${type.name} remain; this request needs ${days}.`,
      'Grant more allocation or refuse the request.',
    );
  }

  const changed = await db.leaveAllocation.updateMany({
    where: { id: allocation.id, used: allocation.used },
    data: { used: { increment: days } },
  });
  if (changed.count !== 1) {
    throw new AppError(
      'VERSION_CONFLICT',
      409,
      'This leave balance changed while the decision was being made.',
      'Reload the request and decide again against the current balance.',
    );
  }
  return allocation.id;
}

async function releaseAllocation(
  db: Prisma.TransactionClient,
  employeeId: string,
  leaveTypeId: string,
  days: number,
  from: Date,
  to: Date,
) {
  const allocation = await db.leaveAllocation.findFirst({
    where: { employeeId, leaveTypeId, validFrom: { lte: from }, validTo: { gte: to } },
    orderBy: { validFrom: 'desc' },
  });
  if (!allocation) return;
  const next = Math.max(0, Number(allocation.used) - days);
  await db.leaveAllocation.update({ where: { id: allocation.id }, data: { used: next } });
}

/* ── request ─────────────────────────────────────────────────────────────── */

leaveRouter.post('/leave-requests', requirePermission('timeoff.request.self'), async (request, response) => {
  const input = requestSchema.parse(request.body);
  const actor = request.currentUser!;
  const canActForOthers = actor.role !== 'EMPLOYEE';
  const employeeId = canActForOthers ? (input.employeeId ?? actor.employeeId) : actor.employeeId;
  if (!employeeId) {
    throw new AppError('SELF_SCOPE_REQUIRED', 403, 'This account is not linked to an employee record.');
  }
  if (!canActForOthers && input.employeeId && input.employeeId !== actor.employeeId) {
    throw new AppError('SELF_SCOPE_REQUIRED', 403, 'You can only request leave for yourself.');
  }
  if (input.toDate < input.fromDate) {
    throw new AppError('INVALID_RANGE', 400, 'The end date cannot be before the start date.');
  }

  const from = asDate(input.fromDate);
  const to = asDate(input.toDate);

  const created = await prisma.$transaction(async (tx) => {
    const [type, settings, working] = await Promise.all([
      tx.leaveType.findUnique({ where: { id: input.leaveTypeId } }),
      readSettings(tx),
      workingDaysFor(tx, employeeId, from, to),
    ]);
    if (!type) throw new AppError('LEAVE_TYPE_NOT_FOUND', 404, 'Leave type not found.');

    const clash = await tx.leaveRequest.findFirst({
      where: {
        employeeId,
        status: { in: ['PENDING', 'APPROVED'] },
        fromDate: { lte: to },
        toDate: { gte: from },
      },
    });
    if (clash) {
      throw new AppError(
        'LEAVE_OVERLAP',
        409,
        `A ${clash.status.toLowerCase()} request already covers ${isoDate(clash.fromDate)} to ${isoDate(clash.toDate)}.`,
        'Cancel the overlapping request first.',
      );
    }

    const days = countLeaveDays(input.fromDate, input.toDate, input.halfDayStart, input.halfDayEnd, working);
    if (days <= 0) {
      throw new AppError('NO_WORKING_DAYS', 400, 'That range contains no working days for this employee.');
    }

    // Auto-approval only exists because a stored policy switched it on. It is
    // deterministic, recorded as a decision by policy rather than by a person,
    // and consumes balance through the same guarded path a human approval uses.
    const autoApprove = settings.autoApproveShortSickLeave && type.code === 'SICK' && days <= 1;
    if (autoApprove) await consumeAllocation(tx, employeeId, type.id, days, from, to);

    const now = new Date();
    const record = await tx.leaveRequest.create({
      data: {
        id: `LR-${randomUUID()}`,
        employeeId,
        leaveTypeId: type.id,
        fromDate: from,
        toDate: to,
        halfDayStart: input.halfDayStart,
        halfDayEnd: input.halfDayEnd,
        days,
        reason: input.reason,
        status: autoApprove ? 'APPROVED' : 'PENDING',
        decidedAt: autoApprove ? now : null,
        autoDecidedBy: autoApprove ? 'Short sick leave auto-approval policy' : null,
        createdAt: now,
      },
    });

    if (autoApprove) await invalidateComputedPayruns(tx, [employeeId]);

    await recordAudit(tx, actor, {
      action: autoApprove ? 'LEAVE_AUTO_APPROVED' : 'LEAVE_REQUESTED',
      entityType: 'LeaveRequest',
      entityId: record.id,
      summary: `${type.name}, ${days} day${days === 1 ? '' : 's'} from ${input.fromDate}${autoApprove ? ' (approved by policy)' : ''}.`,
      after: { status: record.status, days, fromDate: input.fromDate, toDate: input.toDate },
      reason: input.reason,
      correlationId: request.requestId,
    });

    if (!autoApprove) {
      await notify(tx, {
        kind: 'LEAVE_REQUESTED',
        role: 'HR_MANAGER',
        title: 'Leave request awaiting a decision',
        body: `${days} day${days === 1 ? '' : 's'} of ${type.name} from ${input.fromDate}.`,
        entityType: 'LeaveRequest',
        entityId: record.id,
      });
    }
    return record;
  });

  realtime.publish({
    type: created.status === 'APPROVED' ? 'leave.decided' : 'leave.requested',
    entityId: created.id,
    affectedEmployeeIds: [employeeId],
  });
  response.status(201).json({ data: serialize(created) });
});

/* ── decide ──────────────────────────────────────────────────────────────── */

async function decide(
  requestId: string,
  decision: 'APPROVED' | 'REFUSED',
  note: string,
  actor: DecisionActor,
  correlationId: string,
) {
  return prisma.$transaction(async (tx) => {
    const record = await tx.leaveRequest.findUnique({
      where: { id: requestId },
      include: { leaveType: true, employee: { select: { fullName: true } } },
    });
    if (!record) throw new AppError('LEAVE_NOT_FOUND', 404, 'Leave request not found.');
    if (record.status !== 'PENDING') {
      throw new AppError(
        'INVALID_LEAVE_STATE',
        409,
        `This request is already ${record.status.toLowerCase()}.`,
        'Reload the approval inbox to see the current decision.',
      );
    }
    if (decision === 'REFUSED' && !note) {
      throw new AppError('REASON_REQUIRED', 400, 'A short note is required when refusing a request.');
    }

    const days = Number(record.days);
    if (decision === 'APPROVED') {
      await consumeAllocation(tx, record.employeeId, record.leaveTypeId, days, record.fromDate, record.toDate);
    }

    // The status guard in the WHERE clause is the concurrency control: a second
    // approver racing the first changes zero rows and is told so.
    const changed = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: {
        status: decision,
        approverId: actor.id,
        decidedAt: new Date(),
        decisionNote: note || null,
      },
    });
    if (changed.count !== 1) {
      throw new AppError('VERSION_CONFLICT', 409, 'This request was decided by someone else.', 'Reload the approval inbox.');
    }

    if (decision === 'APPROVED') await invalidateComputedPayruns(tx, [record.employeeId]);

    await recordAudit(tx, actor, {
      action: decision === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REFUSED',
      entityType: 'LeaveRequest',
      entityId: requestId,
      summary: `${record.employee.fullName}: ${days} day${days === 1 ? '' : 's'} of ${record.leaveType.name} ${decision.toLowerCase()}.`,
      before: { status: 'PENDING' },
      after: { status: decision },
      reason: note || undefined,
      correlationId,
    });
    await notifyEmployee(tx, record.employeeId, {
      kind: 'LEAVE_DECIDED',
      title: `Leave ${decision.toLowerCase()}`,
      body: `${days} day${days === 1 ? '' : 's'} of ${record.leaveType.name} from ${isoDate(record.fromDate)}${note ? ` — ${note}` : ''}.`,
      severity: decision === 'APPROVED' ? 'INFO' : 'WARNING',
      entityType: 'LeaveRequest',
      entityId: requestId,
    });

    return tx.leaveRequest.findUniqueOrThrow({ where: { id: requestId } });
  });
}

leaveRouter.post('/leave-requests/:id/approve', requirePermission('timeoff.approve'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const { note } = decisionSchema.parse(request.body ?? {});
  const record = await decide(id, 'APPROVED', note, request.currentUser!, request.requestId);
  realtime.publish({ type: 'leave.decided', entityId: id, affectedEmployeeIds: [record.employeeId] });
  response.json({ data: serialize(record) });
});

leaveRouter.post('/leave-requests/:id/refuse', requirePermission('timeoff.approve'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const { note } = decisionSchema.parse(request.body ?? {});
  const record = await decide(id, 'REFUSED', note, request.currentUser!, request.requestId);
  realtime.publish({ type: 'leave.decided', entityId: id, affectedEmployeeIds: [record.employeeId] });
  response.json({ data: serialize(record) });
});

leaveRouter.post('/leave-requests/:id/cancel', requirePermission('timeoff.request.self'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const actor = request.currentUser!;
  const record = await prisma.$transaction(async (tx) => {
    const current = await tx.leaveRequest.findUnique({ where: { id } });
    if (!current) throw new AppError('LEAVE_NOT_FOUND', 404, 'Leave request not found.');
    if (actor.role === 'EMPLOYEE' && current.employeeId !== actor.employeeId) {
      throw new AppError('SELF_SCOPE_REQUIRED', 403, 'You can only cancel your own leave.');
    }
    if (current.status === 'CANCELLED') {
      throw new AppError('INVALID_LEAVE_STATE', 409, 'This request is already cancelled.');
    }
    if (current.status === 'REFUSED') {
      throw new AppError('INVALID_LEAVE_STATE', 409, 'A refused request cannot be cancelled.');
    }
    if (current.status === 'APPROVED') {
      await releaseAllocation(
        tx,
        current.employeeId,
        current.leaveTypeId,
        Number(current.days),
        current.fromDate,
        current.toDate,
      );
    }
    const changed = await tx.leaveRequest.updateMany({
      where: { id, status: current.status },
      data: { status: 'CANCELLED', decidedAt: new Date(), approverId: actor.id },
    });
    if (changed.count !== 1) {
      throw new AppError('VERSION_CONFLICT', 409, 'This request changed elsewhere.', 'Reload and try again.');
    }
    await invalidateComputedPayruns(tx, [current.employeeId]);
    await recordAudit(tx, actor, {
      action: 'LEAVE_CANCELLED',
      entityType: 'LeaveRequest',
      entityId: id,
      summary: `Leave request cancelled from ${current.status.toLowerCase()}.`,
      before: { status: current.status },
      after: { status: 'CANCELLED' },
      correlationId: request.requestId,
    });
    return tx.leaveRequest.findUniqueOrThrow({ where: { id } });
  });
  realtime.publish({ type: 'leave.decided', entityId: id, affectedEmployeeIds: [record.employeeId] });
  response.json({ data: serialize(record) });
});

/* ── allocation ──────────────────────────────────────────────────────────── */

leaveRouter.post('/leave-allocations/grant', requirePermission('timeoff.allocate'), async (request, response) => {
  const input = grantSchema.parse(request.body);
  const actor = request.currentUser!;
  if (input.validTo < input.validFrom) {
    throw new AppError('INVALID_RANGE', 400, 'The allocation end date cannot be before its start date.');
  }
  const validFrom = asDate(input.validFrom);
  const validTo = asDate(input.validTo);

  const granted = await prisma.$transaction(async (tx) => {
    const [type, employees] = await Promise.all([
      tx.leaveType.findUnique({ where: { id: input.leaveTypeId } }),
      tx.employee.findMany({ where: { id: { in: input.employeeIds } }, select: { id: true } }),
    ]);
    if (!type) throw new AppError('LEAVE_TYPE_NOT_FOUND', 404, 'Leave type not found.');
    if (employees.length !== input.employeeIds.length) {
      throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'One or more employees in the selection no longer exist.');
    }

    for (const employee of employees) {
      await tx.leaveAllocation.upsert({
        where: {
          employeeId_leaveTypeId_validFrom: {
            employeeId: employee.id,
            leaveTypeId: type.id,
            validFrom,
          },
        },
        create: {
          id: `la-${randomUUID()}`,
          employeeId: employee.id,
          leaveTypeId: type.id,
          allocated: input.days,
          used: 0,
          carriedForward: 0,
          validFrom,
          validTo,
        },
        update: { allocated: { increment: input.days }, validTo },
      });
      await notifyEmployee(tx, employee.id, {
        kind: 'ALLOCATION_GRANTED',
        title: `${type.name} allocation updated`,
        body: `${input.days} day${input.days === 1 ? '' : 's'} added, valid ${input.validFrom} to ${input.validTo}.`,
        entityType: 'LeaveAllocation',
        entityId: type.id,
      });
    }

    await recordAudit(tx, actor, {
      action: 'ALLOCATION_GRANTED',
      entityType: 'LeaveAllocation',
      entityId: type.id,
      summary: `${input.days} day${input.days === 1 ? '' : 's'} of ${type.name} granted to ${employees.length} employee${employees.length === 1 ? '' : 's'}.`,
      after: { days: input.days, validFrom: input.validFrom, validTo: input.validTo, employees: employees.length },
      correlationId: request.requestId,
    });
    return employees.map((employee) => employee.id);
  });

  for (const employeeId of granted) {
    realtime.publish({ type: 'leave.allocation.updated', entityId: employeeId, affectedEmployeeIds: [employeeId] });
  }
  response.status(201).json({ data: { granted: granted.length } });
});
