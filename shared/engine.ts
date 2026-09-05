/**
 * The payroll engine.
 *
 * A pure function: snapshot in, lines out. It never reads a database and never
 * writes one. Every screen that shows a salary figure — the payrun totals, the
 * payslip list, the payslip document, the simulation, the comparison, the
 * reports — calls THIS, so no two screens can disagree.
 */
import { Decimal, addMoney, divideMoney, money, round, subtractMoney, toMoneyString } from './money.js';
import { evaluateCondition, evaluateFormula, FormulaError, validateFormula } from './formula.js';
import type { PayslipLine, RuleCategory, SalaryRule, SourceRef } from './types.js';

/* ── Context ───────────────────────────────────────────────── */

export interface PayrollContext {
  employee: { id: string; code: string; name: string; type: string };
  contract: {
    id: string;
    ref: string;
    wage: string;
    structureId: string;
    scheduleId: string;
  };
  period: { start: string; end: string; expectedDays: number; label: string };
  schedule: { id: string; name: string; hoursPerWeek: number };
  attendance: {
    presentDays: number;
    workedMinutes: number;
    overtimeMinutes: number;
    lateDays: number;
  };
  leave: {
    paidDays: number;
    unpaidDays: number;
    byCode: Record<string, number>;
    refs: SourceRef[];
  };
  rules: SalaryRule[];
}

/** Constants every formula may read, in addition to earlier rule codes. */
export function contextConstants(ctx: PayrollContext): Record<string, number> {
  const worked = Math.max(0, ctx.period.expectedDays - ctx.leave.unpaidDays);
  return {
    WAGE: money(ctx.contract.wage).toNumber(),
    EXPECTED_DAYS: ctx.period.expectedDays,
    WORKED_DAYS: worked,
    PRESENT_DAYS: ctx.attendance.presentDays,
    PAID_LEAVE_DAYS: ctx.leave.paidDays,
    UNPAID_LEAVE_DAYS: ctx.leave.unpaidDays,
    OVERTIME_HOURS: Math.round((ctx.attendance.overtimeMinutes / 60) * 100) / 100,
    LATE_DAYS: ctx.attendance.lateDays,
    HOURS_PER_WEEK: ctx.schedule.hoursPerWeek,
  };
}

/** Symbols available to a rule at position `index` in the ordered rule list. */
export function availableSymbols(rules: SalaryRule[], index: number): string[] {
  const constants = [
    'WAGE',
    'EXPECTED_DAYS',
    'WORKED_DAYS',
    'PRESENT_DAYS',
    'PAID_LEAVE_DAYS',
    'UNPAID_LEAVE_DAYS',
    'OVERTIME_HOURS',
    'LATE_DAYS',
    'HOURS_PER_WEEK',
  ];
  const earlier = rules
    .slice(0, index)
    .filter((r) => r.isActive)
    .map((r) => r.code);
  return [...constants, ...earlier];
}

/* ── Result ────────────────────────────────────────────────── */

export interface PayslipResult {
  lines: PayslipLine[];
  gross: string;
  totalDeductions: string;
  net: string;
  totals: Record<string, string>;
}

export class PayrollRuleError extends Error {
  ruleCode: string;
  override cause?: unknown;

  constructor(ruleCode: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'PayrollRuleError';
    this.ruleCode = ruleCode;
    this.cause = cause;
  }
}

function sortRules(rules: SalaryRule[]): SalaryRule[] {
  return [...rules]
    .filter((r) => r.isActive)
    .sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code));
}

function describeSources(
  rule: SalaryRule,
  ctx: PayrollContext,
  usedSymbols: string[],
): SourceRef[] {
  const refs: SourceRef[] = [
    { type: 'RULE', id: rule.id, label: `${rule.code} v${rule.ruleVersion}` },
  ];
  const wants = new Set(usedSymbols);
  if (rule.type === 'FIXED' || wants.has('WAGE') || rule.baseCode === 'BASIC') {
    refs.push({ type: 'CONTRACT', id: ctx.contract.id, label: ctx.contract.ref });
  }
  if (wants.has('UNPAID_LEAVE_DAYS') || wants.has('PAID_LEAVE_DAYS')) {
    refs.push(...ctx.leave.refs);
  }
  if (wants.has('PRESENT_DAYS') || wants.has('OVERTIME_HOURS') || wants.has('LATE_DAYS')) {
    refs.push({
      type: 'ATTENDANCE',
      id: `${ctx.employee.id}:${ctx.period.start}`,
      label: `Attendance ${ctx.period.label}`,
    });
  }
  if (wants.has('EXPECTED_DAYS') || wants.has('HOURS_PER_WEEK')) {
    refs.push({ type: 'SCHEDULE', id: ctx.schedule.id, label: ctx.schedule.name });
  }
  return refs;
}

const EARNING_CATEGORIES: RuleCategory[] = ['BASIC', 'ALLOWANCES'];

/**
 * Evaluate the ordered rule list against a context.
 *
 * Ordering is sequence-driven (Odoo semantics): a lower sequence computes
 * first and its result is available to later rules. Each result is rounded
 * half-up to 2dp exactly once, so GROSS and NET are sums of already-rounded
 * lines and the document always foots.
 */
export function computePayslip(ctx: PayrollContext): PayslipResult {
  const rules = sortRules(ctx.rules);
  const scope: Record<string, number> = contextConstants(ctx);
  const lines: PayslipLine[] = [];
  const totals: Record<string, string> = {};

  for (const rule of rules) {
    let amount: Decimal;
    let formulaSnapshot: string;
    let inputs: Record<string, number> = {};

    try {
      if (rule.conditionFormula) {
        if (!evaluateCondition(rule.conditionFormula, scope)) continue;
      }

      switch (rule.type) {
        case 'FIXED': {
          amount = money(rule.amount ?? 0);
          formulaSnapshot = toMoneyString(amount);
          break;
        }
        case 'PERCENTAGE': {
          const base = rule.baseCode ?? 'WAGE';
          if (!(base in scope)) {
            throw new PayrollRuleError(rule.code, `Base "${base}" is not available yet`);
          }
          const pct = money(rule.percentage ?? 0);
          amount = money(scope[base]).times(pct).div(100);
          formulaSnapshot = `${base} × ${pct.toString()}%`;
          inputs = { [base]: scope[base] };
          break;
        }
        case 'FORMULA': {
          const src = rule.formula ?? '0';
          const res = evaluateFormula(src, scope);
          amount = res.value;
          inputs = res.inputs;
          formulaSnapshot = src;
          break;
        }
        default:
          throw new PayrollRuleError(rule.code, `Unknown rule type "${rule.type}"`);
      }
    } catch (err) {
      if (err instanceof PayrollRuleError) throw err;
      if (err instanceof FormulaError) {
        throw new PayrollRuleError(rule.code, `${rule.code}: ${err.message}`, err);
      }
      throw new PayrollRuleError(rule.code, `${rule.code}: ${(err as Error).message}`, err);
    }

    // Round ONCE, here. Everything downstream sums rounded values.
    amount = round(amount);
    scope[rule.code] = amount.toNumber();
    totals[rule.code] = toMoneyString(amount);

    lines.push({
      ruleId: rule.id,
      ruleCode: rule.code,
      ruleName: rule.name,
      ruleVersion: rule.ruleVersion,
      category: rule.category,
      sequence: rule.sequence,
      formulaSnapshot,
      inputs: Object.fromEntries(
        Object.entries(inputs).map(([k, v]) => [k, formatSymbol(k, v)]),
      ),
      sourceRefs: describeSources(rule, ctx, Object.keys(inputs)),
      amount: toMoneyString(amount),
    });
  }

  const earnings = lines
    .filter((l) => EARNING_CATEGORIES.includes(l.category))
    .reduce<Decimal>((s, l) => addMoney(s, l.amount), money(0));
  const deductions = lines
    .filter((l) => l.category === 'DEDUCTIONS')
    .reduce<Decimal>((s, l) => addMoney(s, l.amount), money(0));

  // A GROSS/NET rule, when configured, is authoritative; otherwise derive.
  const grossLine = lines.find((l) => l.category === 'GROSS');
  const netLine = lines.find((l) => l.category === 'NET');
  const gross = grossLine ? money(grossLine.amount) : earnings;
  const net = netLine ? money(netLine.amount) : subtractMoney(gross, deductions);

  return {
    lines,
    gross: toMoneyString(gross),
    totalDeductions: toMoneyString(deductions),
    net: toMoneyString(net),
    totals,
  };
}

/** Symbol values are shown to humans; money-like symbols get money formatting. */
const DAY_SYMBOLS = new Set([
  'EXPECTED_DAYS',
  'WORKED_DAYS',
  'PRESENT_DAYS',
  'PAID_LEAVE_DAYS',
  'UNPAID_LEAVE_DAYS',
  'LATE_DAYS',
  'OVERTIME_HOURS',
  'HOURS_PER_WEEK',
]);

function formatSymbol(symbol: string, value: number): string {
  if (DAY_SYMBOLS.has(symbol)) return String(value);
  return toMoneyString(value);
}

/**
 * Assert the identity every payslip must satisfy:
 *   sum(earnings) − sum(deductions) === net
 * Run in tests over the whole dataset; a payslip that fails this is a bug.
 */
export function assertFoots(result: PayslipResult): void {
  const earnings = result.lines
    .filter((l) => EARNING_CATEGORIES.includes(l.category))
    .reduce<Decimal>((s, l) => addMoney(s, l.amount), money(0));
  const expected = subtractMoney(earnings, money(result.totalDeductions));
  if (!expected.equals(money(result.net))) {
    throw new Error(
      `Payslip does not foot: earnings ${toMoneyString(earnings)} − deductions ${result.totalDeductions} = ${toMoneyString(expected)}, but net is ${result.net}`,
    );
  }
}

/** Per-day value of a monthly wage — used by unpaid-leave rules and previews. */
export function perDay(wage: string, expectedDays: number): Decimal {
  return round(divideMoney(wage, expectedDays));
}

export { validateFormula, FormulaError };
