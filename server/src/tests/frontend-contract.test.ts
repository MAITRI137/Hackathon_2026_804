import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { computePayrun } from '@/store/payroll';
import { getState, hydrateFromServer, resetState } from '@/store/store';
import { createApp } from '../app.js';

afterEach(resetState);

describe('frontend persisted-data contract', () => {
  it('computes all selected payslips from a server bootstrap snapshot', async () => {
    const agent = request.agent(createApp());
    await agent
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'maitri.shah@peoplepay360.com', password: 'PeoplePay360!2026' })
      .expect(200);
    const bootstrap = await agent.get('/api/bootstrap').expect(200);

    hydrateFromServer(bootstrap.body.data);
    const state = getState();
    const payrun = state.payruns.find((item) => item.id === 'PR-2026-09')!;
    const outcome = computePayrun(state, payrun, '2026-09-05T14:30:00+05:30');

    // One payslip per selected employee, and not one contract unresolved.
    expect(outcome.failures).toEqual([]);
    expect(outcome.payslips).toHaveLength(payrun.employeeIds.length);
    expect(outcome.payslips.length).toBeGreaterThanOrEqual(42);
    // Every payslip foots: earnings minus deductions equals net.
    for (const slip of outcome.payslips.slice(0, 50)) {
      const earnings = slip.lines
        .filter((line) => line.category === 'BASIC' || line.category === 'ALLOWANCES')
        .reduce((sum, line) => sum + Number(line.amount), 0);
      expect(earnings - Number(slip.totalDeductions)).toBeCloseTo(Number(slip.net), 2);
    }
  });
});
