import { afterAll, describe, expect, it } from 'vitest';

import { disconnectDatabase, prisma } from '../db/prisma.js';

/** The seed is sized by a record budget; the suite asserts that contract. */
const RECORD_BUDGET = 5000;

describe('deterministic demo database', () => {
  afterAll(disconnectDatabase);

  it('contains the linked records required for the payroll story', async () => {
    const [users, departments, employees, contracts, bank, payruns] = await prisma.$transaction([
      prisma.user.count(),
      prisma.department.count(),
      prisma.employee.count(),
      prisma.contract.count(),
      prisma.employeeBankDetail.count(),
      prisma.payrun.count(),
    ]);

    expect(users).toBe(5);
    expect(departments).toBe(8);
    expect(payruns).toBe(4);

    // Every employee is payable: one applicable contract, one bank record.
    expect(employees).toBeGreaterThanOrEqual(42);
    expect(contracts).toBeGreaterThanOrEqual(employees);
    // Exactly one seeded employee is missing bank details — that is the demo's
    // first payroll blocker, and it must not be diluted by scaling.
    expect(employees - bank).toBe(1);

    const activePayrun = await prisma.payrun.findUnique({
      where: { id: 'PR-2026-09' },
      include: { employees: true },
    });

    expect(activePayrun?.status).toBe('DRAFT');
    // The open payrun covers the whole organisation.
    expect(activePayrun?.employees).toHaveLength(employees);

    // The narrated story survives scaling.
    const aarav = await prisma.employee.findUnique({ where: { id: 'EMP-001' } });
    expect(aarav?.fullName).toBe('Aarav Patel');
  });

  it('holds a dataset of at least the advertised size', async () => {
    const counts = await prisma.$transaction([
      prisma.user.count(),
      prisma.department.count(),
      prisma.jobPosition.count(),
      prisma.workingSchedule.count(),
      prisma.scheduleLine.count(),
      prisma.holiday.count(),
      prisma.employee.count(),
      prisma.employeeBankDetail.count(),
      prisma.contract.count(),
      prisma.attendance.count(),
      prisma.leaveType.count(),
      prisma.leaveAllocation.count(),
      prisma.leaveRequest.count(),
      prisma.salaryStructure.count(),
      prisma.salaryRule.count(),
      prisma.payrun.count(),
      prisma.payrunEmployee.count(),
      prisma.document.count(),
      prisma.auditEvent.count(),
    ]);

    const total = counts.reduce((sum, value) => sum + value, 0);
    expect(total).toBeGreaterThanOrEqual(RECORD_BUDGET);
  });
});
