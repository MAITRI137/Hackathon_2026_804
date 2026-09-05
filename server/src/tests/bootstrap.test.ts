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
    expect(response.body.data.salaryRules).toEqual([]);
    expect(response.body.data.payruns).toEqual([]);
    expect(response.body.data.audit).toEqual([]);
  });

  it('does not expose payroll configuration or payruns to HR managers', async () => {
    const agent = await signedInAgent('priya.desai@peoplepay360.com');
    const response = await agent.get('/api/bootstrap').expect(200);

    expect(response.body.data.employees.length).toBeGreaterThanOrEqual(42);
    expect(response.body.data.salaryStructures).toEqual([]);
    expect(response.body.data.salaryRules).toEqual([]);
    expect(response.body.data.payruns).toEqual([]);
  });
});
