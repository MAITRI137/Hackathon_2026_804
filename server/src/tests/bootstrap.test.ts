import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

const origin = 'http://localhost:5173';

async function signedInAgent(email: string) {
  const agent = request.agent(createApp());
  await agent
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ email, password: 'PeoplePay360!2026' })
    .expect(200);
  return agent;
}

describe('role-scoped bootstrap', () => {
  it('returns the complete persisted operating dataset to payroll managers', async () => {
    const agent = await signedInAgent('maitri.shah@peoplepay360.com');
    const response = await agent.get('/api/bootstrap').expect(200);

    const { employees, contracts, counts } = response.body.data;
    expect(employees.length).toBeGreaterThanOrEqual(42);
    // The payload's own headcount must agree with the database's count.
    expect(employees).toHaveLength(counts.employees);
    expect(contracts.length).toBeGreaterThanOrEqual(employees.length);
    expect(counts.total).toBeGreaterThanOrEqual(5000);
    expect(response.body.data.contracts[0].wage).toMatch(/^\d+\.\d{2}$/);
    expect(response.body.data.salaryRules).toHaveLength(6);
    expect(response.body.data.payruns).toHaveLength(4);
    expect(response.body.data.payruns.at(-1)).toMatchObject({
      id: 'PR-2026-09',
      employeeIds: expect.arrayContaining(['EMP-001', 'EMP-042']),
    });
  });

  it('limits employee bootstrap data to the signed-in employee', async () => {
    const agent = await signedInAgent('aarav.patel@peoplepay360.com');
    const response = await agent.get('/api/bootstrap').expect(200);

    expect(response.body.data.employees).toHaveLength(1);
    // Entitled to the rules that compute their own pay...
    expect(response.body.data.salaryRules.length).toBeGreaterThan(0);
    // ...and only to their own membership inside each visible pay period.
    expect(response.body.data.payruns.length).toBeGreaterThan(0);
    for (const payrun of response.body.data.payruns) {
      expect(payrun.employeeIds).toEqual(['EMP-001']);
    }
    for (const slip of response.body.data.payslips) {
      expect(slip.employeeId).toBe('EMP-001');
    }
    for (const contract of response.body.data.contracts) {
      expect(contract.employeeId).toBe('EMP-001');
    }
    expect(response.body.data.employees[0].id).toBe('EMP-001');
    expect(
      response.body.data.contracts.every(
        (item: { employeeId: string }) => item.employeeId === 'EMP-001',
      ),
    ).toBe(true);
    expect(response.body.data.contracts[0].wage).toMatch(/^\d+\.\d{2}$/);
    expect(
      response.body.data.attendance.every(
        (item: { employeeId: string }) => item.employeeId === 'EMP-001',
      ),
    ).toBe(true);
    // A person may see the rules that computed their own pay — that is the
    // payslip explanation — and exactly one structure: their own.
    expect(response.body.data.salaryStructures).toHaveLength(1);
    expect(response.body.data.salaryRules.length).toBeGreaterThan(0);
    // But no organisation-wide payrun membership and no audit trail.
    expect(response.body.data.audit).toEqual([]);
  });

  it('does not expose payrun administration or org payroll to HR managers', async () => {
    const agent = await signedInAgent('priya.desai@peoplepay360.com');
    const response = await agent.get('/api/bootstrap').expect(200);

    // HR Managers run people operations across the whole organisation…
    expect(response.body.data.employees.length).toBeGreaterThanOrEqual(42);

    // …but administer no payroll and see no one else's pay. Rule definitions
    // for their own structure are not confidential — they are printed on their
    // own payslip — so the boundary that matters is amounts, not policy.
    expect(response.body.data.payruns.length).toBeGreaterThan(0);
    for (const payrun of response.body.data.payruns) {
      expect(payrun.employeeIds).toEqual(['EMP-007']);
    }
    expect(response.body.data.salaryStructures.length).toBeLessThanOrEqual(1);
    for (const slip of response.body.data.payslips) {
      expect(slip.employeeId).toBe('EMP-007');
    }
  });

  it('refuses payroll and operations endpoints to an HR manager outright', async () => {
    const agent = await signedInAgent('priya.desai@peoplepay360.com');
    await agent.get('/api/ops/metrics').expect(403);
  });
});
