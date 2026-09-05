import type { Role } from '@shared/types.js';

export const PERMISSION_MATRIX = Object.freeze({
  'employee.read.self': [
    'EMPLOYEE',
    'HR_MANAGER',
    'HR_PAYROLL_USER',
    'HR_PAYROLL_MANAGER',
    'ADMIN',
  ],
  'employee.read.all': ['HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'employee.write': ['HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'employee.archive': ['HR_MANAGER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'contract.read.self': [
    'EMPLOYEE',
    'HR_MANAGER',
    'HR_PAYROLL_USER',
    'HR_PAYROLL_MANAGER',
    'ADMIN',
  ],
  'contract.read.all': ['HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'contract.write': ['HR_MANAGER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'schedule.read': ['EMPLOYEE', 'HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'schedule.write': ['HR_MANAGER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'attendance.read.self': [
    'EMPLOYEE',
    'HR_MANAGER',
    'HR_PAYROLL_USER',
    'HR_PAYROLL_MANAGER',
    'ADMIN',
  ],
  'attendance.read.all': ['HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'attendance.self.punch': [
    'EMPLOYEE',
    'HR_MANAGER',
    'HR_PAYROLL_USER',
    'HR_PAYROLL_MANAGER',
    'ADMIN',
  ],
  'attendance.correct': ['HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'timeoff.request.self': [
    'EMPLOYEE',
    'HR_MANAGER',
    'HR_PAYROLL_USER',
    'HR_PAYROLL_MANAGER',
    'ADMIN',
  ],
  'timeoff.read.all': ['HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'timeoff.approve': ['HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'timeoff.allocate': ['HR_MANAGER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'salary.structure.read': ['HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'salary.structure.write': ['HR_PAYROLL_MANAGER', 'ADMIN'],
  'salary.rule.write': ['HR_PAYROLL_MANAGER', 'ADMIN'],
  'payrun.read': ['HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'payrun.create': ['HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'payrun.compute': ['HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'payrun.validate': ['HR_PAYROLL_MANAGER', 'ADMIN'],
  'payrun.pay': ['HR_PAYROLL_MANAGER', 'ADMIN'],
  'payrun.reopen': ['HR_PAYROLL_MANAGER', 'ADMIN'],
  'payrun.freeze': ['HR_PAYROLL_MANAGER', 'ADMIN'],
  'payslip.read.self': ['EMPLOYEE', 'HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'payslip.read.all': ['HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'payslip.send': ['HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'simulation.run': ['HR_PAYROLL_MANAGER', 'ADMIN'],
  'report.hr': ['HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'report.payroll': ['HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'report.self': ['EMPLOYEE', 'HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'document.read.self': [
    'EMPLOYEE',
    'HR_MANAGER',
    'HR_PAYROLL_USER',
    'HR_PAYROLL_MANAGER',
    'ADMIN',
  ],
  'document.read.all': ['HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN'],
  'audit.read': ['HR_PAYROLL_MANAGER', 'ADMIN'],
  'admin.users': ['ADMIN'],
  'admin.settings': ['ADMIN'],
  'ops.dashboard': ['ADMIN'],
} as const satisfies Record<string, readonly Role[]>);

export type Permission = keyof typeof PERMISSION_MATRIX;

export function permissionsForRole(role: Role): Permission[] {
  return (Object.entries(PERMISSION_MATRIX) as [Permission, readonly Role[]][])
    .filter(([, roles]) => roles.includes(role))
    .map(([permission]) => permission);
}

export function roleHasPermission(role: Role, permission: Permission) {
  return (PERMISSION_MATRIX[permission] as readonly Role[]).includes(role);
}
