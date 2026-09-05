/**
 * The permission matrix. One frozen source of truth, consulted by the server
 * on every route and by the client for navigation, commands and controls.
 *
 * Hiding a link is NOT authorization — the server check is. The client uses
 * this table only so it never offers an action that would be refused.
 */
import type { Role } from './types.js';

export const PERMISSIONS = [
  // people
  'employee.read.self',
  'employee.read.all',
  'employee.write',
  'employee.archive',
  'contract.read.self',
  'contract.read.all',
  'contract.write',
  'schedule.read',
  'schedule.write',
  // time
  'attendance.read.self',
  'attendance.read.all',
  'attendance.self.punch',
  'attendance.correct',
  'timeoff.request.self',
  'timeoff.read.all',
  'timeoff.approve',
  'timeoff.allocate',
  // salary & payroll
  'salary.structure.read',
  'salary.structure.write',
  'salary.rule.write',
  'payrun.read',
  'payrun.create',
  'payrun.compute',
  'payrun.validate',
  'payrun.pay',
  'payrun.freeze',
  'payrun.reopen',
  'payslip.read.self',
  'payslip.read.all',
  'payslip.send',
  'simulation.run',
  // insight
  'report.self',
  'report.hr',
  'report.payroll',
  'document.read.self',
  'document.read.all',
  'document.write',
  'audit.read',
  // system
  'approval.read',
  'admin.users',
  'admin.settings',
  'ops.dashboard',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const EMPLOYEE: Permission[] = [
  'employee.read.self',
  'contract.read.self',
  'schedule.read',
  'attendance.read.self',
  'attendance.self.punch',
  'timeoff.request.self',
  'payslip.read.self',
  'report.self',
  'document.read.self',
];

const HR_MANAGER: Permission[] = [
  ...EMPLOYEE,
  'employee.read.all',
  'employee.write',
  'employee.archive',
  'contract.read.all',
  'contract.write',
  'schedule.write',
  'attendance.read.all',
  'attendance.correct',
  'timeoff.read.all',
  'timeoff.approve',
  'timeoff.allocate',
  'report.hr',
  'document.read.all',
  'document.write',
  'approval.read',
];

/** HR Payroll User: HR capabilities plus payrun operation. Salary config is read-only. */
const HR_PAYROLL_USER: Permission[] = [
  ...HR_MANAGER.filter((p) => p !== 'contract.write' && p !== 'schedule.write' && p !== 'employee.archive'),
  'salary.structure.read',
  'payrun.read',
  'payrun.create',
  'payrun.compute',
  'payslip.read.all',
  'payslip.send',
  'report.payroll',
];

const HR_PAYROLL_MANAGER: Permission[] = [
  ...new Set<Permission>([
    ...HR_MANAGER,
    ...HR_PAYROLL_USER,
    'salary.structure.write',
    'salary.rule.write',
    'payrun.validate',
    'payrun.pay',
    'payrun.freeze',
    'payrun.reopen',
    'simulation.run',
    'audit.read',
  ]),
];

const ADMIN: Permission[] = [...PERMISSIONS];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  EMPLOYEE: new Set(EMPLOYEE),
  HR_MANAGER: new Set(HR_MANAGER),
  HR_PAYROLL_USER: new Set(HR_PAYROLL_USER),
  HR_PAYROLL_MANAGER: new Set(HR_PAYROLL_MANAGER),
  ADMIN: new Set(ADMIN),
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

export function canAny(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

export function permissionsFor(role: Role): Permission[] {
  return [...MATRIX[role]];
}

/* ── Route access ──────────────────────────────────────────── */

/** Every navigable view and the permission that gates it. */
export const VIEW_PERMISSION: Record<string, Permission | null> = {
  home: null,
  employees: 'employee.read.all',
  contracts: 'contract.read.self',
  schedules: 'schedule.read',
  attendance: 'attendance.read.self',
  timeoff: 'timeoff.request.self',
  approvals: 'approval.read',
  payroll: 'payrun.read',
  payslips: 'payslip.read.self',
  exceptions: 'payrun.read',
  salary: 'salary.structure.read',
  simulation: 'simulation.run',
  reports: 'report.self',
  documents: 'document.read.self',
  audit: 'audit.read',
  settings: 'admin.settings',
  users: 'admin.users',
  ops: 'ops.dashboard',
};

export function canAccessView(role: Role, view: string): boolean {
  const required = VIEW_PERMISSION[view];
  if (required === undefined) return false;
  if (required === null) return true;
  return can(role, required);
}

/** Employees may only ever see their own rows in shared modules. */
export function isSelfScoped(role: Role): boolean {
  return role === 'EMPLOYEE';
}
