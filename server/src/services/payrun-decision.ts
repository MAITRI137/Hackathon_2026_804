import { createHash } from 'node:crypto';

import type { Contract, Prisma, Payrun, User } from '@prisma/client';
import { PayrunStatus } from '@prisma/client';
import { computePayslip, type PayrollContext, type PayslipResult } from '@shared/engine.js';
import { addMoney, money, toMoneyString } from '@shared/money.js';
import { countWorkingDays, eachDay, isWorkingDay, monthLabel, rangeOverlaps } from '@shared/dates.js';
import type { SalaryRule, SourceRef } from '@shared/types.js';

import { AppError } from '../lib/app-error.js';
import { recordAudit, type AuditActor } from './audit.js';

type Db = Prisma.TransactionClient;

export type DecisionActor = Pick<User, 'id' | 'displayName' | 'role'>;

export interface BlockingIssue {
  code:
    | 'MISSING_BANK'
    | 'MISSING_CHECKOUT'
    | 'NO_CONTRACT'
    | 'AMBIGUOUS_CONTRACT'
    | 'INVALID_RULE'
    | 'NEGATIVE_NET';
  employeeId: string;
  severity: number;
}

/** One employee resolved against the period: the inputs, the result, the problems. */
export interface EmployeeEvaluation {
  employeeId: string;
  contract: Contract | null;
  context: PayrollContext | null;
  result: PayslipResult | null;
  issues: BlockingIssue[];
}

export interface PayrunEvaluation {
  payrun: Payrun;
  /** Everyone included in the run. */
  memberCount: number;
  /** Everyone who actually produced a payslip. The receipt reports this one. */
  computedCount: number;
  netTotal: string;
  snapshotHash: string;
  issues: BlockingIssue[];
  readinessScore: number;
  evaluations: EmployeeEvaluation[];
}

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

const issue = (code: BlockingIssue['code'], employeeId: string, severity: number): BlockingIssue => ({
  code,
  employeeId,
  severity,
});

/**
 * Rebuild the payroll decision inputs from PostgreSQL.
 *
 * The browser never supplies amounts, readiness, or a snapshot hash to this
 * service. Everything a payslip claims is recomputed here from the stored
 * contract, attendance, leave, schedule, holiday calendar and rule set, so the
 * numbers a manager validates are the numbers the database can defend.
 */
export async function evaluatePayrun(db: Db, payrunId: string): Promise<PayrunEvaluation> {
  const payrun = await db.payrun.findUnique({
    where: { id: payrunId },
    include: {
      employees: {
        where: { excludedAt: null },
        include: { employee: { include: { bank: true, workingSchedule: { include: { lines: true } } } } },
      },
    },
  });
  if (!payrun) throw new AppError('PAYRUN_NOT_FOUND', 404, 'Payroll period not found.');

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
    db.salaryRule.findMany({
      where: { structureId: payrun.salaryStructureId, supersededAt: null },
      orderBy: [{ sequence: 'asc' }, { code: 'asc' }],
    }),
  ]);

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

  const evaluations: EmployeeEvaluation[] = [];
  const issues: BlockingIssue[] = [];
  const snapshotParts: string[] = [];
  let netTotal = money(0);
  let computedCount = 0;

  for (const member of payrun.employees) {
    const employee = member.employee;
    if (employee.status === 'ARCHIVED' || employee.status === 'EXITED') continue;
    const own: BlockingIssue[] = [];

    if (!employee.bank?.verifiedAt) own.push(issue('MISSING_BANK', employee.id, 5));

    const records = attendance.filter((record) => record.employeeId === employee.id);
    if (records.some((record) => record.checkIn && !record.checkOut)) {
      own.push(issue('MISSING_CHECKOUT', employee.id, 4));
    }

    const candidates = contracts.filter(
      (contract) =>
        contract.employeeId === employee.id &&
        contract.status !== 'DRAFT' &&
        rangeOverlaps(
          dateOnly(contract.startDate),
          contract.endDate ? dateOnly(contract.endDate) : null,
          start,
          end,
        ),
    );
    const active = candidates.filter((contract) => contract.status === 'ACTIVE');
    const selected = active.length > 0 ? active : candidates;
    if (selected.length === 0) {
      own.push(issue('NO_CONTRACT', employee.id, 6));
      issues.push(...own);
      evaluations.push({ employeeId: employee.id, contract: null, context: null, result: null, issues: own });
      continue;
    }
    if (selected.length > 1) {
      own.push(issue('AMBIGUOUS_CONTRACT', employee.id, 6));
      issues.push(...own);
      evaluations.push({ employeeId: employee.id, contract: null, context: null, result: null, issues: own });
      continue;
    }

    const contract = selected[0]!;
    const schedule = employee.workingSchedule;
    const working = {
      workingDows: schedule.lines.map((line) => line.dayOfWeek),
      holidays: new Set(holidays.map((holiday) => dateOnly(holiday.date))),
    };
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
      let days = eachDay(leaveStart < start ? start : leaveStart, leaveEnd > end ? end : leaveEnd).filter(
        (day) => isWorkingDay(day, working),
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
        overtimeMinutes: Math.round(
          records.reduce((sum, record) => sum + Math.max(0, record.workedMinutes - scheduledMinutes), 0),
        ),
        lateDays: records.filter((record) => record.status === 'LATE').length,
      },
      leave: { paidDays, unpaidDays, byCode, refs },
      rules: payrollRules,
    };

    try {
      const result = computePayslip(context);
      netTotal = addMoney(netTotal, result.net);
      computedCount += 1;
      if (money(result.net).isNegative()) own.push(issue('NEGATIVE_NET', employee.id, 6));
      snapshotParts.push(
        JSON.stringify({ employeeId: employee.id, contractId: contract.id, input: context, net: result.net }),
      );
      evaluations.push({ employeeId: employee.id, contract, context, result, issues: own });
    } catch {
      own.push(issue('INVALID_RULE', employee.id, 6));
      evaluations.push({ employeeId: employee.id, contract, context, result: null, issues: own });
    }
    issues.push(...own);
  }

  const snapshotHash = createHash('sha256').update(snapshotParts.sort().join('\n')).digest('hex');
  const penalty = issues.reduce((sum, item) => sum + item.severity, 0);
  return {
    payrun,
    memberCount: payrun.employees.length,
    computedCount,
    netTotal: toMoneyString(netTotal),
    snapshotHash,
    issues,
    readinessScore: Math.max(0, 100 - penalty),
    evaluations,
  };
}

/**
 * Write the payslips a compute produced.
 *
 * A payslip is the durable output of payroll, not a value a screen recalculates
 * on every render. Each row keeps the complete input context and the formula
 * and rule version behind every line, so the "why is this number what it is"
 * answer stays correct even after the rule is later changed — the reason the
 * snapshot is stored in full rather than as a hash.
 */
export async function persistPayslips(db: Db, evaluation: PayrunEvaluation): Promise<number> {
  const { payrun } = evaluation;
  const keep = new Set<string>();
  let written = 0;

  for (const item of evaluation.evaluations) {
    if (!item.context || !item.result || !item.contract) continue;
    const id = `ps-${payrun.id}-${item.employeeId}`;
    keep.add(id);
    const input = {
      expectedDays: item.context.period.expectedDays,
      workedDays: Math.max(0, item.context.period.expectedDays - item.context.leave.unpaidDays),
      paidLeaveDays: item.context.leave.paidDays,
      unpaidLeaveDays: item.context.leave.unpaidDays,
      overtimeMinutes: item.context.attendance.overtimeMinutes,
      presentDays: item.context.attendance.presentDays,
      wage: item.context.contract.wage,
      context: item.context,
    } as unknown as Prisma.InputJsonValue;

    const common = {
      payrunId: payrun.id,
      employeeId: item.employeeId,
      contractId: item.contract.id,
      periodStart: payrun.periodStart,
      periodEnd: payrun.periodEnd,
      structureId: payrun.salaryStructureId,
      status: 'COMPUTED' as const,
      expectedDays: item.context.period.expectedDays,
      workedDays: Math.max(0, item.context.period.expectedDays - item.context.leave.unpaidDays),
      paidLeaveDays: item.context.leave.paidDays,
      unpaidLeaveDays: item.context.leave.unpaidDays,
      overtimeMinutes: item.context.attendance.overtimeMinutes,
      gross: item.result.gross,
      totalDeductions: item.result.totalDeductions,
      net: item.result.net,
      inputSnapshot: input,
      snapshotHash: evaluation.snapshotHash,
      computedAt: new Date(),
    };

    await db.payslip.upsert({
      where: { payrunId_employeeId: { payrunId: payrun.id, employeeId: item.employeeId } },
      create: { id, payslipRef: `PS-${payrun.id}-${item.employeeId}`, ...common },
      update: common,
    });
    // Lines are replaced wholesale: a recompute is a new answer, and keeping
    // the previous lines alongside it would make the payslip ambiguous.
    await db.payslipLine.deleteMany({ where: { payslipId: id } });
    await db.payslipLine.createMany({
      data: item.result.lines.map((line) => ({
        payslipId: id,
        ruleId: line.ruleId,
        ruleCode: line.ruleCode,
        ruleName: line.ruleName,
        ruleVersion: line.ruleVersion,
        category: line.category,
        sequence: line.sequence,
        formulaSnapshot: line.formulaSnapshot,
        inputsSnapshot: line.inputs as unknown as Prisma.InputJsonValue,
        sourceRefs: line.sourceRefs as unknown as Prisma.InputJsonValue,
        amount: line.amount,
      })),
    });
    written += 1;
  }

  // Someone removed from the run after a previous compute must not keep a
  // payslip: cancel it rather than delete it, so the history stays readable.
  await db.payslip.updateMany({
    where: { payrunId: payrun.id, id: { notIn: [...keep] }, status: { in: ['DRAFT', 'COMPUTED'] } },
    data: { status: 'CANCELLED' },
  });
  return written;
}

/** @deprecated Use `recordAudit`; kept so existing call sites stay valid. */
export async function writeAudit(
  db: Db,
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
) {
  await recordAudit(db, actor, { action, entityType, entityId, summary });
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
