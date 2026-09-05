import { expect, test } from '@playwright/test';

test('health endpoint is available through the web origin', async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({
    status: 'healthy',
    database: 'connected',
    environment: 'test',
  });
});
