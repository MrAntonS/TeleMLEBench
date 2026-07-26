import { expect, test } from '@playwright/test';

import { expectCoreLandmarks, fixtureUrl, monitorClientErrors } from './support.mjs';

test('landmarks, names, focus order, and skip navigation support keyboard users', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'datasets'));
  await expectCoreLandmarks(page);

  const headings = await page.getByRole('heading', { level: 1 }).allTextContents();
  expect(headings).toEqual(['Datasets, not benchmark noise.']);

  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveURL(/#\/datasets$/);

  const labels = ['Search', 'Task', 'Origin', 'Access', 'Source', 'License', 'Publication', 'Papers', 'Reproduction'];
  for (const label of labels) {
    await expect(page.getByLabel(label)).toHaveCount(1);
  }

  await expect(page.locator('img:not([alt])')).toHaveCount(0);
  await expect(page.locator('button:not([aria-label])')).toHaveCount(0);
  assertNoClientErrors();
});
