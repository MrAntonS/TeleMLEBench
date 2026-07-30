import { expect, test } from '@playwright/test';

import { expectCoreLandmarks, fixtureUrl, monitorClientErrors } from './support.mjs';

test('mobile navigation is operable and detail content does not overflow', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'datasets'));
  await expectCoreLandmarks(page);
  await expect(page.getByText('AI reviewed · audit pending', { exact: true })).toBeVisible();
  const catalogGeometry = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(catalogGeometry.scrollWidth).toBeLessThanOrEqual(
    catalogGeometry.viewportWidth + 1
  );

  const toggle = page.getByRole('button', { name: 'Toggle navigation' });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  const papersLink = page.getByRole('link', { name: 'Papers', exact: true }).first();
  await expect(papersLink).toBeVisible();
  await papersLink.click();
  await expect(page).toHaveURL(/#\/papers$/);
  await expect(page.getByRole('heading', { name: 'Papers' })).toBeVisible();

  await page.goto(fixtureUrl('populated', 'dataset/radio-kpi'));
  await expect(page.getByRole('heading', { level: 1, name: 'Metro LTE KPI Handover Dataset' })).toBeVisible();
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
  assertNoClientErrors();
});
