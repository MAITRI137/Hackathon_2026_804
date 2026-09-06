import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { AppError } from '../lib/app-error.js';
import { requirePermission } from '../middleware/auth.js';
import { realtime } from '../realtime/events.js';
import { writeAudit } from '../services/payrun-decision.js';

export const attendanceRouter = Router();

const timeValue = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const correctionSchema = z.object({
  checkIn: timeValue.nullable().optional(),
  checkOut: timeValue.nullable().optional(),
  reason: z.string().trim().min(3).max(500),
  version: z.number().int().positive(),
});
const regularizationSchema = z.object({
  records: z.array(z.object({ id: z.string().min(1), checkOut: timeValue, reason: z.string().trim().min(3).max(500), version: z.number().int().positive() })).min(1).max(100),
});
const paramsSchema = z.object({ id: z.string().min(1) });

function inTimezone(now: Date, timezone: string) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function minutes(value: string) {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function dateDay(date: Date) {
  return date.getUTCDay();
}

function serialize(record: {
  id: string; employeeId: string; date: Date; checkIn: string | null; checkOut: string | null;
  workedMinutes: number; status: string; source: string; correctionReason: string | null;
  correctedById: string | null; correctedAt: Date | null; version: number;
}) {
  return {
    ...record,
    date: record.date.toISOString().slice(0, 10),
    correctedAt: record.correctedAt?.toISOString() ?? null,
  };
}

async function scheduleBreakMinutes(db: Prisma.TransactionClient, employeeId: string, date: Date) {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: { workingSchedule: { include: { lines: true } } },
  });
  if (!employee) throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee record not found.');
  const line = employee.workingSchedule.lines.find((item) => item.dayOfWeek === dateDay(date));
  return line?.breakMinutes ?? 0;
}

async function invalidateOpenPayruns(tx: Prisma.TransactionClient, employeeId: string) {
  const memberships = await tx.payrunEmployee.findMany({
    where: { employeeId, excludedAt: null, payrun: { status: 'COMPUTED' } },
    select: { payrunId: true },
  });
  if (!memberships.length) return [];
  const ids = memberships.map((item) => item.payrunId);
  await tx.payrun.updateMany({
    where: { id: { in: ids }, status: 'COMPUTED' },
    data: { status: 'DRAFT', computedAt: null, inputSnapshotHash: null, version: { increment: 1 } },
  });
  return ids;
}

attendanceRouter.post('/attendance/check-in', requirePermission('attendance.self.punch'), async (request, response) => {
  const actor = request.currentUser!;
  if (!actor.employeeId) throw new AppError('SELF_SCOPE_REQUIRED', 403, 'Only an employee-linked account can check in.');

  const employee = await prisma.employee.findUnique({ where: { id: actor.employeeId }, include: { workingSchedule: { include: { lines: true } } } });
  if (!employee) throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee record not found.');
  const local = inTimezone(new Date(), employee.workingSchedule.timezone);
  const localDate = new Date(`${local.date}T00:00:00.000Z`);
  const result = await prisma.$transaction(async (tx) => {
    const open = await tx.attendance.findFirst({ where: { employeeId: employee.id, date: localDate, checkIn: { not: null }, checkOut: null } });
    if (open) throw new AppError('ATTENDANCE_ALREADY_OPEN', 409, 'You already have an open attendance record. Check out before checking in again.');
    const existing = await tx.attendance.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: localDate } } });
    if (existing) throw new AppError('ATTENDANCE_ALREADY_RECORDED', 409, 'Attendance is already recorded for today.');
    const record = await tx.attendance.create({
      data: { id: randomUUID(), employeeId: employee.id, date: localDate, checkIn: local.time, workedMinutes: 0, status: 'PRESENT', source: 'SELF' },
    });
    await writeAudit(tx, actor, 'ATTENDANCE_CHECKED_IN', 'Attendance', record.id, `Self check-in at ${local.time}.`);
    return record;
  });
  realtime.publish({ type: 'attendance.created', entityId: result.id, affectedEmployeeIds: [result.employeeId] });
  response.status(201).json({ data: serialize(result) });
});

attendanceRouter.post('/attendance/check-out', requirePermission('attendance.self.punch'), async (request, response) => {
  const actor = request.currentUser!;
  if (!actor.employeeId) throw new AppError('SELF_SCOPE_REQUIRED', 403, 'Only an employee-linked account can check out.');
  const employee = await prisma.employee.findUnique({ where: { id: actor.employeeId }, include: { workingSchedule: { include: { lines: true } } } });
  if (!employee) throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee record not found.');
  const local = inTimezone(new Date(), employee.workingSchedule.timezone);
  const result = await prisma.$transaction(async (tx) => {
    const open = await tx.attendance.findFirst({ where: { employeeId: employee.id, checkIn: { not: null }, checkOut: null }, orderBy: { date: 'desc' } });
    if (!open?.checkIn) throw new AppError('ATTENDANCE_NOT_OPEN', 409, 'There is no open attendance record to check out.');
    const breakMinutes = employee.workingSchedule.lines.find((line) => line.dayOfWeek === dateDay(open.date))?.breakMinutes ?? 0;
    const workedMinutes = minutes(local.time) - minutes(open.checkIn) - breakMinutes;
    if (workedMinutes < 0) throw new AppError('INVALID_ATTENDANCE_DURATION', 409, 'Checkout would produce a negative worked duration.');
    const record = await tx.attendance.update({
      where: { id: open.id },
      data: { checkOut: local.time, workedMinutes, status: 'PRESENT', version: { increment: 1 } },
    });
    await invalidateOpenPayruns(tx, employee.id);
    await writeAudit(tx, actor, 'ATTENDANCE_CHECKED_OUT', 'Attendance', record.id, `Self checkout at ${local.time}; ${workedMinutes} worked minutes.`);
    return record;
  });
  realtime.publish({ type: 'attendance.updated', entityId: result.id, affectedEmployeeIds: [result.employeeId] });
  response.json({ data: serialize(result) });
});

attendanceRouter.patch('/attendance/:id/correction', requirePermission('attendance.correct'), async (request, response) => {
  const input = correctionSchema.parse(request.body);
  const { id } = paramsSchema.parse(request.params);
  const actor = request.currentUser!;
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.attendance.findUnique({ where: { id } });
    if (!current) throw new AppError('ATTENDANCE_NOT_FOUND', 404, 'Attendance record not found.');
    if (current.version !== input.version) throw new AppError('VERSION_CONFLICT', 409, 'This attendance record changed elsewhere.', 'Reload the record, compare the server values, then try again.');
    const checkIn = input.checkIn === undefined ? current.checkIn : input.checkIn;
    const checkOut = input.checkOut === undefined ? current.checkOut : input.checkOut;
    if (!checkIn || !checkOut || minutes(checkOut) <= minutes(checkIn)) throw new AppError('INVALID_ATTENDANCE_DURATION', 400, 'Checkout must be after check-in.');
    const breakMinutes = await scheduleBreakMinutes(tx, current.employeeId, current.date);
    const workedMinutes = minutes(checkOut) - minutes(checkIn) - breakMinutes;
    if (workedMinutes < 0) throw new AppError('INVALID_ATTENDANCE_DURATION', 400, 'Times are shorter than the scheduled break.');
    const change = await tx.attendance.updateMany({
      where: { id: current.id, version: input.version },
      data: { checkIn, checkOut, workedMinutes, status: 'PRESENT', source: 'MANAGER', correctionReason: input.reason, correctedById: actor.id, correctedAt: new Date(), version: { increment: 1 } },
    });
    if (change.count !== 1) throw new AppError('VERSION_CONFLICT', 409, 'This attendance record changed elsewhere.', 'Reload the record, compare the server values, then try again.');
    const record = await tx.attendance.findUniqueOrThrow({ where: { id: current.id } });
    await invalidateOpenPayruns(tx, current.employeeId);
    await writeAudit(tx, actor, 'ATTENDANCE_CORRECTED', 'Attendance', current.id, `Attendance corrected: ${checkIn}–${checkOut}. ${input.reason}`);
    return record;
  });
  realtime.publish({ type: 'attendance.updated', entityId: result.id, affectedEmployeeIds: [result.employeeId] });
  response.json({ data: serialize(result) });
});

attendanceRouter.post('/attendance/regularizations', requirePermission('attendance.correct'), async (request, response) => {
  const input = regularizationSchema.parse(request.body);
  const actor = request.currentUser!;
  const records = await prisma.$transaction(async (tx) => {
    const updated = [] as string[];
    for (const item of input.records) {
      const current = await tx.attendance.findUnique({ where: { id: item.id } });
      if (!current?.checkIn) throw new AppError('ATTENDANCE_NOT_ELIGIBLE', 409, 'Only checked-in records can be regularized.');
      if (current.version !== item.version) throw new AppError('VERSION_CONFLICT', 409, 'One attendance record changed elsewhere.', 'Reload the list and retry.');
      const breakMinutes = await scheduleBreakMinutes(tx, current.employeeId, current.date);
      const workedMinutes = minutes(item.checkOut) - minutes(current.checkIn) - breakMinutes;
      if (workedMinutes < 0) throw new AppError('INVALID_ATTENDANCE_DURATION', 400, 'A proposed checkout is before the valid working duration.');
      const change = await tx.attendance.updateMany({ where: { id: current.id, version: item.version }, data: { checkOut: item.checkOut, workedMinutes, status: 'PRESENT', source: 'MANAGER', correctionReason: item.reason, correctedById: actor.id, correctedAt: new Date(), version: { increment: 1 } } });
      if (change.count !== 1) throw new AppError('VERSION_CONFLICT', 409, 'One attendance record changed elsewhere.', 'Reload the list and retry.');
      await invalidateOpenPayruns(tx, current.employeeId);
      await writeAudit(tx, actor, 'ATTENDANCE_REGULARIZED', 'Attendance', current.id, `Checkout regularized to ${item.checkOut}. ${item.reason}`);
      updated.push(current.id);
    }
    return updated;
  });
  for (const id of records) realtime.publish({ type: 'attendance.updated', entityId: id, affectedEmployeeIds: [] });
  response.json({ data: { recordIds: records } });
});
