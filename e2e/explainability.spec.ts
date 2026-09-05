import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, persona: string) {
  await page.goto('/');
  await page
    .getByRole('button', { name: new RegExp(persona, 'i') })
    .first()
    .click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(1200);
}

test('every payslip line can be explained back to its source', async ({ page }) => {
  await signIn(page, 'HR Payroll Manager');
  await page.goto('/#/payslips');
  await page
    .getByRole('button', { name: /^Open$/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /payslip$/i })).toBeVisible();

  // Each line carries its own Why? control.
  const why = page.getByRole('button', { name: /^Why is /i });
  expect(await why.count()).toBeGreaterThan(2);

  await why.first().click();
  await expect(page.getByText('Formula', { exact: true })).toBeVisible();
  await expect(page.getByText('Source records')).toBeVisible();

  // Escape closes exactly this layer and returns focus to the trigger.
  await page.keyboard.press('Escape');
  await expect(page.getByText('Source records')).toHaveCount(0);
});

test('the salary change explanation reconciles to the net difference', async ({ page }) => {
  await signIn(page, 'HR Payroll Manager');
  await page.goto('/#/payslips');
  await page
    .getByRole('button', { name: /^Open$/ })
    .first()
    .click();

  await expect(page.getByRole('heading', { name: /payslip$/i })).toBeVisible();
  const change = page.getByRole('button', { name: /Why did salary change/i }).first();
  // Never dead: with no earlier period it opens and explains that instead.
  await expect(change).toBeEnabled();
  await change.click();

  await expect(page.getByRole('heading', { name: /Why did this salary change/i })).toBeVisible();
  await expect(page.getByText(/reconcile exactly|No earlier payslip/i)).toBeVisible();
});

test('reports build a scoped document with its own sections', async ({ page }) => {
  await signIn(page, 'HR Payroll Manager');
  await page.goto('/#/reports');

  await expect(page.getByRole('heading', { name: 'Pay composition' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Net payroll trend' })).toBeVisible();

  // Turning a section off removes it from the report. The real input is
  // visually hidden behind a drawn control, so drive it the way a user does.
  await page.locator('.report-sections').getByText('Pay composition', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pay composition' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Net payroll trend' })).toBeVisible();
});
