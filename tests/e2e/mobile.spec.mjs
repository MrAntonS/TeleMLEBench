import { expect, test } from '@playwright/test';

import { expectCoreLandmarks, fixtureUrl, monitorClientErrors } from './support.mjs';

test('mobile navigation is operable and detail content does not overflow', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'datasets'));
  await expectCoreLandmarks(page);

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

  const coverageLink = page.getByRole('link', { name: 'Coverage', exact: true }).first();
  await expect(coverageLink).toBeVisible();
  await coverageLink.click();
  await expect(page).toHaveURL(/#\/coverage$/);
  await expect(page.getByRole('heading', { name: 'Coverage' })).toBeVisible();

  await page.goto(fixtureUrl('populated', 'dataset/radio-kpi'));
  await expect(page.getByRole('heading', { level: 1, name: 'Metro LTE KPI Handover Dataset' })).toBeVisible();
  // Wait for the async injected release panel so overflow measurement includes it.
  await expect(page.locator('article.tml-release-unit').first()).toBeVisible();
  await expect(page.locator('.tml-evaluator').first()).toBeVisible();
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
  assertNoClientErrors();
});

test('homepage finder does not overflow horizontally on mobile with a populated result', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'home'));
  await expectCoreLandmarks(page);

  const finder = page.locator('.ow-finder');
  await expect(finder).toBeVisible();
  await finder.getByLabel('Search datasets').fill('handover');
  await expect(finder.getByRole('link', { name: /Metro LTE KPI Handover Dataset/ })).toBeVisible();

  const geometry = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  assertNoClientErrors();
});

test('mobile radioml comparison and charts remain usable without overflow', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'dataset/radioml-2016-10a'));
  await expectCoreLandmarks(page);
  await expect(page.getByRole('heading', { name: 'Reproduction studies' })).toBeVisible();
  await expect(page.locator('.paper-card a[href="#/reproduction/owl-radioml-mcdformer"]').first()).toBeVisible();

  const geometry = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);

  await page.locator('.paper-card a[href="#/reproduction/owl-radioml-mcdformer"]').first().click();
  await expect(page).toHaveURL(/#\/reproduction\/owl-radioml-mcdformer$/);
  await expect(page.getByRole('heading', { name: 'Accuracy by SNR' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Specification/ })).toBeVisible();
  const detailGeometry = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(detailGeometry.scrollWidth).toBeLessThanOrEqual(detailGeometry.viewportWidth + 1);
  assertNoClientErrors();
});
