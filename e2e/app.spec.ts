import { expect, test } from '@playwright/test';

test('loads the persisted payroll workspace and securely switches persona', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      browserErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) browserErrors.push(`HTTP ${response.status()} ${response.url()}`);
  });

  await page.goto('/');
  await expect(page.getByText('PeoplePay360', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payroll operations' })).toBeVisible();
  await expect(page.getByText('42 payslips', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Maitri Shah/i }).click();
  await page.getByRole('option', { name: 'Employee', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Aarav' })).toBeVisible();
  await expect(page.getByText('Now securely signed in as Employee')).toBeVisible();

  expect(browserErrors).toEqual([]);
});

test('keeps primary navigation usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Payroll operations' })).toBeVisible();

  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
  await page.getByRole('link', { name: 'Payroll' }).click();
  await expect(page.getByRole('heading', { name: 'Payroll Control Room' })).toBeVisible();

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBe(false);
});
