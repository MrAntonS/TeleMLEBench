import { expect, test } from '@playwright/test';

import { fixtureUrl, monitorClientErrors } from './support.mjs';

test('renders the OpenWirelessML precision-instrument visual contract', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'home'));

  const header = page.locator('.tml-header');
  const inner = page.locator('.tml-header-inner');
  const hero = page.locator('.tml-herosec');

  await expect(header).toHaveCSS('background-color', 'rgba(11, 15, 16, 0.97)');
  await expect(page.locator('.tml-logo')).toHaveCSS('border-top-color', 'rgba(156, 240, 255, 0.62)');
  await expect(page.locator('.ow-observatory')).toBeVisible();
  await expect(page.locator('.signal-panel')).toHaveCount(0);
  await expect(page.getByRole('heading', {
    name: 'From wireless data to defensible research.'
  })).toBeVisible();
  const paperLinks = page.locator('.ow-ledger-row').filter({
    hasText: 'Paper-use links'
  });
  await expect(paperLinks).toContainText('1');

  const geometry = await page.evaluate(() => {
    const headerBox = document.querySelector('.tml-header')?.getBoundingClientRect();
    const innerBox = document.querySelector('.tml-header-inner')?.getBoundingClientRect();
    const heroBox = document.querySelector('.tml-herosec')?.getBoundingClientRect();
    const heroStyle = getComputedStyle(document.querySelector('.tml-hero'));
    return {
      headerHeight: headerBox?.height,
      innerLeft: innerBox?.left,
      innerWidth: innerBox?.width,
      heroLeft: heroBox?.left,
      heroWidth: heroBox?.width,
      heroFont: heroStyle.fontFamily
    };
  });
  expect(geometry.headerHeight).toBe(65);
  expect(geometry.innerLeft).toBe(40);
  expect(geometry.innerWidth).toBe(1360);
  expect(geometry.heroLeft).toBe(40);
  expect(geometry.heroWidth).toBe(1360);
  expect(geometry.heroFont).toContain('Instrument Sans');
  assertNoClientErrors();
});
test('landing page follows the Stitch editorial composition', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'home'));

  await expect(page.getByRole('heading', {
    name: 'Why OpenWirelessML Exists'
  })).toBeVisible();
  await expect(page.getByRole('heading', {
    name: 'Progress is evidence.'
  })).toBeVisible();
  await expect(page.getByRole('heading', {
    name: 'Research domains'
  })).toBeVisible();
  await expect(page.getByRole('heading', {
    name: 'Start with the data. Keep the evidence.'
  })).toBeVisible();
  await expect(page.getByText('Paper-use links', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cellular and RAN' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse datasets' }).first()).toBeVisible();
  assertNoClientErrors();
});
test('catalog leads to a complete dataset evidence page', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'datasets'));

  await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Metro LTE KPI Handover Dataset/ })).toBeVisible();

  await expect(page.getByLabel('Task')).toContainText('classification');
  await expect(page.getByLabel('Source')).toContainText('Zenodo');

  await page.getByRole('link', { name: /Metro LTE KPI Handover Dataset/ }).click();
  await expect(page).toHaveURL(/#\/dataset\/radio-kpi$/);
  await expect(page.getByRole('heading', { level: 1, name: datasetName })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Handover success prediction' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dataset schema' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'handover_success' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tasks and immutable releases' })).toBeVisible();
  await expect(page.getByText('release-radio-kpi-v1', { exact: true }).first()).toBeVisible();
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
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Papers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Papers' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByRole('heading', {
    name: 'From wireless data to defensible research.'
  })).toBeVisible();
  assertNoClientErrors();
});

test('paper detail exposes exact versioned usage evidence', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'paper/paper-1'));

  await expect(page.getByRole('heading', { level: 1, name: paperTitle })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evidence-linked dataset use' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'No evidence-linked paper use yet' })).toBeVisible();

  await page.goto(fixtureUrl('empty', 'reproductions'));
  await expect(page.getByRole('heading', { name: 'No controlled reproduction record' })).toBeVisible();
  await expect(page.getByText(/This is not evidence that a paper failed reproduction/)).toBeVisible();

  await page.goto(fixtureUrl('error', 'datasets'));
  await expect(page.getByRole('heading', { name: 'Evidence service unavailable' })).toBeVisible();
  await expect(page.getByText('API request failed (503)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByText('No matching dataset records')).toHaveCount(0);
});

test('injected release panel matches dark precision-instrument theme', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'dataset/radio-kpi'));

  const panel = page.locator('.tml-release-download-panel');
  await expect(panel).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Published split downloads' })).toBeVisible();

  const unit = page.locator('article.tml-release-unit').first();
  await expect(unit).toBeVisible();
  await expect(unit).toContainText('release-radio-kpi-v1');
  await expect(unit).toContainText('70 train · 15 validation · 15 test');

  // Release unit uses the dark surface (low red channel, not white/light).
  const unitBg = await unit.evaluate((el) =>
    getComputedStyle(el).backgroundColor
  );
  const bgRed = Number((unitBg.match(/rgba?\((\d+)/) || [])[1]);
  expect(bgRed).toBeLessThan(60);

  // Square corners matching the precision-instrument theme.
  const unitRadius = await unit.evaluate((el) =>
    getComputedStyle(el).borderBottomLeftRadius
  );
  expect(unitRadius).toBe('2px');

  // Panel accent line uses a cyan-family colour, not the old blue #2563eb.
  const panelBeforeBg = await panel.evaluate((el) => {
    const s = getComputedStyle(el, '::before');
    return s.backgroundColor;
  });
  const accentGreen = Number((panelBeforeBg.match(/rgba?\(\d+,\s*(\d+)/) || [])[1]);
  expect(accentGreen).toBeGreaterThan(150);

  // Flow step container: dark background, low red channel.
  const flow = page.locator('.tml-release-flow').first();
  const flowBg = await flow.evaluate((el) =>
    getComputedStyle(el).backgroundColor
  );
  const flowRed = Number((flowBg.match(/rgba?\((\d+)/) || [])[1]);
  expect(flowRed).toBeLessThan(60);

  // Download file tile: dark surface.
  const fileCard = page.locator('.tml-release-file').first();
  const fileBg = await fileCard.evaluate((el) =>
    getComputedStyle(el).backgroundColor
  );
  const fileRed = Number((fileBg.match(/rgba?\((\d+)/) || [])[1]);
  expect(fileRed).toBeLessThan(60);

  // Submit button uses accent cyan background and mono font.
  const submitBtn = page.locator('.tml-evaluator-submit').first();
  const submitBg = await submitBtn.evaluate((el) =>
    getComputedStyle(el).backgroundColor
  );
  const sbMatch = submitBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  // Accent cyan (#9cf0ff) has high green (240) and blue (255),
  // whereas the old light-theme button (#2563eb) has green=99.
  expect(Number(sbMatch[2])).toBeGreaterThan(200); // green high (cyan, not old blue)
  expect(Number(sbMatch[3])).toBeGreaterThan(200); // blue high

  const submitFont = await submitBtn.evaluate((el) =>
    getComputedStyle(el).fontFamily
  );
  expect(submitFont.toLowerCase()).toContain('ibm plex mono');

  // Evaluator heading uses dark-theme ink colour, not near-black body text.
  const evaluatorHeading = page.locator('.tml-evaluator h4').first();
  await expect(evaluatorHeading).toContainText('Verify predictions');
  const headingColor = await evaluatorHeading.evaluate((el) =>
    getComputedStyle(el).color
  );
  expect(headingColor).not.toBe('rgb(20, 22, 26)');

  // File download link uses mono font and border styling.
  const downloadLink = page.locator('.tml-release-file a').first();
  const linkFont = await downloadLink.evaluate((el) =>
    getComputedStyle(el).fontFamily
  );
  expect(linkFont.toLowerCase()).toContain('ibm plex mono');

  assertNoClientErrors();
});

const datasetName = 'Metro LTE KPI Handover Dataset';
const paperTitle = 'Reliable Handover Prediction from LTE KPI Sequences';
