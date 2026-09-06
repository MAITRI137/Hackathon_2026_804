import { createHash, randomUUID } from 'node:crypto';

import type { Prisma, Payrun, User } from '@prisma/client';
import { PayrunStatus } from '@prisma/client';
import { computePayslip, type PayrollContext } from '@shared/engine.js';
import { addMoney, money, toMoneyString } from '@shared/money.js';
import { countWorkingDays, eachDay, isWorkingDay, monthLabel, rangeOverlaps } from '@shared/dates.js';
import type { SalaryRule, SourceRef } from '@shared/types.js';

import { AppError } from '../lib/app-error.js';

type Db = Prisma.TransactionClient;

export type DecisionActor = Pick<User, 'id' | 'displayName' | 'role'>;

export interface BlockingIssue {
  code: 'MISSING_BANK' | 'MISSING_CHECKOUT' | 'NO_CONTRACT' | 'AMBIGUOUS_CONTRACT' | 'INVALID_RULE' | 'NEGATIVE_NET';
  employeeId: string;
  severity: number;
}

export interface PayrunEvaluation {
  payrun: Payrun;
  employeeCount: number;
  netTotal: string;
  snapshotHash: string;
  issues: BlockingIssue[];
  readinessScore: number;
}

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

function issue(
  code: BlockingIssue['code'],
  employeeId: string,
  severity: number,
): BlockingIssue {
  return { code, employeeId, severity };
}

/**
 * Rebuild the payroll decision inputs from PostgreSQL. The browser never
 * supplies amounts, readiness, or a snapshot hash to this service.
 */
export async function evaluatePayrun(db: Db, payrunId: string): Promise<PayrunEvaluation> {
  const payrun = await db.payrun.findUnique({
    where: { id: payrunId },
    include: {
      employees: {
        where: { excludedAt: null },
        include: {
          employee: {
            include: {
              bank: true,
              workingSchedule: { include: { lines: true } },
            },
          },
        },
      },
    },
  });
  if (!payrun) {
    throw new AppError('PAYRUN_NOT_FOUND', 404, 'Payroll period not found.');
  }

  const employeeIds = payrun.employees.map((member) => member.employeeId);
  const start = dateOnly(payrun.periodStart);
  const end = dateOnly(payrun.periodEnd);
  const [contracts, attendance, leaveRequests, holidays, rules] = await Promise.all([
    db.contract.findMany({ where: { employeeId: { in: employeeIds } } }),
    db.attendance.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: payrun.periodStart, lte: payrun.periodEnd } },
    }),
    db.leaveRequest.findMany({
      where: { employeeId: { in: employeeIds }, status: 'APPROVED' },
      include: { leaveType: true },
    }),
    db.holiday.findMany({ where: { date: { gte: payrun.periodStart, lte: payrun.periodEnd } } }),
    db.salaryRule.findMany({ where: { structureId: payrun.salaryStructureId }, orderBy: [{ sequence: 'asc' }, { code: 'asc' }] }),
  ]);

  const issues: BlockingIssue[] = [];
  const contextHashes: string[] = [];
  let netTotal = money(0);

  for (const member of payrun.employees) {
    const employee = member.employee;
    if (employee.status === 'ARCHIVED' || employee.status === 'EXITED') continue;

    if (!employee.bank?.verifiedAt) issues.push(issue('MISSING_BANK', employee.id, 5));

    const records = attendance.filter((record) => record.employeeId === employee.id);
    if (records.some((record) => record.checkIn && !record.checkOut)) {
      issues.push(issue('MISSING_CHECKOUT', employee.id, 4));
    }

    const candidates = contracts.filter(
      (contract) =>
        contract.employeeId === employee.id &&
        contract.status !== 'DRAFT' &&
        rangeOverlaps(dateOnly(contract.startDate), contract.endDate ? dateOnly(contract.endDate) : null, start, end),
    );
    const active = candidates.filter((contract) => contract.status === 'ACTIVE');
    const selected = active.length > 0 ? active : candidates;
    if (selected.length === 0) {
      issues.push(issue('NO_CONTRACT', employee.id, 6));
      continue;
    }
    if (selected.length > 1) {
      issues.push(issue('AMBIGUOUS_CONTRACT', employee.id, 6));
      continue;
    }

    const contract = selected[0]!;
    const schedule = employee.workingSchedule;
    const working = { workingDows: schedule.lines.map((line) => line.dayOfWeek), holidays: new Set(holidays.map((holiday) => dateOnly(holiday.date))) };
    const expectedDays = countWorkingDays(start, end, working);
    const byCode: Record<string, number> = {};
    const refs: SourceRef[] = [];
    let paidDays = 0;
    let unpaidDays = 0;

    for (const leave of leaveRequests) {
      if (leave.employeeId !== employee.id) continue;
      const leaveStart = dateOnly(leave.fromDate);
      const leaveEnd = dateOnly(leave.toDate);
      if (!rangeOverlaps(leaveStart, leaveEnd, start, end)) continue;
      let days = eachDay(leaveStart < start ? start : leaveStart, leaveEnd > end ? end : leaveEnd).filter((day) =>
        isWorkingDay(day, working),
      ).length;
      if (leave.halfDayStart && leaveStart >= start) days -= 0.5;
      if (leave.halfDayEnd && leaveEnd <= end && leaveStart !== leaveEnd) days -= 0.5;
      if (days <= 0) continue;
      byCode[leave.leaveType.code] = (byCode[leave.leaveType.code] ?? 0) + days;
      if (leave.leaveType.isPaid) paidDays += days;
      else unpaidDays += days;
      refs.push({ type: 'LEAVE', id: leave.id, label: `${leave.leaveType.name} ${leave.id}` });
    }

    const scheduledMinutes = schedule.lines.length
      ? (Number(schedule.hoursPerWeek) * 60) / schedule.lines.length
      : 480;
    const payrollRules: SalaryRule[] = rules.map((rule) => ({
      id: rule.id,
      structureId: rule.structureId,
      code: rule.code,
      name: rule.name,
      category: rule.category,
      sequence: rule.sequence,
      type: rule.type,
      amount: rule.amount?.toFixed(2) ?? null,
      percentage: rule.percentage?.toString() ?? null,
      baseCode: rule.baseCode,
      formula: rule.formula,
      conditionFormula: rule.conditionFormula,
      isActive: rule.isActive,
      ruleVersion: rule.ruleVersion,
    }));
    const context: PayrollContext = {
      employee: { id: employee.id, code: employee.employeeCode, name: employee.fullName, type: employee.employeeType },
      contract: {
        id: contract.id,
        ref: contract.contractRef,
        wage: contract.wage.toFixed(2),
        structureId: contract.salaryStructureId,
        scheduleId: contract.workingScheduleId,
      },
      period: { start, end, expectedDays, label: monthLabel(start) },
      schedule: { id: schedule.id, name: schedule.name, hoursPerWeek: Number(schedule.hoursPerWeek) },
      attendance: {
        presentDays: records.filter((record) => record.status !== 'ABSENT' && record.checkIn).length,
        workedMinutes: records.reduce((sum, record) => sum + record.workedMinutes, 0),
        overtimeMinutes: Math.round(records.reduce((sum, record) => sum + Math.max(0, record.workedMinutes - scheduledMinutes), 0)),
        lateDays: records.filter((record) => record.status === 'LATE').length,
      },
      leave: { paidDays, unpaidDays, byCode, refs },
      rules: payrollRules,
    };

    try {
      const result = computePayslip(context);
      netTotal = addMoney(netTotal, result.net);
      if (money(result.net).isNegative()) issues.push(issue('NEGATIVE_NET', employee.id, 6));
      contextHashes.push(
        JSON.stringify({ employeeId: employee.id, contractId: contract.id, input: context, net: result.net }),
      );
    } catch (error) {
      void error;
      issues.push(issue('INVALID_RULE', employee.id, 6));
    }
  }

  const snapshotHash = createHash('sha256').update(contextHashes.sort().join('\n')).digest('hex');
  const penalty = issues.reduce((sum, item) => sum + item.severity, 0);
  return {
    payrun,
    employeeCount: payrun.employees.length,
    netTotal: toMoneyString(netTotal),
    snapshotHash,
    issues,
    readinessScore: Math.max(0, 100 - penalty),
  };
}

export async function writeAudit(
  db: Db,
  actor: DecisionActor,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
) {
  await db.auditEvent.create({
    data: {
      id: randomUUID(),
      at: new Date(),
      actorId: actor.id,
      actorName: actor.displayName,
      actorRole: actor.role,
      action,
      entityType,
      entityId,
      summary,
    },
  });
}

export function assertNoBlockingIssues(evaluation: PayrunEvaluation) {
  if (evaluation.issues.length > 0) {
    throw new AppError(
      'PAYRUN_BLOCKED',
      409,
      `${evaluation.issues.length} blocking payroll input${evaluation.issues.length === 1 ? '' : 's'} must be resolved first.`,
      'Resolve the listed bank, attendance, contract, rule, or net-pay issue and recompute payroll.',
    );
  }
}

export function assertStatus(payrun: Payrun, expected: PayrunStatus) {
  if (payrun.status !== expected) {
    throw new AppError(
      'INVALID_PAYRUN_STATE',
      409,
      `This action requires a ${expected.toLowerCase()} payroll run.`,
      `The current state is ${payrun.status.toLowerCase()}.`,
    );
  }
}
