import type { Prisma } from '@prisma/client';
import { countWorkingDays, eachDay, isWorkingDay, type ISODate } from '@shared/dates.js';

import { AppError } from '../lib/app-error.js';

type Db = Prisma.TransactionClient;

export const isoDate = (value: Date): ISODate => value.toISOString().slice(0, 10);
export const asDate = (value: ISODate): Date => new Date(`${value}T00:00:00.000Z`);

/**
 * A payroll input changed, so any run that was already computed is stale.
 *
 * This is the rule that keeps the product honest: a corrected punch or an
 * approved leave silently changing the numbers behind a COMPUTED payrun would
 * let someone validate figures nobody ever saw. Returning the run to DRAFT
 * forces a recompute, and the payrun version increments so a client holding the
 * old state gets a conflict rather than a surprise.
 */
export async function invalidateComputedPayruns(db: Db, employeeIds: string[]): Promise<string[]> {
  if (employeeIds.length === 0) return [];
  const memberships = await db.payrunEmployee.findMany({
    where: { employeeId: { in: employeeIds }, excludedAt: null, payrun: { status: 'COMPUTED' } },
    select: { payrunId: true },
    distinct: ['payrunId'],
  });
  if (memberships.length === 0) return [];
  const payrunIds = memberships.map((row) => row.payrunId);
  await db.payrun.updateMany({
    where: { id: { in: payrunIds }, status: 'COMPUTED' },
    data: { status: 'DRAFT', computedAt: null, inputSnapshotHash: null, version: { increment: 1 } },
  });
  await db.payslip.updateMany({
    where: { payrunId: { in: payrunIds }, status: 'COMPUTED' },
    data: { status: 'DRAFT' },
  });
  return payrunIds;
}

/** Refuse to change an input that a validated or paid payroll run depends on. */
export async function assertPayrollInputsOpen(db: Db, employeeId: string, from: Date, to: Date) {
  const locked = await db.payrunEmployee.findFirst({
    where: {
      employeeId,
      excludedAt: null,
      payrun: {
        status: { in: ['VALIDATED', 'PAID'] },
        periodStart: { lte: to },
        periodEnd: { gte: from },
      },
    },
    include: { payrun: { select: { name: true, status: true } } },
  });
  if (locked) {
    throw new AppError(
      'PAYRUN_LOCKED',
      409,
      `${locked.payrun.name} is ${locked.payrun.status.toLowerCase()}; its inputs are locked.`,
      'Reopen that payroll run before changing an input it already paid on.',
    );
  }
}

export interface WorkingDays {
  workingDows: number[];
  holidays: Set<ISODate>;
}

/** Load the schedule and holiday calendar an employee is actually measured against. */
export async function workingDaysFor(db: Db, employeeId: string, from: Date, to: Date): Promise<WorkingDays> {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: { workingSchedule: { include: { lines: true } } },
  });
  if (!employee) throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee record not found.');
  const holidays = await db.holiday.findMany({ where: { date: { gte: from, lte: to } } });
  return {
    workingDows: [...new Set(employee.workingSchedule.lines.map((line) => line.dayOfWeek))],
    holidays: new Set(holidays.map((holiday) => isoDate(holiday.date))),
  };
}

/**
 * Leave days, counted against the schedule rather than the calendar.
 *
 * A week off is five days for a Monday-to-Friday employee and six for a
 * six-day schedule; a public holiday inside the range costs nobody a day.
 */
export function countLeaveDays(
  from: ISODate,
  to: ISODate,
  halfDayStart: boolean,
  halfDayEnd: boolean,
  working: WorkingDays,
): number {
  let days = eachDay(from, to).filter((day) => isWorkingDay(day, working)).length;
  if (halfDayStart) days -= 0.5;
  if (halfDayEnd && from !== to) days -= 0.5;
  return Math.max(0, days);
}

export { countWorkingDays };
