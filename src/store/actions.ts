/**
 * Mutations. Every visible control routes to exactly one of these.
 *
 * House rules:
 *  - A toast confirms a completed mutation; a toast is never the mutation.
 *  - Resolving an exception fixes the underlying record. There is no
 *    `resolved = true` flag anywhere in this file.
 *  - Every privileged or salary-affecting change writes an audit event.
 */
import { addMoney, money, subtractMoney, toMoneyString } from '@shared/money';
import type {
  Attendance,
  AuditEvent,
  Contract,
  Employee,
  EmployeeType,
  LeaveRequest,
  Payrun,
  Payslip,
  Role,
} from '@shared/types';
import {
  addDays,
  addMonths,
  countWorkingDays,
  eachDay,
  formatDate,
  fromMinutes,
  isWorkingDay,
  minutesOfDay,
  monthEnd,
  monthLabel,
  monthStart,
  rangeOverlaps,
  type ISODate,
} from '@shared/dates';
import { getState, nextId, setState } from './store';
import { ROLE_TO_USER, type AppState } from './state';
import {
  computePayrun,
  makeDuplicate,
  resolveContract,
  scheduleCtx,
  ContractResolutionError,
} from './payroll';
import { currentUser, currentContract, exceptionsFor, payslipsOf } from './selectors';
import { DUPLICATE_PAYSLIP_EMPLOYEE } from '@/data/seed';

/* ── result envelope ───────────────────────────────────────── */

export type ActionResult<T = void> =
  | { ok: true; value: T; message: string }
  | { ok: false; error: string; field?: string };

const ok = <T,>(value: T, message = ''): ActionResult<T> => ({ ok: true, value, message });
const fail = (error: string, field?: string): ActionResult<never> => ({ ok: false, error, field });

/* ── audit ─────────────────────────────────────────────────── */

function audit(
  draft: AppState,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  actorRole?: Role | 'SYSTEM',
): void {
  const user = currentUser(draft);
  const event: AuditEvent = {
    id: `aud-${draft.seq + 1}-${entityId}`,
    at: new Date().toISOString(),
    actorId: actorRole === 'SYSTEM' ? 'system' : user.id,
    actorName: actorRole === 'SYSTEM' ? 'PeoplePay360' : user.displayName,
    actorRole: actorRole ?? user.role,
    action,
    entityType,
    entityId,
    summary,
  };
  draft.audit = [event, ...draft.audit];
}

/* ── session ───────────────────────────────────────────────── */

export function switchRole(role: Role): ActionResult {
  setState((d) => {
    d.currentUserId = ROLE_TO_USER[role];
  });
  return ok(undefined, `Signed in as ${role.replace(/_/g, ' ').toLowerCase()}`);
}

/* ── payroll lifecycle ─────────────────────────────────────── */

export function computeActivePayrun(): ActionResult<{ count: number; failures: number }> {
  const s = getState();
  const payrun = s.payruns.find((p) => p.id === s.activePayrunId);
  if (!payrun) return fail('No active payrun');
  if (payrun.status === 'VALIDATED' || payrun.status === 'PAID') {
    return fail(`A ${payrun.status.toLowerCase()} payrun cannot be recomputed. Reopen it first.`);
  }
  if (payrun.isFrozen) {
    return fail('Inputs are frozen for this period. Unfreeze before recomputing.');
  }
  if (payrun.employeeIds.length === 0) {
    return fail('Select at least one employee before computing.');
  }

  const at = new Date().toISOString();
  const outcome = computePayrun(s, payrun, at);

  setState((d) => {
    const pr = d.payruns.find((p) => p.id === payrun.id)!;
    let slips = outcome.payslips;

    // The seeded duplicate exists until an operator removes it.
    const dupSource = slips.find((p) => p.employeeId === DUPLICATE_PAYSLIP_EMPLOYEE);
    const alreadyRemoved = d.payslips.some(
      (p) => p.payrunId === pr.id && p.employeeId === DUPLICATE_PAYSLIP_EMPLOYEE && p.status === 'CANCELLED',
    );
    const duplicateCleared = d.payslips.length > 0 && !d.payslips.some((p) => p.isDuplicate && p.payrunId === pr.id) && d.payslips.some((p) => p.payrunId === pr.id);
    if (dupSource && !alreadyRemoved && !duplicateCleared) {
      slips = [...slips, makeDuplicate(dupSource)];
    }

    d.payslips = [...d.payslips.filter((p) => p.payrunId !== pr.id), ...slips];
    pr.status = pr.status === 'DRAFT' ? 'COMPUTED' : pr.status;
    pr.computedAt = at;
    pr.inputSnapshotHash = slips.map((p) => p.snapshotHash).join('').slice(0, 16);
    pr.version += 1;
    if (d.settings.autoFreezeAtCutoff) pr.isFrozen = true;

    audit(
      d,
      'PAYRUN_COMPUTED',
      'Payrun',
      pr.id,
      `${monthLabel(pr.periodStart)} computed — ${slips.filter((p) => !p.isDuplicate).length} payslips`,
    );
  });

  const message =
    outcome.failures.length > 0
      ? `Computed ${outcome.payslips.length} payslips · ${outcome.failures.length} could not be computed`
      : `Computed ${outcome.payslips.length} payslips`;
  return ok({ count: outcome.payslips.length, failures: outcome.failures.length }, message);
}

/** Boot-time compute so the demo opens on a COMPUTED payrun, exactly as seeded. */
export function bootstrapPayroll(): void {
  const s = getState();
  for (const pr of s.payruns) {
    if (pr.status === 'DRAFT') continue;
    const at = pr.computedAt ?? new Date().toISOString();
    const outcome = computePayrun(s, pr, at);
    setState((d) => {
      d.payslips = [
        ...d.payslips.filter((p) => p.payrunId !== pr.id),
        ...outcome.payslips.map((p) => ({
          ...p,
          status: (pr.status === 'PAID' ? 'PAID' : 'COMPUTED') as Payslip['status'],
          delivery: (pr.status === 'PAID' ? 'SENT' : 'PENDING') as Payslip['delivery'],
          deliveredAt: pr.status === 'PAID' ? pr.paidAt : null,
          paymentStatus: (pr.status === 'PAID' ? 'PAID' : 'UNPAID') as Payslip['paymentStatus'],
        })),
      ];
    });
  }
  // Then compute the open period, which seeds the three demo blockers.
  computeActivePayrun();
}

export function validateActivePayrun(): ActionResult {
  const s = getState();
  const payrun = s.payruns.find((p) => p.id === s.activePayrunId);
  if (!payrun) return fail('No active payrun');
  if (payrun.status !== 'COMPUTED') {
    return fail(`Only a computed payrun can be validated (currently ${payrun.status}).`);
  }
  const blocking = exceptionsFor(s, payrun).filter((e) => e.blocking);
  if (blocking.length > 0) {
    return fail(
      `${blocking.length} blocking exception${blocking.length === 1 ? '' : 's'} must be resolved first.`,
    );
  }

  setState((d) => {
    const pr = d.payruns.find((p) => p.id === payrun.id)!;
    pr.status = 'VALIDATED';
    pr.validatedAt = new Date().toISOString();
    pr.version += 1;
    d.payslips = d.payslips.map((p) =>
      p.payrunId === pr.id && p.status !== 'CANCELLED' ? { ...p, status: 'VALIDATED' } : p,
    );
    audit(d, 'PAYRUN_VALIDATED', 'Payrun', pr.id, `${monthLabel(pr.periodStart)} validated with 0 blockers`);
  });
  return ok(undefined, `${monthLabel(payrun.periodStart)} payroll validated`);
}

export function markActivePayrunPaid(): ActionResult {
  const s = getState();
  const payrun = s.payruns.find((p) => p.id === s.activePayrunId);
  if (!payrun) return fail('No active payrun');
  if (payrun.status !== 'VALIDATED') {
    return fail('Payroll must be validated before it can be marked paid.');
  }

  setState((d) => {
    const pr = d.payruns.find((p) => p.id === payrun.id)!;
    pr.status = 'PAID';
    pr.paidAt = new Date().toISOString();
    pr.isFrozen = true;
    pr.version += 1;
    d.payslips = d.payslips.map((p) =>
      p.payrunId === pr.id && p.status !== 'CANCELLED'
        ? { ...p, status: 'PAID', paymentStatus: 'PAID' }
        : p,
    );
    audit(d, 'PAYRUN_PAID', 'Payrun', pr.id, `${monthLabel(pr.periodStart)} marked paid`);
  });
  return ok(undefined, `${monthLabel(payrun.periodStart)} payroll marked paid`);
}

export function setPayrunFrozen(frozen: boolean, reason?: string): ActionResult {
  const s = getState();
  const payrun = s.payruns.find((p) => p.id === s.activePayrunId);
  if (!payrun) return fail('No active payrun');
  if (!frozen && s.settings.requireReopenReason && !reason?.trim()) {
    return fail('A reason is required to unfreeze this period.', 'reason');
  }
  setState((d) => {
    const pr = d.payruns.find((p) => p.id === payrun.id)!;
    pr.isFrozen = frozen;
    pr.frozenAt = frozen ? new Date().toISOString() : null;
    if (!frozen && reason) pr.reopenReason = reason;
    audit(
      d,
      frozen ? 'PAYRUN_FROZEN' : 'PAYRUN_UNFROZEN',
      'Payrun',
      pr.id,
      frozen ? 'Inputs frozen for the period' : `Inputs unfrozen — ${reason}`,
    );
  });
  return ok(undefined, frozen ? 'Inputs frozen for this period' : 'Inputs unfrozen');
}

export function reopenPayrun(reason: string): ActionResult {
  const s = getState();
  const payrun = s.payruns.find((p) => p.id === s.activePayrunId);
  if (!payrun) return fail('No active payrun');
  if (payrun.status !== 'PAID') return fail('Only a paid payrun can be reopened.');
  if (!reason.trim()) return fail('A reason is required to reopen paid payroll.', 'reason');

  setState((d) => {
    const pr = d.payruns.find((p) => p.id === payrun.id)!;
    pr.status = 'COMPUTED';
    pr.paidAt = null;
    pr.validatedAt = null;
    pr.isFrozen = false;
    pr.reopenReason = reason;
    pr.version += 1;
    d.payslips = d.payslips.map((p) =>
      p.payrunId === pr.id && p.status !== 'CANCELLED' ? { ...p, status: 'COMPUTED' } : p,
    );
    audit(d, 'PAYRUN_REOPENED', 'Payrun', pr.id, `Reopened paid payroll — ${reason}`);
  });
  return ok(undefined, 'Payroll reopened. All changes are audited.');
}

/** X07 — clone the previous period: selection and structure, never money. */
export function createPayrunFromPrevious(): ActionResult<{ id: string; added: string[]; removed: string[] }> {
  const s = getState();
  const latest = [...s.payruns].sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0];
  if (!latest) return fail('No previous payrun to clone.');
  const anchor = addMonths(latest.periodStart, 1);
  const start = monthStart(anchor);
  const end = monthEnd(anchor);
  const id = `PR-${start.slice(0, 7)}`;
  if (s.payruns.some((p) => p.id === id)) {
    return fail(`${monthLabel(start)} payroll already exists.`);
  }

  const eligible = s.employees
    .filter((e) => e.status !== 'ARCHIVED' && e.status !== 'EXITED' && e.joinDate <= end)
    .map((e) => e.id);
  const added = eligible.filter((x) => !latest.employeeIds.includes(x));
  const removed = latest.employeeIds.filter((x) => !eligible.includes(x));

  setState((d) => {
    const payrun: Payrun = {
      id,
      name: `${monthLabel(start)} Payroll`,
      periodStart: start,
      periodEnd: end,
      salaryStructureId: latest.salaryStructureId,
      status: 'DRAFT',
      isFrozen: false,
      frozenAt: null,
      reopenReason: null,
      expectedWorkDays: countWorkingDays(start, end, scheduleCtx(d, 'sch-std')),
      computedAt: null,
      validatedAt: null,
      paidAt: null,
      inputSnapshotHash: null,
      createdById: currentUser(d).id,
      employeeIds: eligible,
      version: 1,
    };
    d.payruns = [...d.payruns, payrun];
    d.activePayrunId = id;
    audit(
      d,
      'PAYRUN_CREATED',
      'Payrun',
      id,
      `Created from ${monthLabel(latest.periodStart)} — ${added.length} added, ${removed.length} removed`,
    );
  });
  return ok({ id, added, removed }, `${monthLabel(start)} payroll created`);
}

export function createPayrun(input: {
  periodStart: ISODate;
  structureId: string;
  employeeIds: string[];
}): ActionResult<{ id: string }> {
  const s = getState();
  const start = monthStart(input.periodStart);
  const end = monthEnd(input.periodStart);
  const id = `PR-${start.slice(0, 7)}`;
  if (s.payruns.some((p) => p.id === id)) {
    return fail(`${monthLabel(start)} payroll already exists.`, 'periodStart');
  }
  if (input.employeeIds.length === 0) {
    return fail('Select at least one employee.', 'employeeIds');
  }
  setState((d) => {
    d.payruns = [
      ...d.payruns,
      {
        id,
        name: `${monthLabel(start)} Payroll`,
        periodStart: start,
        periodEnd: end,
        salaryStructureId: input.structureId,
        status: 'DRAFT',
        isFrozen: false,
        frozenAt: null,
        reopenReason: null,
        expectedWorkDays: countWorkingDays(start, end, scheduleCtx(d, 'sch-std')),
        computedAt: null,
        validatedAt: null,
        paidAt: null,
        inputSnapshotHash: null,
        createdById: currentUser(d).id,
        employeeIds: input.employeeIds,
        version: 1,
      },
    ];
    d.activePayrunId = id;
    audit(d, 'PAYRUN_CREATED', 'Payrun', id, `${monthLabel(start)} created with ${input.employeeIds.length} employees`);
  });
  return ok({ id }, `${monthLabel(start)} payroll created`);
}

export function setActivePayrun(id: string): ActionResult {
  setState((d) => {
    d.activePayrunId = id;
  });
  return ok(undefined, '');
}

export function togglePayrunEmployee(employeeId: string, include: boolean): ActionResult {
  const s = getState();
  const payrun = s.payruns.find((p) => p.id === s.activePayrunId);
  if (!payrun) return fail('No active payrun');
  if (payrun.status === 'VALIDATED' || payrun.status === 'PAID') {
    return fail('Employees cannot be changed after validation.');
  }
  setState((d) => {
    const pr = d.payruns.find((p) => p.id === payrun.id)!;
    pr.employeeIds = include
      ? [...new Set([...pr.employeeIds, employeeId])]
      : pr.employeeIds.filter((x) => x !== employeeId);
    if (!include) d.payslips = d.payslips.filter((p) => !(p.payrunId === pr.id && p.employeeId === employeeId));
  });
  return ok(undefined, include ? 'Added to payrun' : 'Removed from payrun');
}

/* ── delivery ──────────────────────────────────────────────── */

/**
 * Send payslips. Deterministic outcome: an address on the reserved
 * `.invalid` TLD always fails, so failure handling is demonstrable and
 * repeatable — and payroll money is never touched either way.
 */
export function sendPayslips(payrunId: string): ActionResult<{ queued: number; failed: number }> {
  const s = getState();
  const payrun = s.payruns.find((p) => p.id === payrunId);
  if (!payrun) return fail('Unknown payrun');
  if (payrun.status !== 'VALIDATED' && payrun.status !== 'PAID') {
    return fail('Payslips can only be sent once payroll is validated.');
  }
  const targets = payslipsOf(s, payrunId).filter((p) => !p.isDuplicate && p.status !== 'CANCELLED');
  if (targets.length === 0) return fail('There are no payslips to send.');

  let failed = 0;
  setState((d) => {
    const now = new Date().toISOString();
    const messages = targets.map((slip) => {
      const emp = d.employees.find((e) => e.id === slip.employeeId)!;
      const bad = emp.email.endsWith('.invalid');
      if (bad) failed += 1;
      return {
        id: `out-${slip.id}`,
        to: emp.email,
        subject: `Payslip — ${monthLabel(slip.periodStart)}`,
        body: `Dear ${emp.firstName}, your payslip for ${monthLabel(slip.periodStart)} is attached. Net pay ₹${slip.net}.`,
        attachmentName: `Payslip_${emp.employeeCode}_${slip.periodStart.slice(0, 7)}.pdf`,
        status: (bad ? 'FAILED' : 'SENT') as 'SENT' | 'FAILED',
        error: bad ? 'Recipient address rejected by mail server (550 unknown mailbox)' : null,
        createdAt: now,
        sentAt: bad ? null : now,
        payslipId: slip.id,
      };
    });
    d.outbox = [...d.outbox.filter((m) => !messages.some((n) => n.id === m.id)), ...messages];
    d.payslips = d.payslips.map((p) => {
      const msg = messages.find((m) => m.payslipId === p.id);
      if (!msg) return p;
      return {
        ...p,
        delivery: msg.status === 'SENT' ? 'SENT' : 'FAILED',
        deliveryError: msg.error,
        deliveredAt: msg.sentAt,
      };
    });
    audit(
      d,
      'PAYSLIPS_SENT',
      'Payrun',
      payrunId,
      `${messages.length} payslips dispatched, ${failed} failed`,
    );
  });

  return ok(
    { queued: targets.length, failed },
    failed > 0
      ? `${targets.length - failed} sent · ${failed} failed — payroll amounts unchanged`
      : `${targets.length} payslips sent`,
  );
}

export function retryDelivery(messageId: string): ActionResult {
  const s = getState();
  const msg = s.outbox.find((m) => m.id === messageId);
  if (!msg) return fail('Unknown message');
  const stillBad = msg.to.endsWith('.invalid');
  setState((d) => {
    d.outbox = d.outbox.map((m) =>
      m.id === messageId
        ? {
            ...m,
            status: stillBad ? 'FAILED' : 'SENT',
            sentAt: stillBad ? null : new Date().toISOString(),
            error: stillBad ? 'Recipient address rejected by mail server (550 unknown mailbox)' : null,
          }
        : m,
    );
    if (!stillBad && msg.payslipId) {
      d.payslips = d.payslips.map((p) =>
        p.id === msg.payslipId
          ? { ...p, delivery: 'SENT', deliveryError: null, deliveredAt: new Date().toISOString() }
          : p,
      );
    }
  });
  return stillBad
    ? fail(`Still failing: ${msg.to} is not a deliverable address. Fix the employee record first.`)
    : ok(undefined, 'Delivered');
}

/* ── exception resolution (fixes real records) ─────────────── */

export function saveBankDetails(
  employeeId: string,
  input: { bankName: string; accountNumber: string; ifsc: string; accountName: string },
): ActionResult {
  if (!input.accountName.trim()) return fail('Account holder name is required.', 'accountName');
  if (!/^\d{9,18}$/.test(input.accountNumber.trim())) {
    return fail('Account number must be 9–18 digits.', 'accountNumber');
  }
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(input.ifsc.trim().toUpperCase())) {
    return fail('IFSC must look like HDFC0001234.', 'ifsc');
  }
  if (!input.bankName.trim()) return fail('Bank name is required.', 'bankName');

  setState((d) => {
    d.employees = d.employees.map((e) =>
      e.id === employeeId
        ? {
            ...e,
            bank: {
              accountName: input.accountName.trim(),
              accountNumberMasked: `••••${input.accountNumber.trim().slice(-4)}`,
              ifsc: input.ifsc.trim().toUpperCase(),
              bankName: input.bankName.trim(),
              verifiedAt: new Date().toISOString(),
            },
            version: e.version + 1,
          }
        : e,
    );
    // Completing the record also completes the onboarding item it came from.
    d.checklists = d.checklists.map((c) =>
      c.employeeId === employeeId
        ? {
            ...c,
            items: c.items.map((i) =>
              i.label === 'Bank details verified' && !i.completedAt
                ? { ...i, completedAt: new Date().toISOString(), completedById: currentUser(d).id }
                : i,
            ),
          }
        : c,
    );
    audit(d, 'BANK_VERIFIED', 'Employee', employeeId, 'Bank details saved and verified');
  });
  return ok(undefined, 'Bank details saved and verified');
}

export function fixMissingCheckout(
  attendanceId: string,
  checkOut: string,
  reason: string,
): ActionResult {
  const s = getState();
  const record = s.attendance.find((a) => a.id === attendanceId);
  if (!record) return fail('Attendance record not found');
  if (!record.checkIn) return fail('This record has no check-in to pair with.');
  if (!/^\d{2}:\d{2}$/.test(checkOut)) return fail('Enter a time as HH:MM.', 'checkOut');
  if (minutesOfDay(checkOut) <= minutesOfDay(record.checkIn)) {
    return fail('Checkout must be after check-in.', 'checkOut');
  }
  if (!reason.trim()) return fail('A correction reason is required.', 'reason');

  setState((d) => {
    d.attendance = d.attendance.map((a) =>
      a.id === attendanceId
        ? {
            ...a,
            checkOut,
            workedMinutes: minutesOfDay(checkOut) - minutesOfDay(a.checkIn!) - 60,
            status: 'PRESENT',
            source: 'MANAGER',
            correctionReason: reason.trim(),
            correctedById: currentUser(d).id,
            correctedAt: new Date().toISOString(),
          }
        : a,
    );
    audit(
      d,
      'ATTENDANCE_CORRECTED',
      'Attendance',
      attendanceId,
      `Checkout set to ${checkOut} — ${reason.trim()}`,
    );
  });
  return ok(undefined, 'Attendance corrected and worked hours recalculated');
}

export function cancelDuplicatePayslip(payslipId: string): ActionResult {
  const s = getState();
  const slip = s.payslips.find((p) => p.id === payslipId);
  if (!slip) return fail('Payslip not found');
  const payrun = s.payruns.find((p) => p.id === slip.payrunId);
  if (payrun && (payrun.status === 'PAID' || payrun.status === 'VALIDATED')) {
    return fail('Payslips cannot be removed after validation.');
  }
  setState((d) => {
    d.payslips = d.payslips.filter((p) => p.id !== payslipId);
    audit(d, 'PAYSLIP_CANCELLED', 'Payslip', payslipId, `Duplicate payslip ${slip.payslipRef} removed`);
  });
  return ok(undefined, 'Duplicate payslip removed');
}

/* ── employees ─────────────────────────────────────────────── */

export interface NewEmployeeInput {
  firstName: string;
  lastName: string;
  email: string;
  departmentId: string;
  jobPositionId: string;
  employeeType: EmployeeType;
  wage: string;
  salaryStructureId: string;
  workingScheduleId: string;
  managerId: string;
  joinDate: string;
}

export function createEmployee(input: NewEmployeeInput): ActionResult<Employee> {
  const s = getState();
  const first = input.firstName.trim();
  const last = input.lastName.trim();

  if (!first) return fail('First name is required.', 'firstName');
  if (!last) return fail('Last name is required.', 'lastName');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    return fail('Enter a valid email address.', 'email');
  }
  if (s.employees.some((e) => e.email.toLowerCase() === input.email.trim().toLowerCase())) {
    return fail('An employee with this email already exists.', 'email');
  }
  if (!input.departmentId) return fail('Select a department.', 'departmentId');
  if (!input.jobPositionId) return fail('Select a job position.', 'jobPositionId');
  const wage = money(input.wage || '0');
  if (wage.lessThanOrEqualTo(0)) return fail('Monthly wage must be greater than zero.', 'wage');
  if (!input.workingScheduleId) return fail('Select a working schedule.', 'workingScheduleId');
  if (!input.salaryStructureId) return fail('Select a salary structure.', 'salaryStructureId');
  if (!input.joinDate) return fail('Select a joining date.', 'joinDate');

  const num = s.employees.length + 1;
  const id = `EMP-${String(num).padStart(3, '0')}`;
  const employee: Employee = {
    id,
    employeeCode: id,
    firstName: first,
    lastName: last,
    fullName: `${first} ${last}`,
    initials: (first[0] + last[0]).toUpperCase(),
    email: input.email.trim().toLowerCase(),
    phone: '',
    departmentId: input.departmentId,
    jobPositionId: input.jobPositionId,
    managerId: input.managerId || null,
    employeeType: input.employeeType,
    status: 'PROBATION',
    joinDate: input.joinDate,
    exitDate: null,
    probationEndDate: addDays(input.joinDate, 90),
    workingScheduleId: input.workingScheduleId,
    bank: null,
    panMasked: null,
    version: 1,
  };

  const contract: Contract = {
    id: `ct-${id}`,
    contractRef: `CT-${300 + num}`,
    employeeId: id,
    startDate: input.joinDate,
    endDate: null,
    departmentId: input.departmentId,
    jobPositionId: input.jobPositionId,
    employeeType: input.employeeType,
    wage: toMoneyString(wage),
    salaryStructureId: input.salaryStructureId,
    workingScheduleId: input.workingScheduleId,
    status: 'ACTIVE',
    notes: 'Created with employee record.',
    version: 1,
  };

  setState((d) => {
    d.employees = [...d.employees, employee];
    d.contracts = [...d.contracts, contract];
    d.leaveAllocations = [
      ...d.leaveAllocations,
      { id: `la-${id}-annual`, employeeId: id, leaveTypeId: 'lt-annual', allocated: 24, used: 0, carriedForward: 0, validFrom: '2026-01-01', validTo: '2026-12-31' },
      { id: `la-${id}-sick`, employeeId: id, leaveTypeId: 'lt-sick', allocated: 8, used: 0, carriedForward: 0, validFrom: '2026-01-01', validTo: '2026-12-31' },
    ];
    // Y10 — onboarding instantiates automatically and feeds payroll readiness.
    d.checklists = [
      ...d.checklists,
      {
        id: `chk-${id}`,
        employeeId: id,
        type: 'ONBOARDING',
        createdAt: new Date().toISOString(),
        items: [
          { id: `${id}-c1`, label: 'Signed contract on file', ownerRole: 'HR_MANAGER', dueDate: addDays(input.joinDate, 7), blocksPayroll: true, completedAt: new Date().toISOString(), completedById: currentUser(d).id },
          { id: `${id}-c2`, label: 'Bank details verified', ownerRole: 'HR_PAYROLL_USER', dueDate: addDays(input.joinDate, 10), blocksPayroll: true, completedAt: null, completedById: null },
          { id: `${id}-c3`, label: 'Working schedule assigned', ownerRole: 'HR_MANAGER', dueDate: addDays(input.joinDate, 3), blocksPayroll: true, completedAt: new Date().toISOString(), completedById: currentUser(d).id },
          { id: `${id}-c4`, label: 'Laptop and access provisioned', ownerRole: 'ADMIN', dueDate: addDays(input.joinDate, 2), blocksPayroll: false, completedAt: null, completedById: null },
        ],
      },
    ];
    audit(d, 'EMPLOYEE_CREATED', 'Employee', id, `${employee.fullName} added to ${d.departments.find((x) => x.id === input.departmentId)?.name}`);
  });

  return ok(employee, `${employee.fullName} created`);
}

export function updateEmployee(id: string, patch: Partial<Employee>): ActionResult {
  setState((d) => {
    d.employees = d.employees.map((e) =>
      e.id === id ? { ...e, ...patch, version: e.version + 1 } : e,
    );
    audit(d, 'EMPLOYEE_UPDATED', 'Employee', id, `Updated ${Object.keys(patch).join(', ')}`);
  });
  return ok(undefined, 'Employee updated');
}

export function archiveEmployee(id: string): ActionResult<Employee | undefined> {
  const s = getState();
  const before = s.employees.find((e) => e.id === id);
  setState((d) => {
    d.employees = d.employees.map((e) => (e.id === id ? { ...e, status: 'ARCHIVED' } : e));
    audit(d, 'EMPLOYEE_ARCHIVED', 'Employee', id, `${before?.fullName ?? id} archived`);
  });
  return ok(before, `${before?.fullName ?? 'Employee'} archived`);
}

export function restoreEmployee(id: string, status: Employee['status']): ActionResult {
  setState((d) => {
    d.employees = d.employees.map((e) => (e.id === id ? { ...e, status } : e));
    d.audit = d.audit.filter((a) => !(a.entityId === id && a.action === 'EMPLOYEE_ARCHIVED'));
  });
  return ok(undefined, 'Restored');
}

export function moveEmployeeToDepartment(id: string, departmentId: string): ActionResult {
  const s = getState();
  const emp = s.employees.find((e) => e.id === id);
  if (!emp) return fail('Employee not found');
  if (emp.departmentId === departmentId) return ok(undefined, '');
  setState((d) => {
    d.employees = d.employees.map((e) => (e.id === id ? { ...e, departmentId } : e));
    d.contracts = d.contracts.map((c) =>
      c.employeeId === id && c.status === 'ACTIVE' ? { ...c, departmentId } : c,
    );
    audit(
      d,
      'EMPLOYEE_MOVED',
      'Employee',
      id,
      `Moved to ${d.departments.find((x) => x.id === departmentId)?.name}`,
    );
  });
  return ok(undefined, `${emp.fullName} moved`);
}

/* ── contracts ─────────────────────────────────────────────── */

export interface ContractInput {
  employeeId: string;
  startDate: string;
  endDate: string;
  departmentId: string;
  jobPositionId: string;
  employeeType: EmployeeType;
  wage: string;
  salaryStructureId: string;
  workingScheduleId: string;
}

function findOverlap(s: AppState, input: ContractInput, ignoreId?: string): Contract | undefined {
  return s.contracts.find(
    (c) =>
      c.employeeId === input.employeeId &&
      c.id !== ignoreId &&
      c.status === 'ACTIVE' &&
      rangeOverlaps(c.startDate, c.endDate, input.startDate, input.endDate || null),
  );
}

export function createContract(input: ContractInput): ActionResult<Contract> {
  const s = getState();
  if (!input.employeeId) return fail('Select an employee.', 'employeeId');
  if (!input.startDate) return fail('Start date is required.', 'startDate');
  if (input.endDate && input.endDate < input.startDate) {
    return fail('End date cannot be before the start date.', 'endDate');
  }
  if (money(input.wage || '0').lessThanOrEqualTo(0)) {
    return fail('Monthly wage must be greater than zero.', 'wage');
  }
  const clash = findOverlap(s, input);
  if (clash) {
    return fail(
      `This contract overlaps ${clash.contractRef} from ${formatDate(clash.startDate)} to ${clash.endDate ? formatDate(clash.endDate) : 'open-ended'}.`,
      'startDate',
    );
  }

  const ref = `CT-${400 + s.contracts.length + 1}`;
  const contract: Contract = {
    id: nextId('ct'),
    contractRef: ref,
    employeeId: input.employeeId,
    startDate: input.startDate,
    endDate: input.endDate || null,
    departmentId: input.departmentId,
    jobPositionId: input.jobPositionId,
    employeeType: input.employeeType,
    wage: toMoneyString(money(input.wage)),
    salaryStructureId: input.salaryStructureId,
    workingScheduleId: input.workingScheduleId,
    status: 'ACTIVE',
    notes: '',
    version: 1,
  };
  setState((d) => {
    d.contracts = [...d.contracts, contract];
    audit(d, 'CONTRACT_CREATED', 'Contract', contract.id, `${ref} created for ${d.employees.find((e) => e.id === input.employeeId)?.fullName}`);
  });
  return ok(contract, `${ref} created`);
}

export function updateContract(id: string, input: ContractInput): ActionResult {
  const s = getState();
  const existing = s.contracts.find((c) => c.id === id);
  if (!existing) return fail('Contract not found');
  if (input.endDate && input.endDate < input.startDate) {
    return fail('End date cannot be before the start date.', 'endDate');
  }
  const clash = findOverlap(s, input, id);
  if (clash) {
    return fail(
      `This contract overlaps ${clash.contractRef} from ${formatDate(clash.startDate)} to ${clash.endDate ? formatDate(clash.endDate) : 'open-ended'}.`,
      'startDate',
    );
  }
  const wageChanged = toMoneyString(money(input.wage)) !== existing.wage;
  setState((d) => {
    d.contracts = d.contracts.map((c) =>
      c.id === id
        ? {
            ...c,
            startDate: input.startDate,
            endDate: input.endDate || null,
            departmentId: input.departmentId,
            jobPositionId: input.jobPositionId,
            employeeType: input.employeeType,
            wage: toMoneyString(money(input.wage)),
            salaryStructureId: input.salaryStructureId,
            workingScheduleId: input.workingScheduleId,
            version: c.version + 1,
          }
        : c,
    );
    audit(
      d,
      wageChanged ? 'CONTRACT_WAGE_CHANGED' : 'CONTRACT_UPDATED',
      'Contract',
      id,
      wageChanged
        ? `${existing.contractRef} wage ₹${existing.wage} → ₹${toMoneyString(money(input.wage))}`
        : `${existing.contractRef} updated`,
    );
  });
  return ok(undefined, `${existing.contractRef} updated`);
}

export function terminateContract(id: string, endDate: string, reason: string): ActionResult {
  const s = getState();
  const c = s.contracts.find((x) => x.id === id);
  if (!c) return fail('Contract not found');
  if (!endDate) return fail('An end date is required.', 'endDate');
  if (endDate < c.startDate) return fail('End date cannot be before the start date.', 'endDate');
  setState((d) => {
    d.contracts = d.contracts.map((x) =>
      x.id === id ? { ...x, endDate, status: 'TERMINATED', notes: reason, version: x.version + 1 } : x,
    );
    audit(d, 'CONTRACT_TERMINATED', 'Contract', id, `${c.contractRef} terminated on ${formatDate(endDate)} — ${reason}`);
  });
  return ok(undefined, `${c.contractRef} terminated`);
}

/* ── attendance ────────────────────────────────────────────── */

export function checkIn(employeeId: string): ActionResult {
  const s = getState();
  const existing = s.attendance.find((a) => a.employeeId === employeeId && a.date === s.today);
  if (existing?.checkIn) return fail('You are already checked in today.');
  const now = new Date();
  const time = fromMinutes(now.getHours() * 60 + now.getMinutes());

  setState((d) => {
    if (existing) {
      d.attendance = d.attendance.map((a) =>
        a.id === existing.id ? { ...a, checkIn: time, status: 'PRESENT', source: 'SELF' } : a,
      );
    } else {
      const record: Attendance = {
        id: `att-${employeeId}-${d.today}`,
        employeeId,
        date: d.today,
        checkIn: time,
        checkOut: null,
        workedMinutes: 0,
        status: 'PRESENT',
        source: 'SELF',
        correctionReason: null,
        correctedById: null,
        correctedAt: null,
      };
      d.attendance = [...d.attendance, record];
    }
    audit(d, 'CHECK_IN', 'Attendance', `${employeeId}:${d.today}`, `Checked in at ${time}`);
  });
  return ok(undefined, `Checked in at ${time}`);
}

export function checkOut(employeeId: string): ActionResult<{ minutes: number }> {
  const s = getState();
  const record = s.attendance.find(
    (a) => a.employeeId === employeeId && a.checkIn && !a.checkOut,
  );
  if (!record) return fail('You are not currently checked in.');
  const now = new Date();
  let minutes = now.getHours() * 60 + now.getMinutes();
  const inMin = minutesOfDay(record.checkIn!);
  if (minutes <= inMin) minutes = inMin + 30; // clock skew guard
  const time = fromMinutes(minutes);
  const worked = minutes - inMin - 60;

  setState((d) => {
    d.attendance = d.attendance.map((a) =>
      a.id === record.id
        ? { ...a, checkOut: time, workedMinutes: Math.max(0, worked), status: 'PRESENT' }
        : a,
    );
    audit(d, 'CHECK_OUT', 'Attendance', record.id, `Checked out at ${time}`);
  });
  return ok({ minutes: Math.max(0, worked) }, `Checked out at ${time}`);
}

export function correctAttendance(
  id: string,
  patch: { checkIn?: string; checkOut?: string; status?: Attendance['status'] },
  reason: string,
): ActionResult {
  const s = getState();
  const rec = s.attendance.find((a) => a.id === id);
  if (!rec) return fail('Record not found');
  if (!reason.trim()) return fail('A correction reason is required.', 'reason');
  const ci = patch.checkIn ?? rec.checkIn;
  const co = patch.checkOut ?? rec.checkOut;
  if (ci && co && minutesOfDay(co) <= minutesOfDay(ci)) {
    return fail('Checkout must be after check-in.', 'checkOut');
  }
  setState((d) => {
    d.attendance = d.attendance.map((a) =>
      a.id === id
        ? {
            ...a,
            checkIn: ci,
            checkOut: co,
            status: patch.status ?? (ci && co ? 'PRESENT' : a.status),
            workedMinutes: ci && co ? Math.max(0, minutesOfDay(co) - minutesOfDay(ci) - 60) : 0,
            source: 'MANAGER',
            correctionReason: reason.trim(),
            correctedById: currentUser(d).id,
            correctedAt: new Date().toISOString(),
          }
        : a,
    );
    audit(d, 'ATTENDANCE_CORRECTED', 'Attendance', id, reason.trim());
  });
  return ok(undefined, 'Attendance corrected');
}

/** Y06 — accept a proposed regularization. Writes the real record. */
export function applyRegularizations(ids: string[]): ActionResult<{ count: number }> {
  const s = getState();
  const proposals = ids
    .map((id) => s.attendance.find((a) => a.id === id))
    .filter((a): a is Attendance => Boolean(a && a.checkIn && !a.checkOut));
  if (proposals.length === 0) return fail('Nothing to regularize.');

  setState((d) => {
    for (const rec of proposals) {
      const emp = d.employees.find((e) => e.id === rec.employeeId);
      const sch = d.schedules.find((x) => x.id === emp?.workingScheduleId) ?? d.schedules[0];
      const line = sch.lines.find((l) => l.dayOfWeek === new Date(rec.date).getDay()) ?? sch.lines[0];
      const proposed = line.end;
      d.attendance = d.attendance.map((a) =>
        a.id === rec.id
          ? {
              ...a,
              checkOut: proposed,
              workedMinutes: Math.max(0, minutesOfDay(proposed) - minutesOfDay(a.checkIn!) - line.breakMinutes),
              status: 'PRESENT',
              source: 'SYSTEM',
              correctionReason: `Auto-regularized to scheduled end time (${proposed}) from ${sch.name}`,
              correctedById: currentUser(d).id,
              correctedAt: new Date().toISOString(),
            }
          : a,
      );
    }
    audit(
      d,
      'ATTENDANCE_REGULARIZED',
      'Attendance',
      proposals.map((p) => p.id).join(','),
      `${proposals.length} record${proposals.length === 1 ? '' : 's'} regularized from schedule`,
    );
  });
  return ok({ count: proposals.length }, `${proposals.length} record${proposals.length === 1 ? '' : 's'} regularized`);
}

/* ── time off ──────────────────────────────────────────────── */

export function countLeaveDays(
  s: AppState,
  employeeId: string,
  from: ISODate,
  to: ISODate,
  halfStart: boolean,
  halfEnd: boolean,
): number {
  const emp = s.employees.find((e) => e.id === employeeId);
  const ctx = scheduleCtx(s, emp?.workingScheduleId ?? 'sch-std');
  let days = eachDay(from, to).filter((day) => isWorkingDay(day, ctx)).length;
  if (halfStart) days -= 0.5;
  if (halfEnd && from !== to) days -= 0.5;
  return Math.max(0, days);
}

export function requestLeave(input: {
  employeeId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  reason: string;
}): ActionResult<LeaveRequest> {
  const s = getState();
  if (!input.fromDate) return fail('Select a start date.', 'fromDate');
  if (!input.toDate) return fail('Select an end date.', 'toDate');
  if (input.toDate < input.fromDate) return fail('End date cannot be before the start date.', 'toDate');

  const type = s.leaveTypes.find((t) => t.id === input.leaveTypeId);
  if (!type) return fail('Select a leave type.', 'leaveTypeId');

  const overlap = s.leaveRequests.find(
    (r) =>
      r.employeeId === input.employeeId &&
      (r.status === 'PENDING' || r.status === 'APPROVED') &&
      rangeOverlaps(r.fromDate, r.toDate, input.fromDate, input.toDate),
  );
  if (overlap) {
    return fail(
      `You already have a ${overlap.status.toLowerCase()} request from ${formatDate(overlap.fromDate)} to ${formatDate(overlap.toDate)}.`,
      'fromDate',
    );
  }

  const days = countLeaveDays(s, input.employeeId, input.fromDate, input.toDate, input.halfDayStart, input.halfDayEnd);
  if (days <= 0) {
    return fail('That range contains no working days for this employee.', 'fromDate');
  }

  if (type.requiresAllocation) {
    const alloc = s.leaveAllocations.find(
      (a) => a.employeeId === input.employeeId && a.leaveTypeId === type.id,
    );
    if (!alloc) {
      return fail(`No ${type.name} allocation exists for this employee.`, 'leaveTypeId');
    }
    const remaining = alloc.allocated + alloc.carriedForward - alloc.used;
    if (days > remaining && !type.allowNegativeBalance) {
      return fail(
        `Only ${remaining} day${remaining === 1 ? '' : 's'} of ${type.name} remain; this request needs ${days}.`,
        'toDate',
      );
    }
    if (input.fromDate < alloc.validFrom || input.toDate > alloc.validTo) {
      return fail(
        `Allocation is valid from ${formatDate(alloc.validFrom)} to ${formatDate(alloc.validTo)}.`,
        'fromDate',
      );
    }
  }

  const request: LeaveRequest = {
    id: nextId('LR'),
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    halfDayStart: input.halfDayStart,
    halfDayEnd: input.halfDayEnd,
    days,
    reason: input.reason.trim(),
    status: 'PENDING',
    approverId: null,
    decidedAt: null,
    decisionNote: null,
    autoDecidedBy: null,
    createdAt: new Date().toISOString(),
  };

  // Y03 — deterministic auto-approval policy, fully audited and reversible.
  const autoApprove =
    s.settings.autoApproveShortSickLeave && type.code === 'SICK' && days <= 1;

  setState((d) => {
    if (autoApprove) {
      request.status = 'APPROVED';
      request.decidedAt = new Date().toISOString();
      request.autoDecidedBy = 'Short sick leave auto-approval';
      consumeAllocation(d, request, days);
    }
    d.leaveRequests = [request, ...d.leaveRequests];
    audit(
      d,
      autoApprove ? 'LEAVE_AUTO_APPROVED' : 'LEAVE_REQUESTED',
      'LeaveRequest',
      request.id,
      `${type.name}, ${days} day${days === 1 ? '' : 's'}${autoApprove ? ' (policy)' : ''}`,
      autoApprove ? 'SYSTEM' : undefined,
    );
  });

  return ok(
    request,
    autoApprove
      ? `${type.name} auto-approved by policy — ${days} day${days === 1 ? '' : 's'}`
      : `Leave requested — ${days} day${days === 1 ? '' : 's'}`,
  );
}

/** Atomic-style allocation consumption: guarded, single write. */
function consumeAllocation(d: AppState, req: LeaveRequest, days: number): boolean {
  const type = d.leaveTypes.find((t) => t.id === req.leaveTypeId);
  if (!type?.requiresAllocation) return true;
  const alloc = d.leaveAllocations.find(
    (a) => a.employeeId === req.employeeId && a.leaveTypeId === req.leaveTypeId,
  );
  if (!alloc) return false;
  const capacity = alloc.allocated + alloc.carriedForward;
  if (!type.allowNegativeBalance && alloc.used + days > capacity) return false;
  d.leaveAllocations = d.leaveAllocations.map((a) =>
    a.id === alloc.id ? { ...a, used: a.used + days } : a,
  );
  return true;
}

function releaseAllocation(d: AppState, req: LeaveRequest): void {
  const type = d.leaveTypes.find((t) => t.id === req.leaveTypeId);
  if (!type?.requiresAllocation) return;
  d.leaveAllocations = d.leaveAllocations.map((a) =>
    a.employeeId === req.employeeId && a.leaveTypeId === req.leaveTypeId
      ? { ...a, used: Math.max(0, a.used - req.days) }
      : a,
  );
}

export function decideLeave(id: string, decision: 'APPROVED' | 'REFUSED', note = ''): ActionResult {
  const s = getState();
  const req = s.leaveRequests.find((r) => r.id === id);
  if (!req) return fail('Request not found');
  if (req.status !== 'PENDING') return fail(`This request is already ${req.status.toLowerCase()}.`);
  if (decision === 'REFUSED' && !note.trim()) {
    return fail('A short note is required when refusing a request.', 'note');
  }

  let consumed = true;
  setState((d) => {
    if (decision === 'APPROVED') consumed = consumeAllocation(d, req, req.days);
    if (!consumed) return;
    d.leaveRequests = d.leaveRequests.map((r) =>
      r.id === id
        ? {
            ...r,
            status: decision,
            approverId: currentUser(d).id,
            decidedAt: new Date().toISOString(),
            decisionNote: note.trim() || null,
          }
        : r,
    );
    audit(
      d,
      decision === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REFUSED',
      'LeaveRequest',
      id,
      `${d.employees.find((e) => e.id === req.employeeId)?.fullName}: ${req.days} day${req.days === 1 ? '' : 's'}${note ? ` — ${note}` : ''}`,
    );
  });

  if (!consumed) {
    return fail('Insufficient allocation — the balance changed since this request was made.');
  }
  return ok(undefined, decision === 'APPROVED' ? 'Leave approved' : 'Leave refused');
}

export function cancelLeave(id: string): ActionResult {
  const s = getState();
  const req = s.leaveRequests.find((r) => r.id === id);
  if (!req) return fail('Request not found');
  if (req.status === 'CANCELLED') return fail('Already cancelled.');
  setState((d) => {
    if (req.status === 'APPROVED') releaseAllocation(d, req);
    d.leaveRequests = d.leaveRequests.map((r) =>
      r.id === id ? { ...r, status: 'CANCELLED' } : r,
    );
    audit(d, 'LEAVE_CANCELLED', 'LeaveRequest', id, 'Request cancelled');
  });
  return ok(undefined, 'Leave request cancelled');
}

export function grantAllocation(
  employeeIds: string[],
  leaveTypeId: string,
  days: number,
): ActionResult<{ count: number }> {
  if (employeeIds.length === 0) return fail('Select at least one employee.');
  if (days <= 0) return fail('Days must be greater than zero.', 'days');
  setState((d) => {
    for (const employeeId of employeeIds) {
      const existing = d.leaveAllocations.find(
        (a) => a.employeeId === employeeId && a.leaveTypeId === leaveTypeId,
      );
      if (existing) {
        d.leaveAllocations = d.leaveAllocations.map((a) =>
          a.id === existing.id ? { ...a, allocated: a.allocated + days } : a,
        );
      } else {
        d.leaveAllocations = [
          ...d.leaveAllocations,
          {
            id: `la-${employeeId}-${leaveTypeId}`,
            employeeId,
            leaveTypeId,
            allocated: days,
            used: 0,
            carriedForward: 0,
            validFrom: '2026-01-01',
            validTo: '2026-12-31',
          },
        ];
      }
    }
    audit(d, 'ALLOCATION_GRANTED', 'LeaveAllocation', leaveTypeId, `${days} days granted to ${employeeIds.length} employees`);
  });
  return ok({ count: employeeIds.length }, `Allocation granted to ${employeeIds.length} employees`);
}

/* ── approvals: profile & salary ───────────────────────────── */

export function decideProfileChange(
  id: string,
  decision: 'APPROVED' | 'REFUSED',
  note = '',
): ActionResult {
  const s = getState();
  const req = s.profileChangeRequests.find((r) => r.id === id);
  if (!req) return fail('Request not found');
  if (req.status !== 'PENDING') return fail(`Already ${req.status.toLowerCase()}.`);
  if (decision === 'REFUSED' && !note.trim()) return fail('A note is required when refusing.', 'note');

  setState((d) => {
    d.profileChangeRequests = d.profileChangeRequests.map((r) =>
      r.id === id
        ? {
            ...r,
            status: decision,
            decidedById: currentUser(d).id,
            decidedAt: new Date().toISOString(),
            decisionNote: note.trim() || null,
          }
        : r,
    );
    if (decision === 'APPROVED' && req.field.toLowerCase().includes('bank')) {
      d.employees = d.employees.map((e) =>
        e.id === req.employeeId && e.bank
          ? { ...e, bank: { ...e.bank, accountNumberMasked: req.requestedValue } }
          : e,
      );
    }
    if (decision === 'APPROVED' && req.field.toLowerCase().includes('phone')) {
      d.employees = d.employees.map((e) =>
        e.id === req.employeeId ? { ...e, phone: req.requestedValue } : e,
      );
    }
    audit(
      d,
      decision === 'APPROVED' ? 'PROFILE_CHANGE_APPROVED' : 'PROFILE_CHANGE_REFUSED',
      'ProfileChangeRequest',
      id,
      `${req.field}: ${req.currentValue} → ${req.requestedValue}`,
    );
  });
  return ok(undefined, decision === 'APPROVED' ? 'Profile change applied' : 'Profile change refused');
}

export function decideSalaryChange(
  id: string,
  decision: 'APPROVED' | 'REFUSED',
  note = '',
): ActionResult {
  const s = getState();
  const req = s.salaryChangeRequests.find((r) => r.id === id);
  if (!req) return fail('Request not found');
  if (req.status !== 'PENDING') return fail(`Already ${req.status.toLowerCase()}.`);
  if (decision === 'REFUSED' && !note.trim()) return fail('A note is required when refusing.', 'note');

  setState((d) => {
    d.salaryChangeRequests = d.salaryChangeRequests.map((r) =>
      r.id === id
        ? { ...r, status: decision, decidedById: currentUser(d).id, decidedAt: new Date().toISOString() }
        : r,
    );
    if (decision === 'APPROVED') {
      // A wage change closes the current contract and opens a new one, so
      // historical payroll still resolves the contract it was computed from.
      const current = d.contracts.find((c) => c.id === req.contractId);
      if (current) {
        d.contracts = d.contracts.map((c) =>
          c.id === current.id
            ? { ...c, endDate: addDays(req.effectiveFrom, -1), status: 'EXPIRED', version: c.version + 1 }
            : c,
        );
        d.contracts = [
          ...d.contracts,
          {
            ...current,
            id: `${current.id}-r${d.seq}`,
            contractRef: `${current.contractRef}-R`,
            startDate: req.effectiveFrom,
            endDate: null,
            wage: req.requestedWage,
            status: 'ACTIVE',
            notes: `Salary revision approved — ${req.reason}`,
            version: 1,
          },
        ];
      }
    }
    audit(
      d,
      decision === 'APPROVED' ? 'SALARY_CHANGE_APPROVED' : 'SALARY_CHANGE_REFUSED',
      'SalaryChangeRequest',
      id,
      `₹${req.currentWage} → ₹${req.requestedWage} effective ${formatDate(req.effectiveFrom)}`,
    );
  });
  return ok(
    undefined,
    decision === 'APPROVED' ? 'Salary revision approved and contract updated' : 'Salary revision refused',
  );
}

/* ── batch operations ──────────────────────────────────────── */

export function batchAssignSchedule(employeeIds: string[], scheduleId: string): ActionResult<{ count: number }> {
  if (employeeIds.length === 0) return fail('Nothing selected.');
  setState((d) => {
    d.employees = d.employees.map((e) =>
      employeeIds.includes(e.id) ? { ...e, workingScheduleId: scheduleId } : e,
    );
    d.contracts = d.contracts.map((c) =>
      employeeIds.includes(c.employeeId) && c.status === 'ACTIVE'
        ? { ...c, workingScheduleId: scheduleId }
        : c,
    );
    audit(
      d,
      'BATCH_SCHEDULE',
      'Employee',
      employeeIds.join(','),
      `${employeeIds.length} employees assigned ${d.schedules.find((x) => x.id === scheduleId)?.name}`,
    );
  });
  return ok({ count: employeeIds.length }, `${employeeIds.length} employees updated`);
}

export function batchAssignStructure(employeeIds: string[], structureId: string): ActionResult<{ count: number }> {
  if (employeeIds.length === 0) return fail('Nothing selected.');
  setState((d) => {
    d.contracts = d.contracts.map((c) =>
      employeeIds.includes(c.employeeId) && c.status === 'ACTIVE'
        ? { ...c, salaryStructureId: structureId, version: c.version + 1 }
        : c,
    );
    audit(d, 'BATCH_STRUCTURE', 'Contract', employeeIds.join(','), `${employeeIds.length} contracts moved to a new structure`);
  });
  return ok({ count: employeeIds.length }, `${employeeIds.length} contracts updated`);
}

export function batchAddToPayrun(employeeIds: string[]): ActionResult<{ count: number }> {
  const s = getState();
  const payrun = s.payruns.find((p) => p.id === s.activePayrunId);
  if (!payrun) return fail('No active payrun');
  if (payrun.status === 'VALIDATED' || payrun.status === 'PAID') {
    return fail('This payrun is locked; employees cannot be added.');
  }
  const added = employeeIds.filter((id) => !payrun.employeeIds.includes(id));
  setState((d) => {
    const pr = d.payruns.find((p) => p.id === payrun.id)!;
    pr.employeeIds = [...new Set([...pr.employeeIds, ...employeeIds])];
    audit(d, 'BATCH_PAYRUN', 'Payrun', pr.id, `${added.length} employees added`);
  });
  return ok({ count: added.length }, `${added.length} employees added to ${monthLabel(payrun.periodStart)}`);
}

/* ── salary rules ──────────────────────────────────────────── */

export function updateSalaryRule(
  id: string,
  patch: { amount?: string; percentage?: string; formula?: string; isActive?: boolean },
): ActionResult {
  const s = getState();
  const rule = s.salaryRules.find((r) => r.id === id);
  if (!rule) return fail('Rule not found');
  const inUse = s.payslips.some((p) => p.lines.some((l) => l.ruleId === id));

  setState((d) => {
    d.salaryRules = d.salaryRules.map((r) =>
      r.id === id
        ? {
            ...r,
            ...patch,
            // A rule already used by a payslip is versioned, never mutated.
            ruleVersion: inUse ? r.ruleVersion + 1 : r.ruleVersion,
          }
        : r,
    );
    audit(
      d,
      'SALARY_RULE_UPDATED',
      'SalaryRule',
      id,
      `${rule.code}${inUse ? ` → v${rule.ruleVersion + 1}` : ''} updated`,
    );
  });
  return ok(undefined, `${rule.code} updated${inUse ? ' (new version)' : ''}`);
}

/* ── notifications & settings ──────────────────────────────── */

export function markNotificationsRead(ids: string[]): ActionResult {
  setState((d) => {
    d.readNotificationIds = [...new Set([...d.readNotificationIds, ...ids])];
  });
  return ok(undefined, 'All notifications marked as read');
}

export function dismissNotification(id: string): ActionResult {
  setState((d) => {
    d.dismissedNotificationIds = [...new Set([...d.dismissedNotificationIds, id])];
  });
  return ok(undefined, 'Notification dismissed');
}

export function updateSettings(patch: Partial<AppState['settings']>): ActionResult {
  setState((d) => {
    d.settings = { ...d.settings, ...patch };
    audit(d, 'SETTINGS_UPDATED', 'AppSetting', Object.keys(patch).join(','), `Changed ${Object.keys(patch).join(', ')}`);
  });
  return ok(undefined, 'Setting saved');
}

export function updateUser(
  id: string,
  patch: { role?: Role; isActive?: boolean },
): ActionResult {
  const s = getState();
  const user = s.users.find((item) => item.id === id);
  if (!user) return fail('User not found');
  if (id === s.currentUserId && patch.isActive === false) {
    return fail('You cannot deactivate the account currently in use.');
  }
  setState((d) => {
    d.users = d.users.map((item) => item.id === id ? { ...item, ...patch } : item);
    audit(d, 'USER_ACCESS_UPDATED', 'User', id, `${user.displayName}: ${patch.role ?? user.role}, ${patch.isActive ?? user.isActive ? 'active' : 'inactive'}`);
  });
  return ok(undefined, 'User access updated');
}

/* ── documents ─────────────────────────────────────────────── */

export function acknowledgeDocument(id: string): ActionResult {
  setState((d) => {
    d.documents = d.documents.map((x) =>
      x.id === id ? { ...x, acknowledgedAt: new Date().toISOString() } : x,
    );
    audit(d, 'DOCUMENT_ACKNOWLEDGED', 'Document', id, 'Employee acknowledged the document');
  });
  return ok(undefined, 'Document acknowledged');
}

export function generateDocument(employeeId: string, kind: string): ActionResult {
  const s = getState();
  const emp = s.employees.find((e) => e.id === employeeId);
  if (!emp) return fail('Employee not found');
  const contract = currentContract(s, employeeId);
  setState((d) => {
    d.documents = [
      {
        id: nextId('doc'),
        employeeId,
        contractId: contract?.id ?? null,
        category: 'LETTER',
        fileName: `${kind.replace(/\s+/g, '_')}_${emp.employeeCode}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 92160,
        visibility: 'SELF',
        uploadedAt: new Date().toISOString(),
        uploadedById: currentUser(d).id,
        acknowledgedAt: null,
      },
      ...d.documents,
    ];
    audit(d, 'DOCUMENT_GENERATED', 'Document', employeeId, `${kind} generated for ${emp.fullName}`);
  });
  return ok(undefined, `${kind} generated`);
}

/* ── saved views ───────────────────────────────────────────── */

export function saveView(module: string, name: string, filters: Record<string, string>): ActionResult {
  if (!name.trim()) return fail('Give the view a name.', 'name');
  setState((d) => {
    d.savedViews = [
      ...d.savedViews,
      { id: nextId('view'), ownerId: currentUser(d).id, module, name: name.trim(), filters, createdAt: new Date().toISOString() },
    ];
  });
  return ok(undefined, `View "${name.trim()}" saved`);
}

export function deleteView(id: string): ActionResult {
  setState((d) => {
    d.savedViews = d.savedViews.filter((v) => v.id !== id);
  });
  return ok(undefined, 'View deleted');
}

/* ── misc helpers used by views ────────────────────────────── */

export function payrunNetTotal(s: AppState, payrunId: string): string {
  return toMoneyString(
    s.payslips
      .filter((p) => p.payrunId === payrunId && !p.isDuplicate)
      .reduce((acc, p) => addMoney(acc, p.net), money(0)),
  );
}

export { subtractMoney, resolveContract, ContractResolutionError };
