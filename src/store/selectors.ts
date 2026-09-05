/**
 * Derived views of state. Nothing here is stored — every number a screen
 * shows comes from one of these functions, so no two screens can disagree.
 *
 * Selectors are pure: (state, …) => value.
 */
import { addMoney, money, subtractMoney, toMoneyString } from '@shared/money';
import { can, isSelfScoped } from '@shared/permissions';
import type {
  AppNotification,
  ApprovalItem,
  Contract,
  Employee,
  NextBestAction,
  PayrollException,
  Payrun,
  Payslip,
  Role,
  User,
} from '@shared/types';
import {
  addDays,
  diffDays,
  formatDate,
  isWorkingDay,
  monthLabel,
  nextWorkingDay,
  rangeOverlaps,
} from '@shared/dates';
import type { AppState } from './state';
import { computeExceptions, computeReadiness, payrunTotals, scheduleCtx } from './payroll';
import { EXPIRY_HORIZON_DAYS } from '@/data/seed';

/* ── session ───────────────────────────────────────────────── */

export function currentUser(s: AppState): User {
  return s.users.find((u) => u.id === s.currentUserId) ?? s.users[0];
}

export function currentRole(s: AppState): Role {
  return currentUser(s).role;
}

export function currentEmployee(s: AppState): Employee | undefined {
  const u = currentUser(s);
  return u.employeeId ? s.employees.find((e) => e.id === u.employeeId) : undefined;
}

/** Rows this session may see in a shared module. Employees see only themselves. */
export function visibleEmployees(s: AppState): Employee[] {
  const role = currentRole(s);
  if (isSelfScoped(role)) {
    const me = currentEmployee(s);
    return me ? [me] : [];
  }
  return s.employees.filter((e) => e.status !== 'ARCHIVED');
}

export function scopeIds(s: AppState): Set<string> | null {
  return isSelfScoped(currentRole(s)) ? new Set([currentUser(s).employeeId ?? '']) : null;
}

/* ── lookups ───────────────────────────────────────────────── */

export function empById(s: AppState, id: string | null | undefined): Employee | undefined {
  return id ? s.employees.find((e) => e.id === id) : undefined;
}
export function empName(s: AppState, id: string | null | undefined): string {
  return empById(s, id)?.fullName ?? 'Unknown';
}
export function deptName(s: AppState, id: string | null | undefined): string {
  return s.departments.find((d) => d.id === id)?.name ?? '—';
}
export function positionName(s: AppState, id: string | null | undefined): string {
  return s.jobPositions.find((p) => p.id === id)?.title ?? '—';
}
export function scheduleName(s: AppState, id: string | null | undefined): string {
  return s.schedules.find((x) => x.id === id)?.name ?? '—';
}
export function leaveTypeName(s: AppState, id: string): string {
  return s.leaveTypes.find((t) => t.id === id)?.name ?? id;
}

export function activePayrun(s: AppState): Payrun {
  return s.payruns.find((p) => p.id === s.activePayrunId) ?? s.payruns[s.payruns.length - 1];
}

export function payrunById(s: AppState, id: string): Payrun | undefined {
  return s.payruns.find((p) => p.id === id);
}

export function payslipsOf(s: AppState, payrunId: string): Payslip[] {
  return s.payslips.filter((p) => p.payrunId === payrunId);
}

/** The current contract for an employee, by today's date. */
export function currentContract(s: AppState, employeeId: string): Contract | undefined {
  return s.contracts.find(
    (c) =>
      c.employeeId === employeeId &&
      c.status === 'ACTIVE' &&
      c.startDate <= s.today &&
      (!c.endDate || c.endDate >= s.today),
  );
}

export function contractsOf(s: AppState, employeeId: string): Contract[] {
  return s.contracts
    .filter((c) => c.employeeId === employeeId)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export function contractPhase(s: AppState, c: Contract): 'current' | 'past' | 'upcoming' {
  if (c.startDate > s.today) return 'upcoming';
  if (c.endDate && c.endDate < s.today) return 'past';
  return 'current';
}

export function expiringContracts(s: AppState): Contract[] {
  return s.contracts.filter((c) => {
    if (c.status !== 'ACTIVE' || !c.endDate) return false;
    const d = diffDays(c.endDate, s.today);
    return d >= 0 && d <= EXPIRY_HORIZON_DAYS;
  });
}

export function probationEnding(s: AppState): Employee[] {
  return s.employees.filter((e) => {
    if (e.status !== 'PROBATION' || !e.probationEndDate) return false;
    const d = diffDays(e.probationEndDate, s.today);
    return d >= 0 && d <= 14;
  });
}

/* ── payroll derivations ───────────────────────────────────── */

export function exceptionsFor(s: AppState, payrun: Payrun): PayrollException[] {
  return computeExceptions(s, payrun);
}

export function readinessFor(s: AppState, payrun: Payrun) {
  return computeReadiness(exceptionsFor(s, payrun), payrun);
}

export function totalsFor(s: AppState, payrunId: string) {
  return payrunTotals(payslipsOf(s, payrunId));
}

export function canValidate(s: AppState, payrun: Payrun): { ok: boolean; reason: string } {
  if (payrun.status !== 'COMPUTED') {
    return { ok: false, reason: `Payrun must be computed first (currently ${payrun.status}).` };
  }
  const blocking = exceptionsFor(s, payrun).filter((e) => e.blocking);
  if (blocking.length > 0) {
    return {
      ok: false,
      reason: `${blocking.length} blocking exception${blocking.length === 1 ? '' : 's'} must be resolved first.`,
    };
  }
  if (!can(currentRole(s), 'payrun.validate')) {
    return { ok: false, reason: 'Your role cannot validate payroll.' };
  }
  return { ok: true, reason: '' };
}

/* ── approvals ─────────────────────────────────────────────── */

export function approvalItems(s: AppState): ApprovalItem[] {
  const items: ApprovalItem[] = [];

  for (const r of s.leaveRequests) {
    if (r.status !== 'PENDING') continue;
    items.push({
      id: `ap-leave-${r.id}`,
      type: 'LEAVE',
      employeeId: r.employeeId,
      title: `${leaveTypeName(s, r.leaveTypeId)} · ${r.days} day${r.days === 1 ? '' : 's'}`,
      detail: `${formatDate(r.fromDate)} → ${formatDate(r.toDate)}${r.reason ? ` · ${r.reason}` : ''}`,
      submittedAt: r.createdAt,
      status: r.status,
      refId: r.id,
    });
  }
  for (const p of s.profileChangeRequests) {
    if (p.status !== 'PENDING') continue;
    items.push({
      id: `ap-profile-${p.id}`,
      type: 'PROFILE',
      employeeId: p.employeeId,
      title: `${p.field} change`,
      detail: `${p.currentValue} → ${p.requestedValue}`,
      submittedAt: p.requestedAt,
      status: p.status,
      refId: p.id,
    });
  }
  for (const c of s.salaryChangeRequests) {
    if (c.status !== 'PENDING') continue;
    items.push({
      id: `ap-salary-${c.id}`,
      type: 'SALARY',
      employeeId: c.employeeId,
      title: 'Salary revision',
      detail: `₹${c.currentWage} → ₹${c.requestedWage}, effective ${formatDate(c.effectiveFrom)}`,
      submittedAt: c.createdAt,
      status: c.status,
      refId: c.id,
    });
  }

  return items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export function pendingApprovalCount(s: AppState): number {
  return can(currentRole(s), 'approval.read') ? approvalItems(s).length : 0;
}

/* ── notifications (derived, never hand-written) ───────────── */

export function notifications(s: AppState): AppNotification[] {
  const role = currentRole(s);
  const out: AppNotification[] = [];
  const payrun = activePayrun(s);
  const push = (n: Omit<AppNotification, 'readAt'>) => {
    if (s.dismissedNotificationIds.includes(n.id)) return;
    if (!n.roles.includes(role)) return;
    out.push({ ...n, readAt: s.readNotificationIds.includes(n.id) ? s.today : null });
  };

  const payrollRoles: Role[] = ['HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'];
  const hrRoles: Role[] = ['HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'];

  if (can(role, 'payrun.read')) {
    const exceptions = exceptionsFor(s, payrun);
    const blocking = exceptions.filter((e) => e.blocking).length;
    const readiness = computeReadiness(exceptions, payrun);
    const label = monthLabel(payrun.periodStart);

    // Text follows the real state. 3 blockers never reads "ready to validate".
    if (payrun.status === 'PAID') {
      push({
        id: `n-payrun-paid-${payrun.id}`,
        kind: 'PAYRUN',
        title: `${label} payroll marked paid`,
        body: `${payslipsOf(s, payrun.id).filter((p) => !p.isDuplicate).length} payslips are ready to send.`,
        severity: 'success',
        createdAt: payrun.paidAt ?? s.today,
        link: '/payroll',
        roles: payrollRoles,
      });
    } else if (payrun.status === 'VALIDATED') {
      push({
        id: `n-payrun-validated-${payrun.id}`,
        kind: 'PAYRUN',
        title: `${label} payroll ready for payment`,
        body: 'Validated with zero blocking exceptions.',
        severity: 'info',
        createdAt: payrun.validatedAt ?? s.today,
        link: '/payroll',
        roles: payrollRoles,
      });
    } else if (blocking > 0) {
      push({
        id: `n-payrun-blocked-${payrun.id}-${blocking}`,
        kind: 'PAYRUN',
        title: `${label} payroll has ${blocking} blocker${blocking === 1 ? '' : 's'}`,
        body: `Readiness ${readiness.score}%. Resolve them to validate.`,
        severity: 'warning',
        createdAt: s.today,
        link: '/payroll/exceptions',
        roles: payrollRoles,
      });
    } else if (payrun.status === 'COMPUTED') {
      push({
        id: `n-payrun-ready-${payrun.id}`,
        kind: 'PAYRUN',
        title: `${label} payroll ready to validate`,
        body: 'Readiness 100%. No blocking exceptions remain.',
        severity: 'success',
        createdAt: s.today,
        link: '/payroll',
        roles: payrollRoles,
      });
    } else {
      push({
        id: `n-payrun-draft-${payrun.id}`,
        kind: 'PAYRUN',
        title: `${label} payroll not computed`,
        body: `${payrun.employeeIds.length} employees selected. Compute to generate payslips.`,
        severity: 'info',
        createdAt: s.today,
        link: '/payroll',
        roles: payrollRoles,
      });
    }
  }

  const failed = s.outbox.filter((m) => m.status === 'FAILED');
  if (failed.length > 0) {
    push({
      id: `n-delivery-failed-${failed.length}`,
      kind: 'DELIVERY',
      title: `${failed.length} payslip deliver${failed.length === 1 ? 'y' : 'ies'} failed`,
      body: 'Payroll amounts are unaffected. Retry from the outbox.',
      severity: 'danger',
      createdAt: s.today,
      link: '/payroll/delivery',
      roles: payrollRoles,
    });
  }

  const pending = approvalItems(s).length;
  if (pending > 0) {
    push({
      id: `n-approvals-${pending}`,
      kind: 'APPROVAL',
      title: `${pending} approval${pending === 1 ? '' : 's'} waiting`,
      body: 'Leave, profile and salary requests in your inbox.',
      severity: 'info',
      createdAt: s.today,
      link: '/approvals',
      roles: hrRoles,
    });
  }

  for (const c of expiringContracts(s)) {
    const days = diffDays(c.endDate!, s.today);
    push({
      id: `n-contract-${c.id}`,
      kind: 'CONTRACT',
      title: `${empName(s, c.employeeId)}'s contract expires in ${days} day${days === 1 ? '' : 's'}`,
      body: `${c.contractRef} ends on ${formatDate(c.endDate)}.`,
      severity: 'warning',
      createdAt: s.today,
      link: '/contracts',
      roles: hrRoles,
    });
  }

  for (const e of probationEnding(s)) {
    const days = diffDays(e.probationEndDate!, s.today);
    push({
      id: `n-probation-${e.id}`,
      kind: 'PROBATION',
      title: `${e.fullName}'s probation ends in ${days} day${days === 1 ? '' : 's'}`,
      body: `Confirm or extend before ${formatDate(e.probationEndDate)}.`,
      severity: 'info',
      createdAt: s.today,
      link: `/employees/${e.id}`,
      roles: hrRoles,
    });
  }

  /* employee-facing */
  const me = currentEmployee(s);
  if (me && role === 'EMPLOYEE') {
    const mine = s.leaveRequests.filter((r) => r.employeeId === me.id && r.status === 'PENDING');
    if (mine.length > 0) {
      push({
        id: `n-my-leave-${mine.length}`,
        kind: 'LEAVE',
        title: `${mine.length} leave request${mine.length === 1 ? '' : 's'} awaiting approval`,
        body: 'You will be notified once a decision is made.',
        severity: 'info',
        createdAt: s.today,
        link: '/timeoff',
        roles: ['EMPLOYEE'],
      });
    }
    const open = s.attendance.find((a) => a.employeeId === me.id && a.checkIn && !a.checkOut);
    if (open) {
      push({
        id: `n-my-checkout-${open.id}`,
        kind: 'ATTENDANCE',
        title: 'You are still checked in',
        body: `Checked in at ${open.checkIn} on ${formatDate(open.date)}.`,
        severity: 'warning',
        createdAt: s.today,
        link: '/attendance',
        roles: ['EMPLOYEE'],
      });
    }
  }

  return out;
}

export function unreadNotificationCount(s: AppState): number {
  return notifications(s).filter((n) => !n.readAt).length;
}

/* ── next best action (X05) ────────────────────────────────── */

export function nextBestAction(s: AppState): NextBestAction {
  const role = currentRole(s);
  const me = currentEmployee(s);

  if (role === 'EMPLOYEE' && me) {
    const open = s.attendance.find((a) => a.employeeId === me.id && a.checkIn && !a.checkOut);
    if (open) {
      return {
        id: 'nba-checkout',
        label: 'Check out',
        reason: `You checked in at ${open.checkIn} on ${formatDate(open.date)} and have not checked out.`,
        to: '/attendance',
        cta: 'Go to attendance',
        tone: 'urgent',
      };
    }
    const undecided = s.leaveRequests.filter(
      (r) => r.employeeId === me.id && r.status === 'PENDING',
    );
    if (undecided.length > 0) {
      return {
        id: 'nba-my-leave',
        label: `${undecided.length} leave request${undecided.length === 1 ? '' : 's'} pending`,
        reason: 'Your manager has not decided yet. You can still cancel or edit.',
        to: '/timeoff',
        cta: 'View requests',
        tone: 'default',
      };
    }
    const unack = s.documents.find((d) => d.employeeId === me.id && !d.acknowledgedAt);
    if (unack) {
      return {
        id: 'nba-ack',
        label: 'Acknowledge a document',
        reason: `${unack.fileName} is waiting for your acknowledgement.`,
        to: '/documents',
        cta: 'Open documents',
        tone: 'default',
      };
    }
    return {
      id: 'nba-employee-ok',
      label: 'Nothing needs you right now',
      reason: 'Attendance, leave and documents are all up to date.',
      to: '/payslips',
      cta: 'View my payslips',
      tone: 'default',
    };
  }

  if (can(role, 'payrun.read')) {
    const payrun = activePayrun(s);
    const exceptions = exceptionsFor(s, payrun);
    const blocking = exceptions.filter((e) => e.blocking);
    const label = monthLabel(payrun.periodStart);

    if (blocking.length > 0) {
      return {
        id: 'nba-blockers',
        label: `Resolve ${blocking.length} payroll exception${blocking.length === 1 ? '' : 's'}`,
        reason: `${label} payroll cannot be validated until every blocking exception is cleared.`,
        to: '/payroll/exceptions',
        cta: 'Open exception centre',
        tone: 'urgent',
      };
    }
    if (payrun.status === 'DRAFT') {
      return {
        id: 'nba-compute',
        label: `Compute ${label} payroll`,
        reason: `${payrun.employeeIds.length} employees are selected and no exceptions are blocking.`,
        to: '/payroll',
        cta: 'Open payroll',
        tone: 'default',
      };
    }
    if (payrun.status === 'COMPUTED') {
      return {
        id: 'nba-validate',
        label: `Validate ${label} payroll`,
        reason: 'Readiness is 100% and every input is clean.',
        to: '/payroll',
        cta: 'Open payroll',
        tone: 'default',
      };
    }
    if (payrun.status === 'VALIDATED') {
      return {
        id: 'nba-pay',
        label: `Mark ${label} payroll paid`,
        reason: 'Validated and authorised. Marking it paid locks the results.',
        to: '/payroll',
        cta: 'Open payroll',
        tone: 'default',
      };
    }
    const undelivered = payslipsOf(s, payrun.id).filter(
      (p) => !p.isDuplicate && p.delivery !== 'SENT',
    );
    if (undelivered.length > 0) {
      return {
        id: 'nba-send',
        label: `Send ${undelivered.length} payslip${undelivered.length === 1 ? '' : 's'}`,
        reason: 'Payroll is paid; payslips have not all reached employees yet.',
        to: '/payroll/delivery',
        cta: 'Open delivery',
        tone: 'default',
      };
    }
  }

  const pending = approvalItems(s);
  if (pending.length > 0 && can(role, 'approval.read')) {
    return {
      id: 'nba-approvals',
      label: `Review ${pending.length} approval${pending.length === 1 ? '' : 's'}`,
      reason: 'Leave, profile and salary requests are waiting on a decision.',
      to: '/approvals',
      cta: 'Open inbox',
      tone: 'default',
    };
  }

  const expiring = expiringContracts(s);
  if (expiring.length > 0 && can(role, 'contract.read.all')) {
    return {
      id: 'nba-contracts',
      label: `Renew ${expiring.length} contract${expiring.length === 1 ? '' : 's'}`,
      reason: `Ending within ${EXPIRY_HORIZON_DAYS} days. Renew or close before payroll depends on them.`,
      to: '/contracts',
      cta: 'Open contracts',
      tone: 'default',
    };
  }

  return {
    id: 'nba-clear',
    label: 'Everything is on track',
    reason: 'No blockers, no pending approvals and no contracts needing attention.',
    to: '/reports',
    cta: 'Open reports',
    tone: 'default',
  };
}

/* ── employee self-service derivations ─────────────────────── */

export function nextShift(s: AppState, employee: Employee): string | null {
  const ctx = scheduleCtx(s, employee.workingScheduleId);
  // "Next" means strictly after today unless today is still scheduled and unworked.
  const todayRecord = s.attendance.find((a) => a.employeeId === employee.id && a.date === s.today);
  if (isWorkingDay(s.today, ctx) && !todayRecord) return s.today;
  return nextWorkingDay(addDays(s.today, 1), ctx);
}

/** Days actually worked so far this month — from attendance, never a guess. */
export function workedDaysThisPeriod(s: AppState, employeeId: string, payrun: Payrun): number {
  return s.attendance.filter(
    (a) =>
      a.employeeId === employeeId &&
      a.date >= payrun.periodStart &&
      a.date <= s.today &&
      a.date <= payrun.periodEnd &&
      a.checkIn !== null &&
      a.status !== 'ABSENT',
  ).length;
}

export function leaveBalance(s: AppState, employeeId: string, leaveTypeId: string) {
  const alloc = s.leaveAllocations.find(
    (a) => a.employeeId === employeeId && a.leaveTypeId === leaveTypeId,
  );
  if (!alloc) return { allocated: 0, used: 0, remaining: 0, exists: false };
  return {
    allocated: alloc.allocated + alloc.carriedForward,
    used: alloc.used,
    remaining: alloc.allocated + alloc.carriedForward - alloc.used,
    exists: true,
  };
}

/* ── reports ───────────────────────────────────────────────── */

export interface ReportFilters {
  payrunId: string;
  departmentId: string | 'ALL';
  employeeType: string | 'ALL';
}

export function filteredPayslips(s: AppState, f: ReportFilters): Payslip[] {
  return s.payslips.filter((p) => {
    if (p.payrunId !== f.payrunId || p.isDuplicate || p.status === 'CANCELLED') return false;
    const emp = empById(s, p.employeeId);
    if (!emp) return false;
    if (f.departmentId !== 'ALL' && emp.departmentId !== f.departmentId) return false;
    if (f.employeeType !== 'ALL' && emp.employeeType !== f.employeeType) return false;
    return true;
  });
}

export function filteredEmployees(s: AppState, f: ReportFilters): Employee[] {
  return s.employees.filter((e) => {
    if (e.status === 'ARCHIVED' || e.status === 'EXITED') return false;
    if (f.departmentId !== 'ALL' && e.departmentId !== f.departmentId) return false;
    if (f.employeeType !== 'ALL' && e.employeeType !== f.employeeType) return false;
    return true;
  });
}

export function salaryCostByDepartment(s: AppState, f: ReportFilters) {
  const slips = filteredPayslips(s, f);
  return s.departments
    .map((d) => {
      const rows = slips.filter((p) => empById(s, p.employeeId)?.departmentId === d.id);
      return {
        id: d.id,
        label: d.name,
        value: rows.reduce((sum, p) => addMoney(sum, p.net), money(0)).toNumber(),
        budget: money(d.monthlyBudget).toNumber(),
        count: rows.length,
      };
    })
    .filter((r) => r.count > 0 || f.departmentId === 'ALL');
}

export function headcountByDepartment(s: AppState, f: ReportFilters) {
  const emps = filteredEmployees(s, f);
  return s.departments
    .map((d) => ({
      id: d.id,
      label: d.name,
      value: emps.filter((e) => e.departmentId === d.id).length,
    }))
    .filter((r) => r.value > 0 || f.departmentId === 'ALL');
}

export function netTrend(s: AppState, months = 12) {
  return s.payruns
    .slice()
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
    .slice(-months)
    .map((p) => ({
      id: p.id,
      label: monthLabel(p.periodStart).replace(' 2026', ''),
      value: payrunTotals(payslipsOf(s, p.id)).net,
      status: p.status,
    }));
}

export function attendanceHealth(s: AppState, f: ReportFilters) {
  const payrun = payrunById(s, f.payrunId);
  if (!payrun) return [];

  // At full dataset size the browser holds a working set, not every punch.
  // When the server has aggregated the period in SQL, use that — an unfiltered
  // chart must never quietly describe only the rows that happen to be loaded.
  if (s.attendanceSummary && f.departmentId === 'ALL' && f.employeeType === 'ALL') {
    const total = s.attendanceSummary;
    return [
      { id: 'present', label: 'On time', value: total.PRESENT ?? 0 },
      { id: 'late', label: 'Late', value: total.LATE ?? 0 },
      { id: 'ot', label: 'Overtime', value: total.OVERTIME ?? 0 },
      { id: 'absent', label: 'Absent', value: total.ABSENT ?? 0 },
      { id: 'missing', label: 'Missing checkout', value: total.MISSING_CHECKOUT ?? 0 },
    ];
  }
  const ids = new Set(filteredEmployees(s, f).map((e) => e.id));
  const rows = s.attendance.filter(
    (a) => ids.has(a.employeeId) && a.date >= payrun.periodStart && a.date <= payrun.periodEnd,
  );
  const count = (fn: (a: (typeof rows)[number]) => boolean) => rows.filter(fn).length;
  return [
    { id: 'present', label: 'On time', value: count((a) => a.status === 'PRESENT') },
    { id: 'late', label: 'Late', value: count((a) => a.status === 'LATE') },
    { id: 'ot', label: 'Overtime', value: count((a) => a.status === 'OVERTIME') },
    { id: 'absent', label: 'Absent', value: count((a) => a.status === 'ABSENT') },
    {
      id: 'missing',
      label: 'Missing checkout',
      value: count((a) => a.status === 'MISSING_CHECKOUT'),
    },
  ];
}

export function leaveSummary(s: AppState, f: ReportFilters) {
  const payrun = payrunById(s, f.payrunId);
  if (!payrun) return [];
  const ids = new Set(filteredEmployees(s, f).map((e) => e.id));
  return s.leaveTypes.map((t) => ({
    id: t.id,
    label: t.name,
    value: s.leaveRequests
      .filter(
        (r) =>
          ids.has(r.employeeId) &&
          r.leaveTypeId === t.id &&
          r.status === 'APPROVED' &&
          rangeOverlaps(r.fromDate, r.toDate, payrun.periodStart, payrun.periodEnd),
      )
      .reduce((sum, r) => sum + r.days, 0),
  }));
}

export function salaryDistribution(s: AppState, f: ReportFilters) {
  const bands = [
    { id: 'b1', label: '< ₹40K', lo: 0, hi: 40000 },
    { id: 'b2', label: '₹40–60K', lo: 40000, hi: 60000 },
    { id: 'b3', label: '₹60–80K', lo: 60000, hi: 80000 },
    { id: 'b4', label: '₹80K–1L', lo: 80000, hi: 100000 },
    { id: 'b5', label: '> ₹1L', lo: 100000, hi: Infinity },
  ];
  const emps = filteredEmployees(s, f);
  return bands.map((b) => ({
    id: b.id,
    label: b.label,
    value: emps.filter((e) => {
      const c = currentContract(s, e.id);
      if (!c) return false;
      const w = money(c.wage).toNumber();
      return w >= b.lo && w < b.hi;
    }).length,
  }));
}

/** Month-over-month variance per department, from payslips only. */
export function payrollVariance(s: AppState, f: ReportFilters) {
  const current = payrunById(s, f.payrunId);
  if (!current) return [];
  const prev = s.payruns
    .filter((p) => p.periodStart < current.periodStart)
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0];
  if (!prev) return [];

  const sum = (payrunId: string, deptId: string) =>
    s.payslips
      .filter(
        (p) =>
          p.payrunId === payrunId &&
          !p.isDuplicate &&
          empById(s, p.employeeId)?.departmentId === deptId,
      )
      .reduce((acc, p) => addMoney(acc, p.net), money(0));

  return s.departments
    .map((d) => {
      const now = sum(current.id, d.id);
      const before = sum(prev.id, d.id);
      return {
        id: d.id,
        label: d.name,
        current: toMoneyString(now),
        previous: toMoneyString(before),
        delta: toMoneyString(subtractMoney(now, before)),
        pct: before.isZero()
          ? 0
          : subtractMoney(now, before).div(before).times(100).toDecimalPlaces(1).toNumber(),
      };
    })
    .filter((r) => r.current !== '0.00' || r.previous !== '0.00');
}
