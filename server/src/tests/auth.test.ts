import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

const validOrigin = 'http://localhost:5173';

describe('session authentication', () => {
  it('authenticates, exposes the role permission set, and destroys the session', async () => {
    const agent = request.agent(createApp());

    await agent.get('/api/auth/me').expect(401);

    const login = await agent
      .post('/api/auth/login')
      .set('Origin', validOrigin)
      .send({ email: 'priya.desai@peoplepay360.com', password: 'PeoplePay360!2026' })
      .expect(200);

    expect(login.body.data.user).toMatchObject({
      id: 'usr-hr',
      role: 'HR_MANAGER',
      employeeId: 'EMP-007',
    });
    expect(login.body.data.permissions).toContain('employee.read.all');
    expect(login.body.data.permissions).not.toContain('payrun.read');

    await agent
      .get('/api/auth/me')
      .expect(200)
      .expect(({ body }) => expect(body.data.user.id).toBe('usr-hr'));

    await agent.post('/api/auth/logout').set('Origin', validOrigin).expect(204);
    await agent.get('/api/auth/me').expect(401);
  });

  it('rejects a cross-origin state change before it reaches a handler', async () => {
    const response = await request(createApp())
      .post('/api/auth/login')
      .set('Origin', 'https://attacker.invalid')
      .send({ email: 'admin@peoplepay360.com', password: 'PeoplePay360!2026' })
      .expect(403);

    expect(response.body.error.code).toBe('ORIGIN_MISMATCH');
  });

  it('returns the same safe error for an unknown account and a wrong password', async () => {
    const app = createApp();
    const unknown = await request(app)
      .post('/api/auth/login')
      .set('Origin', validOrigin)
      .send({ email: 'nobody@peoplepay360.com', password: 'incorrect-password' })
      .expect(401);
    const wrong = await request(app)
      .post('/api/auth/login')
      .set('Origin', validOrigin)
      .send({ email: 'admin@peoplepay360.com', password: 'incorrect-password' })
      .expect(401);

    expect(unknown.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(wrong.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });
});
