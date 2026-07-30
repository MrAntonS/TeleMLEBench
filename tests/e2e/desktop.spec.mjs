import { expect, test } from '@playwright/test';

import { fixtureUrl, monitorClientErrors } from './support.mjs';

test('preserves the pre-redesign white and blue visual contract', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'home'));

  const header = page.locator('.tml-header');
  const inner = page.locator('.tml-header-inner');
  const hero = page.locator('.tml-herosec');

  await expect(header).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.97)');
  await expect(page.locator('.tml-logo')).toHaveCSS('background-color', 'rgb(37, 99, 235)');
  await expect(page.locator('.tml-hero')).toHaveCSS('font-size', '54px');
  await expect(page.locator('.signal-panel')).toHaveCount(0);
  const linkedPapers = page.locator('.tml-stats > div').filter({ hasText: 'Papers linked' });
  await expect(linkedPapers).toContainText('1');
  await expect(page.getByText('Papers tracked', { exact: true })).toHaveCount(0);

  const geometry = await page.evaluate(() => {
    const headerBox = document.querySelector('.tml-header')?.getBoundingClientRect();
    const innerBox = document.querySelector('.tml-header-inner')?.getBoundingClientRect();
    const heroBox = document.querySelector('.tml-herosec')?.getBoundingClientRect();
    return {
      headerHeight: headerBox?.height,
      innerLeft: innerBox?.left,
      innerWidth: innerBox?.width,
      heroLeft: heroBox?.left,
      heroWidth: heroBox?.width
    };
  });
  expect(geometry.headerHeight).toBe(63);
  expect(geometry.innerLeft).toBe(188);
  expect(geometry.innerWidth).toBe(1064);
  expect(geometry.heroLeft).toBe(188);
  expect(geometry.heroWidth).toBe(1064);
  assertNoClientErrors();
});

test('catalog leads to a complete dataset evidence page', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'datasets'));

  await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Metro LTE KPI Handover Dataset/ })).toBeVisible();
  const reviewBadge = page.getByText('AI reviewed · audit pending', { exact: true });
  await expect(reviewBadge).toBeVisible();
  await expect(reviewBadge).toHaveClass(/pending/);
  await expect(page.getByLabel('Task')).toContainText('classification');
  await expect(page.getByLabel('Source')).toContainText('Zenodo');

  await page.getByRole('link', { name: /Metro LTE KPI Handover Dataset/ }).click();
  await expect(page).toHaveURL(/#\/dataset\/radio-kpi$/);
  await expect(page.getByRole('heading', { level: 1, name: datasetName })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Handover success prediction' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dataset schema' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'handover_success' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tasks and immutable releases' })).toBeVisible();
  await expect(page.getByText('release-radio-kpi-v1', { exact: true })).toBeVisible();
  await expect(page.getByText('70 / 15 / 15')).toBeVisible();
  await expect(page.getByText('train.csv')).toBeVisible();
  await expect(page.getByRole('link', { name: /Provider file/ })).toHaveCount(1);
  await expect(page.getByText('metadata only', { exact: true })).toBeVisible();
  await expect(page.getByText('We train and evaluate every model')).toBeVisible();
  await expect(page.getByText('Publication review', { exact: true })).toBeVisible();
  await expect(page.getByText('AI · gpt-5.6-sol', { exact: true })).toBeVisible();
  await expect(page.getByText('Review policy', { exact: true })).toBeVisible();
  await expect(page.getByText(
    'ai-catalog-review-2026.07.1 · Jul 20, 2026',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText('Human audit', { exact: true })).toBeVisible();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: paperTitle }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: paperTitle }).first()).toHaveAttribute('href', '#/paper/paper-1');
  await expect(page.getByRole('link', { name: paperTitle }).last()).toHaveAttribute(
    'href',
    '#/reproduction/experiment-1'
  );
  await expect(page.getByText('Python loading example')).toBeVisible();
  assertNoClientErrors();
});

test('top-bar navigation renders cached dashboard data without a reload', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'datasets'));

  await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible();
  await page.getByRole('link', { name: 'Papers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Papers' })).toBeVisible();

  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByRole('heading', {
    name: 'Every telecom-ML dataset, with its review trail visible.'
  })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'No confirmed paper use yet' })).toBeVisible();

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
