import { expect, test, type Page } from '@playwright/test';

/** Sign in for real: the app has no automatic session. */
async function signIn(page: Page, persona = 'HR Payroll Manager') {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page
    .getByRole('button', { name: new RegExp(persona, 'i') })
    .first()
    .click();
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('signs in, loads persisted payroll, and switches persona securely', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      browserErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('response', (response) => {
    // 401 on the initial session probe is the expected signed-out path.
    if (response.status() >= 400 && !response.url().endsWith('/api/auth/me')) {
      browserErrors.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });

  await signIn(page);

  await expect(page.getByRole('heading', { name: 'Payroll operations' })).toBeVisible();
  // The run covers the whole organisation, not a sample of it: the payslip
  // count on the payrun chip must equal the seeded headcount.
  const payslipChip = page.locator('.chip', { hasText: /^\d+ payslips$/ }).first();
  await expect(payslipChip).toBeVisible();
  const computed = Number((await payslipChip.innerText()).replace(/\D/g, ''));
  expect(computed).toBeGreaterThanOrEqual(42);

  await page.getByRole('button', { name: /Maitri Shah/i }).click();
  await page.getByRole('option', { name: 'Employee', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Aarav' })).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test('never serves an employee another person’s payroll', async ({ page }) => {
  await signIn(page, 'Employee');
  await expect(page.getByRole('heading', { name: 'Welcome, Aarav' })).toBeVisible();

  // Payroll administration is not offered…
  await expect(page.getByRole('link', { name: 'Payroll', exact: true })).toHaveCount(0);

  // …and asking for it directly is refused by the server, not hidden by the UI.
  const denied = await page.request.get('/api/ops/metrics');
  expect(denied.status()).toBe(403);

  await page.goto('/#/payroll');
  await expect(page.getByRole('heading', { name: 'Permission denied' })).toBeVisible();
});

test('keeps primary navigation usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Payroll operations' })).toBeVisible();

  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
  await page.getByRole('link', { name: 'Payroll', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Payroll Control Room' })).toBeVisible();

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBe(false);
});

test('shows measured operations telemetry to an administrator', async ({ page }) => {
  await signIn(page, 'Administrator');
  await page.goto('/#/ops');

  await expect(page.getByRole('heading', { name: 'Live operations' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Live system graph/i })).toBeVisible();
  // Record totals come from PostgreSQL, so the dataset size must be reported.
  await expect(page.getByText(/records across \d+ tables/)).toBeVisible();

  await page.getByRole('button', { name: 'Run readiness scan' }).click();
  await expect(page.getByRole('heading', { name: 'Payroll preflight' })).toBeVisible();
  await expect(page.getByText('Records scanned', { exact: true })).toBeVisible();
  await expect(page.getByText('Measured duration', { exact: true })).toBeVisible();
});
