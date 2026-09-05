/**
 * Calendar helpers. Everything payroll-facing is computed from a schedule and
 * a holiday calendar — never from a hardcoded "22 working days".
 *
 * All dates are handled as plain ISO day strings ("2026-09-05") in local terms;
 * no timezone conversion happens anywhere in the payroll path.
 */

export type ISODate = string;

const DAY_MS = 86_400_000;

export function toISO(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISO(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(a).getTime() - parseISO(b).getTime()) / DAY_MS);
}

export function dayOfWeek(iso: ISODate): number {
  return parseISO(iso).getDay();
}

export function isBetween(iso: ISODate, start: ISODate, end: ISODate | null): boolean {
  if (iso < start) return false;
  if (end && iso > end) return false;
  return true;
}

export function rangeOverlaps(
  aStart: ISODate,
  aEnd: ISODate | null,
  bStart: ISODate,
  bEnd: ISODate | null,
): boolean {
  const aE = aEnd ?? '9999-12-31';
  const bE = bEnd ?? '9999-12-31';
  return aStart <= bE && bStart <= aE;
}

export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard++ < 800) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function monthStart(iso: ISODate): ISODate {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function monthEnd(iso: ISODate): ISODate {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function addMonths(iso: ISODate, months: number): ISODate {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + months, d.getDate()));
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthLabel(iso: ISODate): string {
  const d = parseISO(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function monthShort(iso: ISODate): string {
  const d = parseISO(iso);
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${String(d.getFullYear()).slice(2)}`;
}

/** "05 Sep 2026" — the document convention used throughout the product. */
export function formatDate(iso: ISODate | null | undefined): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

/** "Mon 07 Sep" — for shift and calendar contexts. */
export function formatDayDate(iso: ISODate): string {
  const d = parseISO(iso);
  return `${DAYS[d.getDay()].slice(0, 3)} ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

export function formatDateTime(isoInstant: string): string {
  const d = new Date(isoInstant);
  if (Number.isNaN(d.getTime())) return isoInstant;
  const date = `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${date}, ${time}`;
}

export function relativeTime(isoInstant: string, now = new Date()): string {
  const then = new Date(isoInstant).getTime();
  const secs = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  const days = Math.round(secs / 86400);
  if (days < 30) return `${days}d ago`;
  return formatDate(toISO(new Date(then)));
}

/* ── Time of day ───────────────────────────────────────────── */

export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function fromMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "8h 45m" — worked-duration display. */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

/* ── Working days ──────────────────────────────────────────── */

export interface WorkingDayContext {
  workingDows: number[];
  holidays: Set<ISODate>;
}

export function isWorkingDay(iso: ISODate, ctx: WorkingDayContext): boolean {
  if (ctx.holidays.has(iso)) return false;
  return ctx.workingDows.includes(dayOfWeek(iso));
}

export function countWorkingDays(start: ISODate, end: ISODate, ctx: WorkingDayContext): number {
  return eachDay(start, end).filter((d) => isWorkingDay(d, ctx)).length;
}

/** The next scheduled shift on or after `from`, honouring weekly offs and holidays. */
export function nextWorkingDay(from: ISODate, ctx: WorkingDayContext): ISODate | null {
  let cur = from;
  for (let i = 0; i < 30; i++) {
    if (isWorkingDay(cur, ctx)) return cur;
    cur = addDays(cur, 1);
  }
  return null;
}
