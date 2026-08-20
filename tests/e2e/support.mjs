import { expect } from '@playwright/test';

export function fixtureUrl(mode, route) {
  const prefix = mode === 'populated' ? '' : `/fixtures/${mode}`;
  const apiBase = `${prefix}/api/v1`;
  return `/?api=${encodeURIComponent(apiBase)}#/${route}`;
}

export function monitorClientErrors(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });
  return () => expect(failures, 'unexpected browser errors').toEqual([]);
}

export async function expectCoreLandmarks(page) {
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('banner')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('contentinfo')).toHaveCount(1);
  await expect(page).toHaveTitle(/OpenWirelessLearning/);
}
