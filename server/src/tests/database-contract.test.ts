import { afterAll, describe, expect, it } from 'vitest';

import { disconnectDatabase, prisma } from '../db/prisma.js';

describe('deterministic demo database', () => {
  afterAll(disconnectDatabase);

  it('contains the linked records required for the payroll story', async () => {
    const [users, departments, employees, contracts, payruns] = await prisma.$transaction([
      prisma.user.count(),
      prisma.department.count(),
      prisma.employee.count(),
      prisma.contract.count(),
      prisma.payrun.count(),
    ]);

    expect(users).toBe(5);
    expect(departments).toBe(8);
    expect(employees).toBe(42);
    expect(contracts).toBeGreaterThanOrEqual(42);
    expect(payruns).toBe(4);

    const activePayrun = await prisma.payrun.findUnique({
      where: { id: 'PR-2026-09' },
      include: { employees: true },
    });

    expect(activePayrun?.status).toBe('DRAFT');
    expect(activePayrun?.employees).toHaveLength(42);
  });
});
