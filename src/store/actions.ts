/**
 * Commands.
 *
 * Every visible control routes to exactly one function here, and every function
 * here is a call to the server followed by a reload of the caller's own
 * permission-scoped snapshot. The browser holds no business state: it does not
 * decide, it asks.
 *
 * House rules:
 *  - A toast confirms a completed command; a toast is never the command.
 *  - Resolving an exception fixes the underlying record. There is no
 *    `resolved = true` flag anywhere in this file.
 *  - There is no local fallback. If the request fails, nothing changes and the
 *    caller is told why — a failed command must look failed.
 */
import { addMoney, money, toMoneyString } from '@shared/money';
import type { EmployeeType, Role } from '@shared/types';
import { addMonths, eachDay, isWorkingDay, monthEnd, monthStart, type ISODate } from '@shared/dates';

import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';
import { getState, hydrateFromServer, setState } from './store';
import type { AppState } from './state';
import { scheduleCtx } from './payroll';

/* ── result envelope ───────────────────────────────────────── */

export type ActionResult<T = void> =
  | { ok: true; value: T; message: string }
  | { ok: false; error: string; field?: string; recovery?: string; conflict?: boolean };

const ok = <T>(value: T, message = ''): ActionResult<T> => ({ ok: true, value, message });
const fail = (error: string, field?: string): ActionResult<never> => ({ ok: false, error, field });

/**
 * Turn a transport failure into something a person can act on.
 *
 * A version conflict is not an error the user caused, so it is reported as the
 * concurrency event it is, with the server recovery hint attached rather than
 * a generic apology.
 */
function failFrom(error: unknown): ActionResult<never> {
  if (error instanceof ApiError) {
    return {
      ok: false,
      error: error.message,
      recovery: error.recovery,
      conflict: error.isConflict,
    };
  }
  return { ok: false, error: 'The server could not be reached. Nothing was changed.' };
}

/** Reload this client from the server. The snapshot is the source of truth. */
export async function refreshFromServer(): Promise<void> {
  hydrateFromServer(await api.refreshBootstrap());
}

/**
 * Run one server command, then resynchronise.
 *
 * The reload after a successful command is what keeps every derived screen —
 * readiness, exceptions, totals, badges — consistent with the database rather
 * than with an optimistic guess the browser made.
 */
async function command<T>(
  run: () => Promise<T>,
  message: string | ((value: T) => string),
): Promise<ActionResult<T>> {
  try {
    const value = await run();
    await refreshFromServer();
    return ok(value, typeof message === 'function' ? message(value) : message);
  } catch (error) {
    // A conflict means our snapshot is stale, so reload before reporting it:
    // the next attempt then starts from what the server actually holds.
    if (error instanceof ApiError && error.isConflict) {
      await refreshFromServer().catch(() => undefined);
    }
    return failFrom(error);
  }
}

const activePayrunId = () => getState().activePayrunId;

function activePayrun() {
  const state = getState();
  return state.payruns.find((payrun) => payrun.id === state.activePayrunId);
}

/* ── payroll lifecycle ─────────────────────────────────────── */

export function computeActivePayrun(): Promise<ActionResult<api.PayrollComputeResult>> {
  const payrun = activePayrun();
  if (!payrun) return Promise.resolve(fail('No payroll period is selected.'));
  return command(
    () => api.computePayrun(payrun.id),
    (result) =>
      result.blockingExceptionCount > 0
        ? `Computed ${result.payslipCount} payslips · ${result.blockingExceptionCount} blocking input${result.blockingExceptionCount === 1 ? '' : 's'} remain`
        : `Computed ${result.payslipCount} payslips · ${result.readinessScore}% ready`,
  );
}

export function validateActivePayrun(): Promise<ActionResult> {
  const payrun = activePayrun();
  if (!payrun) return Promise.resolve(fail('No payroll period is selected.'));
  return command(async () => {
    await api.validatePayrun(payrun.id);
  }, `${payrun.name} validated`);
}

export function markActivePayrunPaid(): Promise<ActionResult> {
  const payrun = activePayrun();
  if (!payrun) return Promise.resolve(fail('No payroll period is selected.'));
  return command(async () => {
    await api.markPayrunPaid(payrun.id);
  }, `${payrun.name} marked paid — demo mode, no funds were transferred`);
}

export function setPayrunFrozen(frozen: boolean, reason = ''): Promise<ActionResult> {
  const payrun = activePayrun();
  if (!payrun) return Promise.resolve(fail('No payroll period is selected.'));
  return command(async () => {
    await api.setPayrunFrozen(payrun.id, frozen, reason);
  }, frozen ? 'Inputs frozen for this period' : 'Inputs unfrozen');
}

export function reopenPayrun(reason: string): Promise<ActionResult> {
  const payrun = activePayrun();
  if (!payrun) return Promise.resolve(fail('No payroll period is selected.'));
  if (!reason.trim()) return Promise.resolve(fail('A reason is required to reopen decided payroll.', 'reason'));
  return command(async () => {
    await api.reopenPayrun(payrun.id, reason.trim(), payrun.version);
  }, 'Payroll reopened. Every change from here is audited.');
}

export function createPayrunFromPrevious(): Promise<ActionResult<{ id: string }>> {
  const payrun = activePayrun();
  if (!payrun) return Promise.resolve(fail('No payroll period is selected.'));
  return command(() => api.clonePayrun(payrun.id), 'Next period created from this one');
}

export function createPayrun(input: {
  periodStart: string;
  salaryStructureId: string;
}): Promise<ActionResult<{ id: string }>> {
  return command(() => api.createPayrun({ ...input, includeAllActive: true }), 'Payroll period created');
}

/** Which period the screens are looking at. This is view state, not business state. */
export function setActivePayrun(id: string): ActionResult {
  setState((draft) => {
    draft.activePayrunId = id;
  });
  return ok(undefined, '');
}

export function togglePayrunEmployee(employeeId: string, include: boolean): Promise<ActionResult> {
  return command(
    async () => {
      await api.setPayrunMembership(activePayrunId(), {
        employeeIds: [employeeId],
        include,
        reason: include ? '' : 'Excluded from this payroll period by an operator.',
      });
    },
    include ? 'Added to this payroll period' : 'Removed from this payroll period',
  );
}

export function batchAddToPayrun(employeeIds: string[]): Promise<ActionResult<{ count: number }>> {
  if (employeeIds.length === 0) return Promise.resolve(fail('Select at least one employee.'));
  return command(
    async () => {
      await api.setPayrunMembership(activePayrunId(), { employeeIds, include: true });
      return { count: employeeIds.length };
    },
    `${employeeIds.length} employee${employeeIds.length === 1 ? '' : 's'} added to this period`,
  );
}

/* ── blocker resolution ────────────────────────────────────── */

export function saveBankDetails(
  employeeId: string,
  input: { accountName: string; accountNumber: string; ifsc: string; bankName: string },
): Promise<ActionResult> {
  return command(async () => {
    await api.resolvePayrunBank(activePayrunId(), { employeeId, ...input });
  }, 'Bank details verified — this payroll blocker is resolved');
}

export function fixMissingCheckout(attendanceId: string, checkOut: string, reason: string): Promise<ActionResult> {
  return command(async () => {
    await api.resolvePayrunAttendance(activePayrunId(), { attendanceId, checkOut, reason });
  }, 'Attendance corrected — this payroll blocker is resolved');
}

/* ── delivery and payment simulations ──────────────────────── */

export function sendPayslips(payrunId: string): Promise<ActionResult<{ queued: number; sent: number; failed: number }>> {
  return command(
    () => api.deliverPayslips(payrunId),
    (result) =>
      `Demo delivery simulation — ${result.sent} of ${result.queued} marked sent, no email was actually sent`,
  );
}

export function retryDelivery(messageId: string): Promise<ActionResult> {
  return command(async () => {
    await api.retryDelivery(messageId);
  }, 'Delivery retried in the simulation');
}

export function runDemoPaymentBatch(payrunId: string): Promise<ActionResult<api.DemoPaymentBatch>> {
  return command(
    () => api.runDemoPayment(payrunId),
    (batch) =>
      `Demo payment simulation — ${batch.successCount} of ${batch.itemCount} settled, no money was transferred`,
  );
}

export function retryDemoPayment(itemId: string): Promise<ActionResult> {
  return command(async () => {
    await api.retryDemoPayment(itemId);
  }, 'Payment retried in the simulation — still no money moves');
}

/* ── people ────────────────────────────────────────────────── */

export interface NewEmployeeInput {
  firstName: string;
  lastName: string;
  email: string;
  departmentId: string;
  jobPositionId: string;
  managerId: string;
  employeeType: EmployeeType;
  joinDate: string;
  workingScheduleId: string;
  salaryStructureId: string;
  wage: string;
}

export function createEmployee(input: NewEmployeeInput): Promise<ActionResult<{ id: string; fullName: string }>> {
  if (!input.firstName.trim()) return Promise.resolve(fail('First name is required.', 'firstName'));
  if (!input.lastName.trim()) return Promise.resolve(fail('Last name is required.', 'lastName'));
  if (money(input.wage || '0').lessThanOrEqualTo(0)) {
    return Promise.resolve(fail('Monthly wage must be greater than zero.', 'wage'));
  }
  return command(
    () =>
      api.createEmployee({
        ...input,
        managerId: input.managerId || null,
        wage: toMoneyString(money(input.wage)),
      }),
    (employee) => `${employee.fullName} created`,
  );
}

export function updateEmployee(id: string, patch: Record<string, unknown>): Promise<ActionResult> {
  const employee = getState().employees.find((item) => item.id === id);
  if (!employee) return Promise.resolve(fail('Employee record not found.'));
  return command(async () => {
    await api.updateEmployee(id, { ...patch, version: employee.version });
  }, 'Employee updated');
}

export function archiveEmployee(id: string, reason = 'Archived from the employee record.'): Promise<ActionResult> {
  const employee = getState().employees.find((item) => item.id === id);
  if (!employee) return Promise.resolve(fail('Employee record not found.'));
  return command(async () => {
    await api.archiveEmployee(id, reason, employee.version);
  }, `${employee.fullName} archived`);
}

export function restoreEmployee(id: string, status: string): Promise<ActionResult> {
  const employee = getState().employees.find((item) => item.id === id);
  if (!employee) return Promise.resolve(fail('Employee record not found.'));
  return command(async () => {
    await api.restoreEmployee(id, status, employee.version);
  }, `${employee.fullName} restored`);
}

export function moveEmployeeToDepartment(id: string, departmentId: string): Promise<ActionResult> {
  const state = getState();
  const employee = state.employees.find((item) => item.id === id);
  if (!employee) return Promise.resolve(fail('Employee record not found.'));
  const department = state.departments.find((item) => item.id === departmentId);
  return command(async () => {
    await api.moveEmployeeDepartment(id, departmentId, employee.version);
  }, `${employee.fullName} moved to ${department?.name ?? 'the new department'}`);
}

export function batchAssignSchedule(
  employeeIds: string[],
  workingScheduleId: string,
  reason = 'Bulk schedule assignment',
): Promise<ActionResult<{ updated: number }>> {
  if (employeeIds.length === 0) return Promise.resolve(fail('Select at least one employee.'));
  if (!workingScheduleId) return Promise.resolve(fail('Choose a working schedule.'));
  return command(
    () => api.batchAssignSchedule(employeeIds, workingScheduleId, reason),
    (result) => `Schedule assigned to ${result.updated} employee${result.updated === 1 ? '' : 's'}`,
  );
}

export function batchAssignStructure(
  employeeIds: string[],
  salaryStructureId: string,
  reason = 'Bulk salary structure assignment',
): Promise<ActionResult<{ updated: number }>> {
  if (employeeIds.length === 0) return Promise.resolve(fail('Select at least one employee.'));
  if (!salaryStructureId) return Promise.resolve(fail('Choose a salary structure.'));
  return command(
    () => api.batchAssignStructure(employeeIds, salaryStructureId, reason),
    (result) => `Structure assigned to ${result.updated} contract${result.updated === 1 ? '' : 's'}`,
  );
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

export function createContract(input: ContractInput): Promise<ActionResult<{ id: string }>> {
  if (!input.employeeId) return Promise.resolve(fail('Select an employee.', 'employeeId'));
  if (!input.startDate) return Promise.resolve(fail('A start date is required.', 'startDate'));
  if (input.endDate && input.endDate < input.startDate) {
    return Promise.resolve(fail('The end date cannot be before the start date.', 'endDate'));
  }
  return command(
    () => api.createContract({ ...input, endDate: input.endDate || null }),
    'Contract created',
  );
}

export function updateContract(id: string, input: ContractInput, reason = 'Contract terms updated'): Promise<ActionResult> {
  const contract = getState().contracts.find((item) => item.id === id);
  if (!contract) return Promise.resolve(fail('Contract not found.'));
  return command(async () => {
    await api.updateContract(id, {
      version: contract.version,
      // A change of terms takes effect from the start date on the form, so the
      // server can decide whether this is a correction or a new revision.
      effectiveFrom: input.startDate,
      endDate: input.endDate || null,
      jobPositionId: input.jobPositionId,
      employeeType: input.employeeType,
      wage: input.wage,
      salaryStructureId: input.salaryStructureId,
      workingScheduleId: input.workingScheduleId,
      reason,
    });
  }, 'Contract updated');
}

export function terminateContract(id: string, endDate: string, reason: string): Promise<ActionResult> {
  const contract = getState().contracts.find((item) => item.id === id);
  if (!contract) return Promise.resolve(fail('Contract not found.'));
  if (!reason.trim()) return Promise.resolve(fail('A reason is required to terminate a contract.', 'reason'));
  return command(async () => {
    await api.terminateContract(id, endDate, reason.trim(), contract.version);
  }, 'Contract terminated');
}

/* ── attendance ────────────────────────────────────────────── */

export function checkIn(): Promise<ActionResult> {
  return command(async () => {
    await api.attendanceCheckIn();
  }, 'Checked in');
}

export function checkOut(): Promise<ActionResult<{ minutes: number }>> {
  return command(async () => {
    const record = await api.attendanceCheckOut();
    return { minutes: record.workedMinutes };
  }, (result) => `Checked out — ${Math.floor(result.minutes / 60)}h ${String(result.minutes % 60).padStart(2, '0')}m recorded`);
}

export function correctAttendance(
  attendanceId: string,
  checkInAt: string | null,
  checkOutAt: string | null,
  reason: string,
): Promise<ActionResult> {
  const record = getState().attendance.find((item) => item.id === attendanceId);
  if (!record) return Promise.resolve(fail('Attendance record not found.'));
  if (!reason.trim()) return Promise.resolve(fail('A reason is required for a correction.', 'reason'));
  return command(async () => {
    await api.correctAttendanceRecord(attendanceId, {
      checkIn: checkInAt,
      checkOut: checkOutAt,
      reason: reason.trim(),
      version: record.version,
    });
  }, 'Attendance corrected');
}

export function applyRegularizations(
  ids: string[],
  checkOut: string,
  reason = 'Bulk regularization of missing checkouts',
): Promise<ActionResult<{ count: number }>> {
  if (ids.length === 0) return Promise.resolve(fail('Select at least one record.'));
  const state = getState();
  const records = ids
    .map((id) => state.attendance.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (records.length !== ids.length) return Promise.resolve(fail('Some records changed. Reload and try again.'));
  return command(
    async () => {
      const result = await api.regularizeAttendance(
        records.map((record) => ({ id: record.id, checkOut, reason, version: record.version })),
      );
      return { count: result.recordIds.length };
    },
    (result) => `${result.count} record${result.count === 1 ? '' : 's'} regularized`,
  );
}

/* ── leave ─────────────────────────────────────────────────── */

/**
 * A local preview of how many days a request will cost.
 *
 * The server recomputes this against the schedule and holiday calendar before
 * it stores anything, so this is a courtesy for the form, never the answer.
 */
export function countLeaveDays(
  state: AppState,
  employeeId: string,
  from: ISODate,
  to: ISODate,
  halfStart: boolean,
  halfEnd: boolean,
): number {
  const employee = state.employees.find((item) => item.id === employeeId);
  const context = scheduleCtx(state, employee?.workingScheduleId ?? state.schedules[0]?.id ?? '');
  let days = eachDay(from, to).filter((day) => isWorkingDay(day, context)).length;
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
}): Promise<ActionResult> {
  if (!input.fromDate) return Promise.resolve(fail('Select a start date.', 'fromDate'));
  if (!input.toDate) return Promise.resolve(fail('Select an end date.', 'toDate'));
  if (input.toDate < input.fromDate) {
    return Promise.resolve(fail('The end date cannot be before the start date.', 'toDate'));
  }
  if (!input.leaveTypeId) return Promise.resolve(fail('Select a leave type.', 'leaveTypeId'));
  if (input.reason.trim().length < 3) return Promise.resolve(fail('Add a short reason.', 'reason'));
  return command(async () => {
    await api.requestLeave({ ...input, reason: input.reason.trim() });
  }, 'Leave requested');
}

export function decideLeave(id: string, decision: 'APPROVED' | 'REFUSED', note = ''): Promise<ActionResult> {
  if (decision === 'REFUSED' && !note.trim()) {
    return Promise.resolve(fail('A short note is required when refusing a request.', 'note'));
  }
  return command(async () => {
    if (decision === 'APPROVED') await api.approveLeave(id, note.trim());
    else await api.refuseLeave(id, note.trim());
  }, decision === 'APPROVED' ? 'Leave approved' : 'Leave refused');
}

export function cancelLeave(id: string): Promise<ActionResult> {
  return command(async () => {
    await api.cancelLeaveRequest(id);
  }, 'Leave request cancelled');
}

export function grantAllocation(
  employeeIds: string[],
  leaveTypeId: string,
  days: number,
  validFrom?: string,
  validTo?: string,
): Promise<ActionResult<{ granted: number }>> {
  if (employeeIds.length === 0) return Promise.resolve(fail('Select at least one employee.'));
  if (!leaveTypeId) return Promise.resolve(fail('Choose a leave type.', 'leaveTypeId'));
  if (!(days > 0)) return Promise.resolve(fail('Days must be greater than zero.', 'days'));
  const year = (validFrom ?? getState().today).slice(0, 4);
  return command(
    () =>
      api.grantLeaveAllocation({
        employeeIds,
        leaveTypeId,
        days,
        validFrom: validFrom ?? `${year}-01-01`,
        validTo: validTo ?? `${year}-12-31`,
      }),
    (result) => `Allocation granted to ${result.granted} employee${result.granted === 1 ? '' : 's'}`,
  );
}

/* ── approvals: profile and salary ─────────────────────────── */

export function decideProfileChange(
  id: string,
  decision: 'APPROVED' | 'REFUSED',
  note = '',
): Promise<ActionResult> {
  const request = getState().profileChangeRequests.find((item) => item.id === id);
  if (!request) return Promise.resolve(fail('Request not found.'));
  if (decision === 'REFUSED' && !note.trim()) {
    return Promise.resolve(fail('A short note is required when refusing.', 'note'));
  }
  return command(async () => {
    await api.decideProfileChange(id, decision, note.trim(), request.version);
  }, decision === 'APPROVED' ? 'Profile change approved' : 'Profile change refused');
}

export function decideSalaryChange(
  id: string,
  decision: 'APPROVED' | 'REFUSED',
  note = '',
): Promise<ActionResult> {
  const request = getState().salaryChangeRequests.find((item) => item.id === id);
  if (!request) return Promise.resolve(fail('Request not found.'));
  if (decision === 'REFUSED' && !note.trim()) {
    return Promise.resolve(fail('A short note is required when refusing.', 'note'));
  }
  return command(async () => {
    await api.decideSalaryChange(id, decision, note.trim(), request.version);
  }, decision === 'APPROVED' ? 'Salary change approved and dated' : 'Salary change refused');
}

/* ── salary configuration ──────────────────────────────────── */

export function updateSalaryRule(
  id: string,
  patch: { amount?: string; percentage?: string; formula?: string; isActive?: boolean },
  reason = 'Salary rule edited from the configuration screen',
): Promise<ActionResult> {
  const rule = getState().salaryRules.find((item) => item.id === id);
  if (!rule) return Promise.resolve(fail('Salary rule not found.'));
  return command(async () => {
    await api.updateSalaryRule(id, {
      ...patch,
      version: rule.ruleVersion,
      effectiveFrom: monthStart(getState().today),
      reason,
    });
  }, 'Salary rule saved — open payroll periods now need recomputing');
}

/* ── platform ──────────────────────────────────────────────── */

export function markNotificationsRead(ids: string[]): Promise<ActionResult> {
  if (ids.length === 0) return Promise.resolve(ok(undefined, ''));
  return command(async () => {
    await api.markNotificationsRead(ids);
  }, '');
}

export function dismissNotification(id: string): Promise<ActionResult> {
  return command(async () => {
    await api.dismissNotification(id);
  }, 'Notification dismissed');
}

export function updateSettings(patch: Partial<AppState['settings']>): Promise<ActionResult> {
  return command(async () => {
    await api.updateSettings(patch);
  }, 'Settings saved for everyone in this organisation');
}

export function updateUser(
  id: string,
  patch: { role?: Role; isActive?: boolean },
  reason = 'Account updated by an administrator',
): Promise<ActionResult> {
  return command(async () => {
    await api.updateUserAccount(id, { ...patch, reason });
  }, 'Account updated');
}

export function acknowledgeDocument(id: string): Promise<ActionResult> {
  return command(async () => {
    await api.acknowledgeDocument(id);
  }, 'Document acknowledged');
}

export function generateDocument(employeeId: string, kind: string): Promise<ActionResult<{ id: string; fileName: string }>> {
  const mapped =
    kind.toUpperCase().includes('SALARY') || kind.toUpperCase().includes('CERTIFICATE')
      ? 'SALARY_CERTIFICATE'
      : 'EMPLOYMENT_LETTER';
  return command(
    () => api.generateDocument({ kind: mapped, employeeId }),
    'Demo document generated — a real PDF is ready to download',
  );
}

export function generatePayslipDocument(employeeId: string, payslipId: string): Promise<ActionResult<{ id: string; fileName: string }>> {
  return command(
    () => api.generateDocument({ kind: 'PAYSLIP', employeeId, payslipId }),
    'Payslip PDF generated',
  );
}

export function saveView(
  module: string,
  name: string,
  filters: Record<string, string>,
): Promise<ActionResult> {
  if (!name.trim()) return Promise.resolve(fail('Name this view.', 'name'));
  return command(async () => {
    await api.saveView({ view: module, name: name.trim(), config: filters });
  }, 'View saved');
}

export function deleteView(id: string): Promise<ActionResult> {
  return command(async () => {
    await api.deleteSavedView(id);
  }, 'View deleted');
}

/* ── derived helpers ───────────────────────────────────────── */

/** Sum of the net pay the server has stored for a period. */
export function payrunNetTotal(state: AppState, payrunId: string): string {
  return toMoneyString(
    state.payslips
      .filter((payslip) => payslip.payrunId === payrunId && payslip.status !== 'CANCELLED')
      .reduce((sum, payslip) => addMoney(sum, payslip.net), money(0)),
  );
}

/** The month after the one given — used when proposing the next payroll period. */
export function nextPeriod(from: ISODate): { start: ISODate; end: ISODate } {
  const start = monthStart(addMonths(from, 1));
  return { start, end: monthEnd(start) };
}
