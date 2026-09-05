import { expect, test } from '@playwright/test';

test('health endpoint is available through the web origin', async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    status: string;
    database: string;
    environment: string;
  };

  // The contract is liveness plus a real database round trip. Which environment
  // name the process happens to run under is configuration, not health.
  expect(body.status).toBe('healthy');
  expect(body.database).toBe('connected');
  expect(['development', 'test', 'production']).toContain(body.environment);
});
