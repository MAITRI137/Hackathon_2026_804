import { describe, expect, it } from 'vitest';

import { permissionsForRole, roleHasPermission } from '../core/rbac/matrix.js';

describe('role permission matrix', () => {
  it('keeps HR managers away from payroll administration and confidential analytics', () => {
    expect(roleHasPermission('HR_MANAGER', 'employee.read.all')).toBe(true);
    expect(roleHasPermission('HR_MANAGER', 'payrun.read')).toBe(false);
    expect(roleHasPermission('HR_MANAGER', 'payrun.compute')).toBe(false);
    expect(roleHasPermission('HR_MANAGER', 'report.payroll')).toBe(false);
  });

  it('separates payroll preparation from approval', () => {
    expect(roleHasPermission('HR_PAYROLL_USER', 'payrun.compute')).toBe(true);
    expect(roleHasPermission('HR_PAYROLL_USER', 'payrun.validate')).toBe(false);
    expect(roleHasPermission('HR_PAYROLL_MANAGER', 'payrun.validate')).toBe(true);
    expect(roleHasPermission('HR_PAYROLL_MANAGER', 'payrun.pay')).toBe(true);
  });

  it('gives administrators the explicit operations permission', () => {
    expect(permissionsForRole('ADMIN')).toContain('ops.dashboard');
    expect(permissionsForRole('EMPLOYEE')).not.toContain('ops.dashboard');
  });
});
