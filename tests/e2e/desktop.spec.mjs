import { expect, test } from '@playwright/test';

import { fixtureUrl, monitorClientErrors } from './support.mjs';

test('renders the OpenWirelessLearning precision-instrument visual contract', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'home'));

  const header = page.locator('.tml-header');
  const inner = page.locator('.tml-header-inner');
  const hero = page.locator('.tml-herosec');

  await expect(header).toHaveCSS('background-color', 'rgba(11, 15, 16, 0.97)');
  await expect(page.locator('.tml-logo')).toHaveCSS('border-top-color', 'rgba(156, 240, 255, 0.62)');
  await expect(page.locator('.ow-finder')).toBeVisible();
  await expect(page.locator('.signal-panel')).toHaveCount(0);
  await expect(page.getByRole('heading', {
    name: 'Wireless ML datasets, prepared releases, and research evidence.'
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
    name: 'Why OWL exists'
  })).toBeVisible();
  await expect(page.getByRole('heading', {
    name: 'What the catalog includes'
  })).toBeVisible();
  await expect(page.getByRole('heading', {
    name: 'Research domains'
  })).toBeVisible();
  await expect(page.getByRole('heading', {
    name: 'Browse the catalog.'
  })).toBeVisible();
  await expect(page.getByText('Paper-use links', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cellular and RAN' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse datasets' }).first()).toBeVisible();
  await expect(page.getByText('Dataset finder', { exact: true })).toBeVisible();
  await expect(page.getByText('Open Wireless Learning', { exact: true })).toBeVisible();
  await expect(page.getByText('PUBLIC INDEX')).toHaveCount(0);
  await expect(page.getByText('CATALOG SCOPE')).toHaveCount(0);
  await expect(page.getByText('PUBLIC RECORD')).toHaveCount(0);
  assertNoClientErrors();
});
test('homepage finder exposes a labelled native search and exactly four topic buttons', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'home'));

  const finder = page.locator('.ow-finder');
  await expect(finder).toBeVisible();

  await expect(finder.getByRole('search', { name: 'Find a dataset' })).toBeVisible();
  const input = finder.getByLabel('Search datasets');
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute('type', 'search');

  // No fake combobox/listbox/option roles inside the finder.
  await expect(finder.locator('[role="combobox"], [role="listbox"], [role="option"]')).toHaveCount(0);

  const topics = finder.getByRole('group', { name: 'Browse by topic' }).getByRole('button');
  await expect(topics).toHaveCount(4);
  await expect(topics).toHaveText([
    'Channel / MIMO / CSI',
    'RF / IQ / Spectrum',
    'Mobility / Localization',
    'Traffic / KPI / QoE'
  ]);
  assertNoClientErrors();
});
test('finder topic button stays on home, fills the search, shows a result, and toggles off', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'home'));

  const finder = page.locator('.ow-finder');
  const input = finder.getByLabel('Search datasets');
  const mobility = finder.getByRole('button', { name: 'Mobility / Localization' });

  await mobility.click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(input).toHaveValue('Mobility / Localization');
  await expect(mobility).toHaveAttribute('aria-pressed', 'true');

  await expect(finder.getByRole('link', { name: /Metro LTE KPI Handover Dataset/ })).toBeVisible();
  await expect(finder.getByRole('status')).toContainText('matching dataset');

  await mobility.click();
  await expect(input).toHaveValue('');
  await expect(mobility).toHaveAttribute('aria-pressed', 'false');
  await expect(finder.getByText('Type a term or choose a topic')).toBeVisible();
  assertNoClientErrors();
});
test('typed finder query shows metadata and navigates to the dataset detail page', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'home'));

  const finder = page.locator('.ow-finder');
  await finder.getByLabel('Search datasets').fill('handover');

  const result = finder.getByRole('link', { name: /Metro LTE KPI Handover Dataset/ });
  await expect(result).toBeVisible();
  await expect(result).toContainText('Zenodo');
  await expect(result).toContainText('open');
  await expect(result).toContainText('prepared release');
  await expect(result).toContainText('linked paper');

  await result.click();
  await expect(page).toHaveURL(/#\/dataset\/radio-kpi$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Metro LTE KPI Handover Dataset' })).toBeVisible();
  assertNoClientErrors();
});
test('finder no-match state links Browse all to the full catalog', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'home'));

  const finder = page.locator('.ow-finder');
  await finder.getByLabel('Search datasets').fill('zzz-absent-dataset');

  await expect(finder.getByText(/No matching datasets for/)).toBeVisible();
  const browseAll = finder.getByRole('link', { name: 'Browse all' });
  await expect(browseAll).toBeVisible();
  await browseAll.click();

  await expect(page).toHaveURL(/#\/datasets$/);
  await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible();
  assertNoClientErrors();
});
test('finder View all preserves the query and clears stale non-query filters', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'datasets'));
  await page.getByLabel('Task').selectOption('classification');
  await expect(page.getByLabel('Task')).toHaveValue('classification');

  // Navigate home through the app shell so in-memory filter state persists.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', {
    name: 'Wireless ML datasets, prepared releases, and research evidence.'
  })).toBeVisible();

  const finder = page.locator('.ow-finder');
  await finder.getByLabel('Search datasets').fill('KPI');

  await finder.getByRole('link', { name: /View all .* in the catalog/ }).click();
  await expect(page).toHaveURL(/#\/datasets\?query=KPI$/);
  await expect(page.getByLabel('Search')).toHaveValue('KPI');
  await expect(page.getByLabel('Task')).toHaveValue('all');
  await expect(page.locator('.tml-result-line')).toContainText('2 dataset records');
  assertNoClientErrors();
});
test('finder Enter submit deep-links the encoded query and catalog input/results agree', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'home'));

  const query = 'mobility / handover';
  await page.locator('.ow-finder').getByLabel('Search datasets').fill(query);
  await page.locator('.ow-finder').getByLabel('Search datasets').press('Enter');

  await expect(page).toHaveURL(new RegExp('#/datasets\\?query=' + encodeURIComponent(query) + '$'));
  await expect(page.getByLabel('Search')).toHaveValue(query);
  await expect(page.getByRole('link', { name: /Metro LTE KPI Handover Dataset/ })).toBeVisible();
  assertNoClientErrors();
});
test('Escape clears the finder query while keeping the input focused', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'home'));

  const input = page.locator('.ow-finder').getByLabel('Search datasets');
  await input.fill('handover');
  await expect(input).toHaveValue('handover');

  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  assertNoClientErrors();
});
test('finder inline output caps at three while reporting the full total', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.route('**/api/v1/datasets*', async (route) => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      canonical_id: 'doi:10.1234/qoe-' + (index + 1),
      slug: 'qoe-' + (index + 1),
      name: 'QoE Probe Dataset ' + (index + 1),
      description: 'Synthetic QoE measurements used to verify finder result capping.',
      task: 'qoe estimation',
      task_types: ['regression'],
      access_status: 'open',
      license: 'CC-BY-4.0',
      sources: [{ provider: 'Zenodo' }],
      tags: ['QoE'],
      paper_count: index + 1,
      release_count: 0
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, total: items.length, next_cursor: null })
    });
  });
  await page.goto(fixtureUrl('populated', 'home'));

  const finder = page.locator('.ow-finder');
  await finder.getByLabel('Search datasets').fill('QoE');

  await expect(finder.getByRole('status')).toContainText('5 matching datasets');
  await expect(finder.getByRole('status')).toContainText('showing 3');
  await expect(finder.locator('.ow-finder-results .ow-finder-result')).toHaveCount(3);
  await expect(finder.getByRole('link', { name: /View all 5 in the catalog/ })).toBeVisible();
  assertNoClientErrors();
});
test('catalog leads to a complete dataset evidence page', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'datasets'));

  await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible();
  await expect(page.getByText('PUBLIC DATA INDEX')).toHaveCount(0);
  await expect(page.getByText('VISIBLE RECORDS')).toHaveCount(0);
  await expect(page.locator('.tml-result-line')).toContainText('dataset records');
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
  await expect(page.getByText('1 release', { exact: true })).toBeVisible();
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

test('research domain link deep-links the datasets filter and keeps the term visible and editable', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'home'));

  const mobilityLink = page.getByRole('link', { name: 'Mobility / Localization' });
  await expect(mobilityLink).toHaveAttribute('href', '#/datasets?query=mobility');
  await mobilityLink.click();

  await expect(page).toHaveURL(/#\/datasets\?query=mobility$/);
  await expect(page.getByLabel('Search')).toHaveValue('mobility');
  await expect(page.getByRole('link', { name: /Metro LTE KPI Handover Dataset/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Catalog-only Telecom Dataset/ })).toHaveCount(0);
  assertNoClientErrors();
});

test('datasets deep-link query filters directly from the hash URL on load', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(`${fixtureUrl('populated', 'datasets')}?query=mobility`);

  await expect(page).toHaveURL(/#\/datasets\?query=mobility$/);
  await expect(page.getByLabel('Search')).toHaveValue('mobility');
  await expect(page.getByRole('link', { name: /Metro LTE KPI Handover Dataset/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Catalog-only Telecom Dataset/ })).toHaveCount(0);
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
    name: 'Wireless ML datasets, prepared releases, and research evidence.'
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
  await expect(page.getByText('3 runs · recorded seeds: 42, 123, 2026')).toBeVisible();
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

test('catalog-only dataset marks no prepared release and shows the no-release empty state', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'datasets'));

  const catalogOnlyCard = page.locator('.tml-dataset-card').filter({
    hasText: 'Catalog-only Telecom Dataset'
  });
  await expect(catalogOnlyCard).toBeVisible();
  await expect(catalogOnlyCard).toContainText('No prepared release');

  await catalogOnlyCard.click();
  await expect(page).toHaveURL(/#\/dataset\/catalog-only$/);

  const releasePanel = page.locator('.card.panel').filter({
    hasText: 'Tasks and immutable releases'
  });
  await expect(releasePanel).toBeVisible();
  await expect(releasePanel).not.toContainText('70 / 15 / 15');
  await expect(releasePanel.getByRole('heading', { name: 'No immutable task release' })).toBeVisible();
  assertNoClientErrors();
});

test('contribute page states GitHub-based corrections and private server-verified scoring', async ({ page }) => {
  const assertNoClientErrors = monitorClientErrors(page);
  await page.goto(fixtureUrl('populated', 'contribute'));

  await expect(page.getByRole('heading', { name: 'Catalog contributions' })).toBeVisible();
  await expect(page.getByText('Dataset and evidence corrections are made through GitHub issues and pull requests')).toBeVisible();
  await expect(page.getByText('Published supervised releases also accept authenticated prediction uploads for private, server-verified scoring')).toBeVisible();
  await expect(page.getByText(/There are no platform accounts/)).toHaveCount(0);
  assertNoClientErrors();
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
