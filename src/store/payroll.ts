/**
 * Payroll orchestration: context building, computation, exceptions, readiness.
 *
 * The arithmetic itself lives in `@shared/engine` and is shared with the
 * server. This module only assembles inputs and interprets results.
 */
import {
  computePayslip,
  PayrollRuleError,
  type PayrollContext,
} from '@shared/engine';
import { addMoney, money, subtractMoney, toMoneyString } from '@shared/money';
import type {
  Attendance,
  Contract,
  Employee,
  ExceptionCategory,
  Payrun,
  PayrollException,
  Payslip,
  Readiness,
  SourceRef,
} from '@shared/types';
import {
  countWorkingDays,
  diffDays,
  eachDay,
  isWorkingDay,
  monthLabel,
  rangeOverlaps,
  type ISODate,
  type WorkingDayContext,
} from '@shared/dates';
import type { AppState } from './state';
import { EXPIRY_HORIZON_DAYS } from '@/data/seed';

/* ── helpers ───────────────────────────────────────────────── */

export function scheduleCtx(state: AppState, scheduleId: string): WorkingDayContext {
  const sch = state.schedules.find((s) => s.id === scheduleId) ?? state.schedules[0];
  return {
    workingDows: sch.lines.map((l) => l.dayOfWeek),
    holidays: new Set(state.holidays.map((h) => h.date)),
  };
}

export class ContractResolutionError extends Error {
  kind: 'NO_CONTRACT' | 'AMBIGUOUS_CONTRACT';
  candidates: Contract[];

  constructor(kind: 'NO_CONTRACT' | 'AMBIGUOUS_CONTRACT', message: string, candidates: Contract[] = []) {
    super(message);
    this.kind = kind;
    this.candidates = candidates;
  }
}

/**
 * Exactly one contract, or a typed error. Never a silent default —
 * ambiguity is a payroll blocker, not something to guess through.
 */
export function resolveContract(
  state: AppState,
  employeeId: string,
  periodStart: ISODate,
  periodEnd: ISODate,
): Contract {
  const candidates = state.contracts.filter(
    (c) =>
      c.employeeId === employeeId &&
      c.status !== 'DRAFT' &&
      rangeOverlaps(c.startDate, c.endDate, periodStart, periodEnd),
  );
  if (candidates.length === 0) {
    throw new ContractResolutionError('NO_CONTRACT', 'No contract covers this period');
  }
  const active = candidates.filter((c) => c.status === 'ACTIVE');
  const chosen = active.length > 0 ? active : candidates;
  if (chosen.length > 1) {
    throw new ContractResolutionError(
      'AMBIGUOUS_CONTRACT',
      `${chosen.length} contracts apply to this period (${chosen.map((c) => c.contractRef).join(', ')})`,
      chosen,
    );
  }
  return chosen[0];
}

export function attendanceInPeriod(
  state: AppState,
  employeeId: string,
  start: ISODate,
  end: ISODate,
): Attendance[] {
  return state.attendance.filter(
    (a) => a.employeeId === employeeId && a.date >= start && a.date <= end,
  );
}

/** Leave days that fall on the employee's own working days inside the period. */
export function leaveDaysInPeriod(
  state: AppState,
  employeeId: string,
  start: ISODate,
  end: ISODate,
  ctx: WorkingDayContext,
) {
  let paid = 0;
  let unpaid = 0;
  const byCode: Record<string, number> = {};
  const refs: SourceRef[] = [];

  for (const req of state.leaveRequests) {
    if (req.employeeId !== employeeId || req.status !== 'APPROVED') continue;
    if (!rangeOverlaps(req.fromDate, req.toDate, start, end)) continue;
    const type = state.leaveTypes.find((t) => t.id === req.leaveTypeId);
    if (!type) continue;

    let days = 0;
    for (const day of eachDay(
      req.fromDate < start ? start : req.fromDate,
      req.toDate > end ? end : req.toDate,
    )) {
      if (isWorkingDay(day, ctx)) days += 1;
    }
    if (days === 0) continue;
    if (req.halfDayStart && req.fromDate >= start) days -= 0.5;
    if (req.halfDayEnd && req.toDate <= end && req.fromDate !== req.toDate) days -= 0.5;

    byCode[type.code] = (byCode[type.code] ?? 0) + days;
    if (type.isPaid) paid += days;
    else unpaid += days;
    refs.push({ type: 'LEAVE', id: req.id, label: `${type.name} ${req.id}` });
  }

  return { paid, unpaid, byCode, refs };
}

export function buildContext(state: AppState, employeeId: string, payrun: Payrun): PayrollContext {
  const employee = state.employees.find((e) => e.id === employeeId);
  if (!employee) throw new Error(`Unknown employee ${employeeId}`);
  const contract = resolveContract(state, employeeId, payrun.periodStart, payrun.periodEnd);
  const ctx = scheduleCtx(state, contract.workingScheduleId);
  const schedule =
    state.schedules.find((s) => s.id === contract.workingScheduleId) ?? state.schedules[0];

  const expectedDays = countWorkingDays(payrun.periodStart, payrun.periodEnd, ctx);
  const records = attendanceInPeriod(state, employeeId, payrun.periodStart, payrun.periodEnd);
  const leave = leaveDaysInPeriod(state, employeeId, payrun.periodStart, payrun.periodEnd, ctx);

  const scheduledMinutes = schedule.lines.length
    ? (schedule.hoursPerWeek * 60) / schedule.lines.length
    : 480;
  const overtimeMinutes = records.reduce(
    (sum, r) => sum + Math.max(0, r.workedMinutes - scheduledMinutes),
    0,
  );

  return {
    employee: {
      id: employee.id,
      code: employee.employeeCode,
      name: employee.fullName,
      type: employee.employeeType,
    },
    contract: {
      id: contract.id,
      ref: contract.contractRef,
      wage: contract.wage,
      structureId: contract.salaryStructureId,
      scheduleId: contract.workingScheduleId,
    },
    period: {
      start: payrun.periodStart,
      end: payrun.periodEnd,
      expectedDays,
      label: monthLabel(payrun.periodStart),
    },
    schedule: { id: schedule.id, name: schedule.name, hoursPerWeek: schedule.hoursPerWeek },
    attendance: {
      presentDays: records.filter((r) => r.status !== 'ABSENT' && r.checkIn).length,
      workedMinutes: records.reduce((s, r) => s + r.workedMinutes, 0),
      overtimeMinutes: Math.round(overtimeMinutes),
      lateDays: records.filter((r) => r.status === 'LATE').length,
    },
    leave: {
      paidDays: leave.paid,
      unpaidDays: leave.unpaid,
      byCode: leave.byCode,
      refs: leave.refs,
    },
    rules: state.salaryRules.filter((r) => r.structureId === contract.salaryStructureId),
  };
}

/** Deterministic content hash of the inputs a payslip was computed from. */
export function snapshotHash(ctx: PayrollContext): string {
  const canonical = JSON.stringify({
    w: ctx.contract.wage,
    c: ctx.contract.id,
    p: [ctx.period.start, ctx.period.end, ctx.period.expectedDays],
    a: [ctx.attendance.presentDays, ctx.attendance.workedMinutes, ctx.attendance.overtimeMinutes],
    l: [ctx.leave.paidDays, ctx.leave.unpaidDays],
    r: ctx.rules.map((r) => `${r.code}:${r.ruleVersion}:${r.type}:${r.amount ?? ''}:${r.percentage ?? ''}:${r.formula ?? ''}`),
  });
  let h = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface ComputeOutcome {
  payslips: Payslip[];
  failures: { employeeId: string; message: string; kind: PayrollException['kind'] }[];
}

/**
 * Compute every payslip for a payrun. Inputs are gathered per employee, but
 * the arithmetic is the shared engine — the same code the server runs.
 */
export function computePayrun(state: AppState, payrun: Payrun, at: string): ComputeOutcome {
  const payslips: Payslip[] = [];
  const failures: ComputeOutcome['failures'] = [];
  let n = 0;

  for (const employeeId of payrun.employeeIds) {
    const employee = state.employees.find((e) => e.id === employeeId);
    if (!employee || employee.status === 'ARCHIVED') continue;

    let ctx: PayrollContext;
    try {
      ctx = buildContext(state, employeeId, payrun);
    } catch (err) {
      if (err instanceof ContractResolutionError) {
        failures.push({ employeeId, message: err.message, kind: err.kind });
      } else {
        failures.push({ employeeId, message: (err as Error).message, kind: 'INVALID_RULE' });
      }
      continue;
    }

    let result;
    try {
      result = computePayslip(ctx);
    } catch (err) {
      const message =
        err instanceof PayrollRuleError ? err.message : (err as Error).message;
      failures.push({ employeeId, message, kind: 'INVALID_RULE' });
      continue;
    }

    n += 1;
    const base: Payslip = {
      id: `${payrun.id}-${employeeId}`,
      payslipRef: `PS-${payrun.periodStart.slice(0, 7).replace('-', '')}-${String(n).padStart(4, '0')}`,
      payrunId: payrun.id,
      employeeId,
      contractId: ctx.contract.id,
      periodStart: payrun.periodStart,
      periodEnd: payrun.periodEnd,
      structureId: ctx.contract.structureId,
      status: payrun.status === 'PAID' ? 'PAID' : payrun.status === 'VALIDATED' ? 'VALIDATED' : 'COMPUTED',
      lines: result.lines,
      gross: result.gross,
      totalDeductions: result.totalDeductions,
      net: result.net,
      input: {
        expectedDays: ctx.period.expectedDays,
        workedDays: Math.max(0, ctx.period.expectedDays - ctx.leave.unpaidDays),
        paidLeaveDays: ctx.leave.paidDays,
        unpaidLeaveDays: ctx.leave.unpaidDays,
        overtimeMinutes: ctx.attendance.overtimeMinutes,
        presentDays: ctx.attendance.presentDays,
        wage: ctx.contract.wage,
      },
      snapshotHash: snapshotHash(ctx),
      computedAt: at,
      isDuplicate: false,
      delivery: 'PENDING',
      deliveryError: null,
      deliveredAt: null,
      paymentStatus: 'UNPAID',
    };
    payslips.push(base);
  }

  return { payslips, failures };
}

/** The seeded duplicate: a second payslip row for one employee in one period. */
export function makeDuplicate(original: Payslip): Payslip {
  return {
    ...original,
    id: `${original.id}-dup`,
    payslipRef: `${original.payslipRef}-D`,
    isDuplicate: true,
    computedAt: original.computedAt,
  };
}

/* ── exceptions ────────────────────────────────────────────── */

const CATEGORY_LABEL: Record<ExceptionCategory, string> = {
  CONTRACT: 'Contracts',
  BANK: 'Bank details',
  ATTENDANCE: 'Attendance',
  LEAVE: 'Leave',
  PAYSLIP: 'Payslip integrity',
  RULE: 'Salary rules',
};

export function computeExceptions(state: AppState, payrun: Payrun): PayrollException[] {
  const out: PayrollException[] = [];
  const byId = new Map(state.employees.map((e) => [e.id, e]));
  const slips = state.payslips.filter((p) => p.payrunId === payrun.id);

  for (const employeeId of payrun.employeeIds) {
    const emp = byId.get(employeeId);
    if (!emp || emp.status === 'ARCHIVED') continue;

    /* contract */
    try {
      resolveContract(state, employeeId, payrun.periodStart, payrun.periodEnd);
    } catch (err) {
      const e = err as ContractResolutionError;
      out.push({
        id: `exc-contract-${employeeId}`,
        kind: e.kind === 'AMBIGUOUS_CONTRACT' ? 'AMBIGUOUS_CONTRACT' : 'NO_CONTRACT',
        category: 'CONTRACT',
        severity: 6,
        blocking: true,
        employeeId,
        title: e.kind === 'AMBIGUOUS_CONTRACT' ? 'Ambiguous contract' : 'No applicable contract',
        detail: e.message,
        resolution: 'CONTRACT',
        refId: null,
      });
      continue;
    }

    /* bank */
    if (!emp.bank || !emp.bank.verifiedAt) {
      out.push({
        id: `exc-bank-${employeeId}`,
        kind: 'MISSING_BANK',
        category: 'BANK',
        severity: 5,
        blocking: true,
        employeeId,
        title: 'Missing bank details',
        detail: 'Verified bank account required before salary can be transferred.',
        resolution: 'BANK_DETAILS',
        refId: null,
      });
    }

    /* attendance: an open check-in inside the period */
    const open = state.attendance.find(
      (a) =>
        a.employeeId === employeeId &&
        a.date >= payrun.periodStart &&
        a.date <= payrun.periodEnd &&
        a.checkIn &&
        !a.checkOut,
    );
    if (open) {
      out.push({
        id: `exc-att-${open.id}`,
        kind: 'MISSING_CHECKOUT',
        category: 'ATTENDANCE',
        severity: 4,
        blocking: true,
        employeeId,
        title: 'Missing checkout',
        detail: `Checked in at ${open.checkIn} on ${open.date} with no checkout recorded.`,
        resolution: 'ATTENDANCE_CHECKOUT',
        refId: open.id,
      });
    }

    /* onboarding items that block payroll */
    const checklist = state.checklists.find(
      (c) => c.employeeId === employeeId && c.type === 'ONBOARDING',
    );
    const blockingItem = checklist?.items.find((i) => i.blocksPayroll && !i.completedAt);
    if (blockingItem && emp.bank?.verifiedAt) {
      out.push({
        id: `exc-onb-${blockingItem.id}`,
        kind: 'ONBOARDING_INCOMPLETE',
        category: 'CONTRACT',
        severity: 3,
        blocking: true,
        employeeId,
        title: 'Onboarding incomplete',
        detail: `${blockingItem.label} is still outstanding.`,
        resolution: 'REVIEW',
        refId: blockingItem.id,
      });
    }

    /* pending leave overlapping the period (warning only) */
    const pending = state.leaveRequests.find(
      (r) =>
        r.employeeId === employeeId &&
        r.status === 'PENDING' &&
        rangeOverlaps(r.fromDate, r.toDate, payrun.periodStart, payrun.periodEnd),
    );
    if (pending) {
      out.push({
        id: `exc-leave-${pending.id}`,
        kind: 'UNAPPROVED_LEAVE',
        category: 'LEAVE',
        severity: 2,
        blocking: false,
        employeeId,
        title: 'Leave awaiting decision',
        detail: `${pending.fromDate} → ${pending.toDate} is still pending and may change this payslip.`,
        resolution: 'REVIEW',
        refId: pending.id,
      });
    }
  }

  /* duplicate payslips */
  const seen = new Map<string, number>();
  for (const s of slips) {
    seen.set(s.employeeId, (seen.get(s.employeeId) ?? 0) + 1);
  }
  for (const [employeeId, count] of seen) {
    if (count > 1) {
      out.push({
        id: `exc-dup-${employeeId}`,
        kind: 'DUPLICATE_PAYSLIP',
        category: 'PAYSLIP',
        severity: 4,
        blocking: true,
        employeeId,
        title: 'Duplicate payslip',
        detail: `${count} payslips exist for this employee in ${monthLabel(payrun.periodStart)}.`,
        resolution: 'REMOVE_DUPLICATE',
        refId: slips.find((s) => s.employeeId === employeeId && s.isDuplicate)?.id ?? null,
      });
    }
  }

  /* negative net */
  for (const s of slips) {
    if (money(s.net).isNegative()) {
      out.push({
        id: `exc-neg-${s.id}`,
        kind: 'NEGATIVE_NET',
        category: 'PAYSLIP',
        severity: 6,
        blocking: true,
        employeeId: s.employeeId,
        title: 'Negative net pay',
        detail: `Computed net is ${s.net}. Deductions exceed earnings.`,
        resolution: 'REVIEW',
        refId: s.id,
      });
    }
  }

  /* variance guard (Y02) */
  const prev = state.payruns
    .filter((p) => p.periodStart < payrun.periodStart)
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0];
  if (prev) {
    const threshold = state.settings.varianceThresholdPercent;
    for (const s of slips.filter((x) => !x.isDuplicate)) {
      const before = state.payslips.find(
        (p) => p.payrunId === prev.id && p.employeeId === s.employeeId && !p.isDuplicate,
      );
      if (!before) continue;
      const prevNet = money(before.net);
      if (prevNet.isZero()) continue;
      const pct = subtractMoney(s.net, prevNet).div(prevNet).times(100);
      const abs = pct.abs().toNumber();
      if (abs >= threshold) {
        out.push({
          id: `exc-var-${s.id}`,
          kind: 'SALARY_VARIANCE',
          category: 'PAYSLIP',
          severity: abs >= 60 ? 5 : 3,
          blocking: abs >= 60,
          employeeId: s.employeeId,
          title: 'Unusual salary change',
          detail: `Net ${s.net} vs ${before.net} last period (${pct.toDecimalPlaces(1).toString()}%).`,
          resolution: 'REVIEW',
          refId: s.id,
        });
      }
    }
  }

  /* leaver still paid */
  for (const s of slips) {
    const emp = byId.get(s.employeeId);
    if (emp?.exitDate && emp.exitDate < payrun.periodStart) {
      out.push({
        id: `exc-leaver-${s.id}`,
        kind: 'LEAVER_PAID',
        category: 'PAYSLIP',
        severity: 6,
        blocking: true,
        employeeId: s.employeeId,
        title: 'Payslip for a leaver',
        detail: `${emp.fullName} exited on ${emp.exitDate}, before this period started.`,
        resolution: 'REVIEW',
        refId: s.id,
      });
    }
  }

  /* duplicate bank account across employees */
  const accounts = new Map<string, string[]>();
  for (const e of state.employees) {
    if (!e.bank?.accountNumberMasked) continue;
    const key = `${e.bank.bankName}|${e.bank.accountNumberMasked}`;
    accounts.set(key, [...(accounts.get(key) ?? []), e.id]);
  }
  for (const [, ids] of accounts) {
    if (ids.length > 1 && ids.some((id) => payrun.employeeIds.includes(id))) {
      out.push({
        id: `exc-bankdup-${ids.join('-')}`,
        kind: 'DUPLICATE_BANK_ACCOUNT',
        category: 'BANK',
        severity: 5,
        blocking: true,
        employeeId: ids[0],
        title: 'Duplicate bank account',
        detail: `The same account is registered for ${ids.length} employees.`,
        resolution: 'BANK_DETAILS',
        refId: null,
      });
    }
  }

  /* contract expiring inside or shortly after the period */
  for (const c of state.contracts) {
    if (c.status !== 'ACTIVE' || !c.endDate) continue;
    if (!payrun.employeeIds.includes(c.employeeId)) continue;
    const daysLeft = diffDays(c.endDate, state.today);
    if (daysLeft >= 0 && daysLeft <= EXPIRY_HORIZON_DAYS) {
      out.push({
        id: `exc-exp-${c.id}`,
        kind: 'CONTRACT_EXPIRING',
        category: 'CONTRACT',
        severity: 1,
        blocking: false,
        employeeId: c.employeeId,
        title: 'Contract expiring',
        detail: `${c.contractRef} ends on ${c.endDate} — ${daysLeft} day${daysLeft === 1 ? '' : 's'} from today.`,
        resolution: 'CONTRACT',
        refId: c.id,
      });
    }
  }

  return out.sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.severity - a.severity);
}

/**
 * Readiness. The ring is 100 minus the summed severity of open BLOCKING
 * exceptions; the category bars are real pass ratios. Both derive from the
 * same list, so they can never disagree.
 */
export function computeReadiness(
  exceptions: PayrollException[],
  payrun: Payrun,
): Readiness {
  const blocking = exceptions.filter((e) => e.blocking);
  const penalty = blocking.reduce((s, e) => s + e.severity, 0);
  const total = Math.max(1, payrun.employeeIds.length);

  const categories: ExceptionCategory[] = ['CONTRACT', 'BANK', 'ATTENDANCE', 'LEAVE', 'PAYSLIP'];
  return {
    score: Math.max(0, Math.min(100, 100 - penalty)),
    blockingCount: blocking.length,
    warningCount: exceptions.length - blocking.length,
    categories: categories.map((category) => {
      const failing = new Set(
        exceptions.filter((e) => e.category === category && e.blocking).map((e) => e.employeeId),
      );
      const passing = total - failing.size;
      return {
        category,
        label: CATEGORY_LABEL[category],
        passing,
        total,
        percent: Math.round((passing / total) * 100),
      };
    }),
  };
}

/* ── totals ────────────────────────────────────────────────── */

export interface PayrunTotals {
  gross: string;
  deductions: string;
  net: string;
  count: number;
}

export function payrunTotals(payslips: Payslip[]): PayrunTotals {
  const live = payslips.filter((p) => !p.isDuplicate && p.status !== 'CANCELLED');
  return {
    gross: toMoneyString(live.reduce((s, p) => addMoney(s, p.gross), money(0))),
    deductions: toMoneyString(live.reduce((s, p) => addMoney(s, p.totalDeductions), money(0))),
    net: toMoneyString(live.reduce((s, p) => addMoney(s, p.net), money(0))),
    count: live.length,
  };
}

/** Payroll KPI wording must follow the payrun's real state, not wishful naming. */
export function netLabel(status: Payrun['status']): string {
  return status === 'PAID' ? 'Total Net Salary Paid' : 'Estimated Net Payroll';
}

export function employeeOf(state: AppState, id: string | null): Employee | undefined {
  if (!id) return undefined;
  return state.employees.find((e) => e.id === id);
}
