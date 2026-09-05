/**
 * Money — exact decimal arithmetic for payroll.
 *
 * Rules of the house:
 *  - Money never touches a JS `number`. It is a Decimal in memory and a
 *    fixed-2dp string ("55000.00") on the wire and in the database.
 *  - Rounding is half-up, applied ONCE at each salary-rule boundary, so a
 *    payslip's totals are sums of already-rounded lines and always foot.
 */
import { Decimal } from 'decimal.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export const MONEY_DP = 2;

/** A money amount serialised for transport: always 2 decimal places. */
export type MoneyString = string;

export type MoneyInput = Decimal | number | string;

export function money(value: MoneyInput = 0): Decimal {
  return new Decimal(value ?? 0);
}

/** Round half-up to 2dp. Every rule result passes through this exactly once. */
export function round(value: MoneyInput): Decimal {
  return money(value).toDecimalPlaces(MONEY_DP, Decimal.ROUND_HALF_UP);
}

export function addMoney(...values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((sum, v) => sum.plus(money(v)), money(0));
}

export function subtractMoney(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).minus(money(b));
}

export function multiplyRate(amount: MoneyInput, rate: MoneyInput): Decimal {
  return money(amount).times(money(rate));
}

export function divideMoney(amount: MoneyInput, divisor: MoneyInput): Decimal {
  const d = money(divisor);
  if (d.isZero()) return money(0);
  return money(amount).div(d);
}

/** Serialise for the API/DB. Always 2dp, never exponential. */
export function toMoneyString(value: MoneyInput): MoneyString {
  return round(value).toFixed(MONEY_DP);
}

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INR_WHOLE = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** ₹55,000.00 — for documents, tables and any figure that must reconcile. */
export function formatMoney(value: MoneyInput): string {
  return INR.format(round(value).toNumber());
}

/** ₹55,000 — for dense UI where paise add noise and never need to reconcile. */
export function formatMoneyWhole(value: MoneyInput): string {
  return INR_WHOLE.format(round(value).toNumber());
}

/** ₹28.4L / ₹1.2Cr — for KPI tiles and chart tooltips. Never for a payslip. */
export function formatMoneyShort(value: MoneyInput): string {
  const n = money(value).toNumber();
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

/** Signed delta, e.g. "+₹4,200.00" / "−₹1,150.00". */
export function formatDelta(value: MoneyInput): string {
  const d = round(value);
  if (d.isZero()) return formatMoney(0);
  return `${d.isNegative() ? '−' : '+'}${formatMoney(d.abs())}`;
}

export function isZero(value: MoneyInput): boolean {
  return money(value).isZero();
}

export function compareMoney(a: MoneyInput, b: MoneyInput): number {
  return money(a).comparedTo(money(b));
}

export { Decimal };
