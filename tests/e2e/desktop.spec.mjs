import { expect, test } from '@playwright/test';

import { fixtureUrl, monitorClientErrors } from './support.mjs';

test('catalog leads to a complete dataset evidence page', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'datasets'));

  await expect(page.getByRole('heading', { name: 'Datasets, not benchmark noise.' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Metro LTE KPI Handover Dataset/ })).toBeVisible();
  await expect(page.getByLabel('Task')).toContainText('mobility / handover');
  await expect(page.getByLabel('Source')).toContainText('Zenodo');

  await page.getByRole('link', { name: /Metro LTE KPI Handover Dataset/ }).click();
  await expect(page).toHaveURL(/#\/dataset\/radio-kpi$/);
  await expect(page.getByRole('heading', { level: 1, name: datasetName })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tasks and immutable releases' })).toBeVisible();
  await expect(page.getByText('release-radio-kpi-v1', { exact: true })).toBeVisible();
  await expect(page.getByText('70 / 15 / 15')).toBeVisible();
  await expect(page.getByText('train.csv')).toBeVisible();
  await expect(page.getByText('We train and evaluate every model')).toBeVisible();
  await expect(page.getByRole('link', { name: paperTitle }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: paperTitle }).first()).toHaveAttribute('href', '#/paper/paper-1');
  await expect(page.getByRole('link', { name: paperTitle }).last()).toHaveAttribute(
    'href',
    '#/reproduction/experiment-1'
  );
  await expect(page.getByText('Python loading example')).toBeVisible();
  assertNoClientErrors();
});

test('paper detail exposes exact versioned usage evidence', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'paper/paper-1'));

  await expect(page.getByRole('heading', { level: 1, name: paperTitle })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Confirmed dataset use' })).toBeVisible();
  await expect(page.getByText('version-radio-kpi-1')).toBeVisible();
  await expect(page.getByText('[IV-A Dataset, p. 5]')).toBeVisible();
  await expect(page.getByText('Ada Researcher, Lin Engineer')).toBeVisible();
  await expect(page.getByText('IEEE Transactions on Mobile Computing')).toBeVisible();
  await expect(page.getByText('Measured LTE KPI sequences are used')).toBeVisible();
  await expect(page.getByText('Jan 14, 2025', { exact: true })).toBeVisible();
  await expect(page.getByText('2025', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: datasetName })).toHaveAttribute(
    'href',
    '#/dataset/radio-kpi'
  );
  assertNoClientErrors();
});

test('reproduction detail distinguishes claims, missing facts, controls, and trusted runs', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'reproduction/experiment-1'));

  await expect(page.getByRole('heading', { level: 1, name: paperTitle })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Claim and conditions' })).toBeVisible();
  await expect(page.getByText('macro F1').first()).toBeVisible();
  await expect(page.getByText('early stopping patience')).toBeVisible();
  await expect(page.getByText('missing', { exact: true })).toBeVisible();
  await expect(page.getByText('known good harness')).toBeVisible();
  await expect(page.getByText('gpt-5.6-sol').first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '42' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '123' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '2026' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'yes' })).toHaveCount(3);
  await expect(page.getByText('3 / 3')).toBeVisible();
  assertNoClientErrors();
});

test('empty and unavailable catalogs state different facts', async ({ page }) => {
  await page.goto(fixtureUrl('empty', 'datasets'));
  await expect(page.getByRole('heading', { name: 'No matching dataset records' })).toBeVisible();
  await expect(page.getByText('Evidence service unavailable')).toHaveCount(0);

  await page.goto(fixtureUrl('empty', 'papers'));
  await expect(page.getByRole('heading', { name: 'No public papers returned' })).toBeVisible();

  await page.goto(fixtureUrl('empty', 'reproductions'));
  await expect(page.getByRole('heading', { name: 'No controlled reproduction record' })).toBeVisible();
  await expect(page.getByText(/This is not evidence that a paper failed reproduction/)).toBeVisible();

  await page.goto(fixtureUrl('error', 'datasets'));
  await expect(page.getByRole('heading', { name: 'Evidence service unavailable' })).toBeVisible();
  await expect(page.getByText('API request failed (503)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByText('No matching dataset records')).toHaveCount(0);
});

const datasetName = 'Metro LTE KPI Handover Dataset';
const paperTitle = 'Reliable Handover Prediction from LTE KPI Sequences';
