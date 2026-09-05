import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { disconnectDatabase } from '../db/prisma.js';

describe('infrastructure health', () => {
  it('starts the application and reports database connectivity', async () => {
    const response = await request(createApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'healthy',
      database: 'connected',
      environment: 'test',
    });
  });
});

afterAll(async () => {
  await disconnectDatabase();
});
