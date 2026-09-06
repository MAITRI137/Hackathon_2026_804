import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { addDays } from '@shared/dates.js';

import { DEMO_ORGANISATION_ID } from '../config/tenant.js';
import { prisma } from '../db/prisma.js';
import { AppError, versionConflict } from '../lib/app-error.js';
import { requirePermission } from '../middleware/auth.js';
import { realtime } from '../realtime/events.js';
import { diffFields, recordAudit } from '../services/audit.js';
import { notify } from '../services/notifications.js';
import { asDate, invalidateComputedPayruns, isoDate } from '../services/payroll-inputs.js';

export const employeeRouter = Router();

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
const idParam = z.object({ id: z.string().min(1) });

const createSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(30).default(''),
  departmentId: z.string().min(1),
  jobPositionId: z.string().min(1),
  managerId: z.string().min(1).nullable().default(null),
  employeeType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']),
  joinDate: isoDay,
  workingScheduleId: z.string().min(1),
  salaryStructureId: z.string().min(1),
  wage: money,
});

const patchSchema = z.object({
  version: z.number().int().positive(),
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(30).optional(),
  managerId: z.string().min(1).nullable().optional(),
  jobPositionId: z.string().min(1).optional(),
  employeeType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional(),
  status: z.enum(['ACTIVE', 'PROBATION', 'NOTICE']).optional(),
  workingScheduleId: z.string().min(1).optional(),
});

const listSchema = z.object({
  search: z.string().trim().max(120).optional(),
  departmentId: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

const serialize = (employee: {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  initials: string;
  email: string;
  phone: string;
  departmentId: string;
  jobPositionId: string;
  managerId: string | null;
  employeeType: string;
  status: string;
  joinDate: Date;
  exitDate: Date | null;
  probationEndDate: Date | null;
  workingScheduleId: string;
  panMasked: string | null;
  version: number;
}) => ({
  ...employee,
  joinDate: isoDate(employee.joinDate),
  exitDate: employee.exitDate ? isoDate(employee.exitDate) : null,
  probationEndDate: employee.probationEndDate ? isoDate(employee.probationEndDate) : null,
});

/**
 * The next employee code, allocated from the highest existing one.
 *
 * Counting rows would reuse a code as soon as anybody is deleted, and two
 * concurrent creates would collide; taking the maximum and letting the unique
 * index reject a genuine race is both simpler and correct.
 */
async function nextEmployeeCode(db: Prisma.TransactionClient) {
  const highest = await db.employee.findFirst({
    where: { employeeCode: { startsWith: 'EMP-' } },
    orderBy: { employeeCode: 'desc' },
    select: { employeeCode: true },
  });
  const current = Number(highest?.employeeCode.slice(4) ?? 0);
  return `EMP-${String(current + 1).padStart(3, '0')}`;
}

/* ── read ────────────────────────────────────────────────────────────────── */

employeeRouter.get('/employees', requirePermission('employee.read.all'), async (request, response) => {
  const query = listSchema.parse(request.query);
  const where: Prisma.EmployeeWhereInput = {
    organisationId: DEMO_ORGANISATION_ID,
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.status ? { status: query.status as never } : {}),
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { employeeCode: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.employee.findMany({
      where,
      include: { bank: true },
      orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
      take: query.take,
      skip: query.skip,
    }),
    prisma.employee.count({ where }),
  ]);
  response.locals.recordsRead = rows.length;
  response.json({ data: { rows: rows.map(serialize), total, skip: query.skip, take: query.take } });
});

/* ── create ──────────────────────────────────────────────────────────────── */

employeeRouter.post('/employees', requirePermission('employee.write'), async (request, response) => {
  const input = createSchema.parse(request.body);
  const actor = request.currentUser!;

  const created = await prisma.$transaction(async (tx) => {
    const clash = await tx.employee.findUnique({ where: { email: input.email } });
    if (clash) throw new AppError('EMAIL_IN_USE', 409, 'An employee with this email already exists.');

    const [department, position, schedule, structure] = await Promise.all([
      tx.department.findUnique({ where: { id: input.departmentId } }),
      tx.jobPosition.findUnique({ where: { id: input.jobPositionId } }),
      tx.workingSchedule.findUnique({ where: { id: input.workingScheduleId } }),
      tx.salaryStructure.findUnique({ where: { id: input.salaryStructureId } }),
    ]);
    if (!department) throw new AppError('DEPARTMENT_NOT_FOUND', 404, 'That department no longer exists.');
    if (!position) throw new AppError('POSITION_NOT_FOUND', 404, 'That job position no longer exists.');
    if (!schedule) throw new AppError('SCHEDULE_NOT_FOUND', 404, 'That working schedule no longer exists.');
    if (!structure) throw new AppError('STRUCTURE_NOT_FOUND', 404, 'That salary structure no longer exists.');

    const code = await nextEmployeeCode(tx);
    const employee = await tx.employee.create({
      data: {
        id: code,
        organisationId: DEMO_ORGANISATION_ID,
        employeeCode: code,
        firstName: input.firstName,
        lastName: input.lastName,
        fullName: `${input.firstName} ${input.lastName}`,
        initials: (input.firstName[0]! + input.lastName[0]!).toUpperCase(),
        email: input.email,
        phone: input.phone,
        departmentId: input.departmentId,
        jobPositionId: input.jobPositionId,
        managerId: input.managerId,
        employeeType: input.employeeType,
        status: 'PROBATION',
        joinDate: asDate(input.joinDate),
        probationEndDate: asDate(addDays(input.joinDate, 90)),
        workingScheduleId: input.workingScheduleId,
      },
    });

    // A person without a contract cannot be paid, so the first contract is part
    // of hiring rather than a second screen somebody may forget.
    await tx.contract.create({
      data: {
        id: `ct-${code}`,
        contractRef: `CT-${code}`,
        employeeId: code,
        startDate: asDate(input.joinDate),
        departmentId: input.departmentId,
        jobPositionId: input.jobPositionId,
        employeeType: input.employeeType,
        wage: input.wage,
        salaryStructureId: input.salaryStructureId,
        workingScheduleId: input.workingScheduleId,
        status: 'ACTIVE',
        notes: 'Created with the employee record.',
      },
    });

    // Statutory leave is an entitlement from day one, not something HR remembers.
    const leaveTypes = await tx.leaveType.findMany({ where: { requiresAllocation: true } });
    const year = input.joinDate.slice(0, 4);
    for (const type of leaveTypes) {
      await tx.leaveAllocation.create({
        data: {
          id: `la-${code}-${type.code.toLowerCase()}`,
          employeeId: code,
          leaveTypeId: type.id,
          allocated: Number(type.accrualPerMonth) * 12,
          used: 0,
          carriedForward: 0,
          validFrom: asDate(`${year}-01-01`),
          validTo: asDate(`${year}-12-31`),
        },
      });
    }

    // Onboarding instantiates from the stored template so the checklist a new
    // joiner gets is the one the organisation configured, not a literal in code.
    const template = await tx.checklistTemplate.findFirst({
      where: { organisationId: DEMO_ORGANISATION_ID, kind: 'ONBOARDING', isActive: true },
    });
    if (template) {
      const items = z
        .array(z.object({ label: z.string(), ownerRole: z.string(), dueOffsetDays: z.number() }))
        .catch([])
        .parse(template.items);
      await tx.checklistInstance.create({
        data: {
          id: `chk-${code}`,
          templateId: template.id,
          employeeId: code,
          kind: 'ONBOARDING',
          startedAt: new Date(),
          items: {
            create: items.map((item, index) => ({
              label: item.label,
              ownerRole: item.ownerRole as never,
              sequence: index,
              dueDate: asDate(addDays(input.joinDate, item.dueOffsetDays)),
            })),
          },
        },
      });
    }

    await recordAudit(tx, actor, {
      action: 'EMPLOYEE_CREATED',
      entityType: 'Employee',
      entityId: code,
      summary: `${employee.fullName} added to ${department.name} on ${input.joinDate}.`,
      after: { fullName: employee.fullName, departmentId: input.departmentId, wage: input.wage },
      correlationId: request.requestId,
    });
    await notify(tx, {
      kind: 'EMPLOYEE_CREATED',
      role: 'HR_PAYROLL_USER',
      title: 'New joiner needs payroll setup',
      body: `${employee.fullName} starts ${input.joinDate} and has no verified bank account yet.`,
      severity: 'WARNING',
      entityType: 'Employee',
      entityId: code,
    });
    return employee;
  });

  realtime.publish({ type: 'employee.created', entityId: created.id, affectedEmployeeIds: [created.id] });
  response.status(201).json({ data: serialize(created) });
});

/* ── update ──────────────────────────────────────────────────────────────── */

employeeRouter.patch('/employees/:id', requirePermission('employee.write'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const { version, ...patch } = patchSchema.parse(request.body);
  const actor = request.currentUser!;

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.employee.findUnique({ where: { id } });
    if (!current) throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee record not found.');
    if (current.version !== version) throw versionConflict('employee record', current.version);
    if (patch.email && patch.email !== current.email) {
      const clash = await tx.employee.findUnique({ where: { email: patch.email } });
      if (clash) throw new AppError('EMAIL_IN_USE', 409, 'Another employee already uses this email.');
    }

    const firstName = patch.firstName ?? current.firstName;
    const lastName = patch.lastName ?? current.lastName;
    const changed = await tx.employee.updateMany({
      where: { id, version },
      data: {
        ...patch,
        fullName: `${firstName} ${lastName}`,
        initials: (firstName[0]! + lastName[0]!).toUpperCase(),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw versionConflict('employee record', current.version);

    const delta = diffFields(current as unknown as Record<string, unknown>, patch);
    await recordAudit(tx, actor, {
      action: 'EMPLOYEE_UPDATED',
      entityType: 'Employee',
      entityId: id,
      summary: `${current.fullName}: ${Object.keys(delta.after).join(', ') || 'no field'} updated.`,
      before: delta.before,
      after: delta.after,
      correlationId: request.requestId,
    });
    // A schedule change alters expected working days, which changes pay.
    if (patch.workingScheduleId) await invalidateComputedPayruns(tx, [id]);
    return tx.employee.findUniqueOrThrow({ where: { id } });
  });

  realtime.publish({ type: 'employee.updated', entityId: id, affectedEmployeeIds: [id] });
  response.json({ data: serialize(updated) });
});

/* ── lifecycle ───────────────────────────────────────────────────────────── */

employeeRouter.post('/employees/:id/archive', requirePermission('employee.archive'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const { reason, version } = z
    .object({ reason: z.string().trim().min(3).max(500), version: z.number().int().positive() })
    .parse(request.body);
  const actor = request.currentUser!;

  const archived = await prisma.$transaction(async (tx) => {
    const current = await tx.employee.findUnique({ where: { id } });
    if (!current) throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee record not found.');
    if (current.version !== version) throw versionConflict('employee record', current.version);
    if (current.status === 'ARCHIVED') throw new AppError('ALREADY_ARCHIVED', 409, 'This employee is already archived.');

    const open = await tx.payrunEmployee.findFirst({
      where: { employeeId: id, excludedAt: null, payrun: { status: { in: ['DRAFT', 'COMPUTED'] } } },
      include: { payrun: { select: { name: true } } },
    });
    if (open) {
      throw new AppError(
        'EMPLOYEE_IN_OPEN_PAYRUN',
        409,
        `${current.fullName} is still included in ${open.payrun.name}.`,
        'Remove them from that payroll run first, or pay it before archiving.',
      );
    }

    const changed = await tx.employee.updateMany({
      where: { id, version },
      data: { status: 'ARCHIVED', version: { increment: 1 } },
    });
    if (changed.count !== 1) throw versionConflict('employee record', current.version);
    await tx.contract.updateMany({ where: { employeeId: id, status: 'ACTIVE' }, data: { status: 'TERMINATED' } });
    await recordAudit(tx, actor, {
      action: 'EMPLOYEE_ARCHIVED',
      entityType: 'Employee',
      entityId: id,
      summary: `${current.fullName} archived.`,
      before: { status: current.status },
      after: { status: 'ARCHIVED' },
      reason,
      correlationId: request.requestId,
    });
    return tx.employee.findUniqueOrThrow({ where: { id } });
  });

  realtime.publish({ type: 'employee.archived', entityId: id, affectedEmployeeIds: [id] });
  response.json({ data: serialize(archived) });
});

employeeRouter.post('/employees/:id/restore', requirePermission('employee.archive'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const { status, version } = z
    .object({ status: z.enum(['ACTIVE', 'PROBATION', 'NOTICE']), version: z.number().int().positive() })
    .parse(request.body);
  const actor = request.currentUser!;

  const restored = await prisma.$transaction(async (tx) => {
    const current = await tx.employee.findUnique({ where: { id } });
    if (!current) throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee record not found.');
    if (current.status !== 'ARCHIVED') throw new AppError('NOT_ARCHIVED', 409, 'This employee is not archived.');
    if (current.version !== version) throw versionConflict('employee record', current.version);
    const changed = await tx.employee.updateMany({ where: { id, version }, data: { status, version: { increment: 1 } } });
    if (changed.count !== 1) throw versionConflict('employee record', current.version);
    // Archiving is reversible; the audit trail of it is not. Both events stay.
    await recordAudit(tx, actor, {
      action: 'EMPLOYEE_RESTORED',
      entityType: 'Employee',
      entityId: id,
      summary: `${current.fullName} restored as ${status.toLowerCase()}.`,
      before: { status: 'ARCHIVED' },
      after: { status },
      correlationId: request.requestId,
    });
    return tx.employee.findUniqueOrThrow({ where: { id } });
  });

  realtime.publish({ type: 'employee.updated', entityId: id, affectedEmployeeIds: [id] });
  response.json({ data: serialize(restored) });
});

employeeRouter.post('/employees/:id/move-department', requirePermission('employee.write'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const { departmentId, version } = z
    .object({ departmentId: z.string().min(1), version: z.number().int().positive() })
    .parse(request.body);
  const actor = request.currentUser!;

  const moved = await prisma.$transaction(async (tx) => {
    const [current, department] = await Promise.all([
      tx.employee.findUnique({ where: { id } }),
      tx.department.findUnique({ where: { id: departmentId } }),
    ]);
    if (!current) throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee record not found.');
    if (!department) throw new AppError('DEPARTMENT_NOT_FOUND', 404, 'That department no longer exists.');
    if (current.version !== version) throw versionConflict('employee record', current.version);
    if (current.departmentId === departmentId) {
      throw new AppError('NO_CHANGE', 409, `${current.fullName} is already in ${department.name}.`);
    }
    const changed = await tx.employee.updateMany({
      where: { id, version },
      data: { departmentId, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw versionConflict('employee record', current.version);
    // Cost reporting reads the contract, so the live contract moves with them.
    await tx.contract.updateMany({ where: { employeeId: id, status: 'ACTIVE' }, data: { departmentId } });
    await recordAudit(tx, actor, {
      action: 'EMPLOYEE_MOVED',
      entityType: 'Employee',
      entityId: id,
      summary: `${current.fullName} moved to ${department.name}.`,
      before: { departmentId: current.departmentId },
      after: { departmentId },
      correlationId: request.requestId,
    });
    return tx.employee.findUniqueOrThrow({ where: { id } });
  });

  realtime.publish({ type: 'employee.updated', entityId: id, affectedEmployeeIds: [id] });
  response.json({ data: serialize(moved) });
});

/* ── batch ───────────────────────────────────────────────────────────────── */

const batchSchema = z.object({
  employeeIds: z.array(z.string().min(1)).min(1).max(500),
  reason: z.string().trim().min(3).max(500).default('Bulk assignment'),
});

employeeRouter.post('/employees/batch/schedule', requirePermission('schedule.write'), async (request, response) => {
  const { employeeIds, reason, workingScheduleId } = batchSchema
    .extend({ workingScheduleId: z.string().min(1) })
    .parse(request.body);
  const actor = request.currentUser!;

  const count = await prisma.$transaction(async (tx) => {
    const schedule = await tx.workingSchedule.findUnique({ where: { id: workingScheduleId } });
    if (!schedule) throw new AppError('SCHEDULE_NOT_FOUND', 404, 'That working schedule no longer exists.');
    const changed = await tx.employee.updateMany({
      where: { id: { in: employeeIds } },
      data: { workingScheduleId, version: { increment: 1 } },
    });
    await tx.contract.updateMany({
      where: { employeeId: { in: employeeIds }, status: 'ACTIVE' },
      data: { workingScheduleId },
    });
    await invalidateComputedPayruns(tx, employeeIds);
    await recordAudit(tx, actor, {
      action: 'SCHEDULE_ASSIGNED',
      entityType: 'WorkingSchedule',
      entityId: workingScheduleId,
      summary: `${schedule.name} assigned to ${changed.count} employee${changed.count === 1 ? '' : 's'}.`,
      after: { workingScheduleId, employees: changed.count },
      reason,
      correlationId: request.requestId,
    });
    return changed.count;
  });

  for (const employeeId of employeeIds) {
    realtime.publish({ type: 'employee.updated', entityId: employeeId, affectedEmployeeIds: [employeeId] });
  }
  response.json({ data: { updated: count } });
});

employeeRouter.post('/employees/batch/salary-structure', requirePermission('contract.write'), async (request, response) => {
  const { employeeIds, reason, salaryStructureId } = batchSchema
    .extend({ salaryStructureId: z.string().min(1) })
    .parse(request.body);
  const actor = request.currentUser!;

  const count = await prisma.$transaction(async (tx) => {
    const structure = await tx.salaryStructure.findUnique({ where: { id: salaryStructureId } });
    if (!structure) throw new AppError('STRUCTURE_NOT_FOUND', 404, 'That salary structure no longer exists.');
    const locked = await tx.payrunEmployee.findFirst({
      where: { employeeId: { in: employeeIds }, excludedAt: null, payrun: { status: { in: ['VALIDATED', 'PAID'] } } },
      include: { payrun: { select: { name: true } } },
    });
    if (locked) {
      throw new AppError(
        'PAYRUN_LOCKED',
        409,
        `Part of this selection is in ${locked.payrun.name}, which is already closed.`,
        'Reopen that payroll run or narrow the selection.',
      );
    }
    const changed = await tx.contract.updateMany({
      where: { employeeId: { in: employeeIds }, status: 'ACTIVE' },
      data: { salaryStructureId, version: { increment: 1 } },
    });
    await invalidateComputedPayruns(tx, employeeIds);
    await recordAudit(tx, actor, {
      action: 'STRUCTURE_ASSIGNED',
      entityType: 'SalaryStructure',
      entityId: salaryStructureId,
      summary: `${structure.name} assigned to ${changed.count} active contract${changed.count === 1 ? '' : 's'}.`,
      after: { salaryStructureId, contracts: changed.count },
      reason,
      correlationId: request.requestId,
    });
    return changed.count;
  });

  for (const employeeId of employeeIds) {
    realtime.publish({ type: 'contract.updated', entityId: employeeId, affectedEmployeeIds: [employeeId] });
  }
  response.json({ data: { updated: count } });
});
