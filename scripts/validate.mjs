import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const runtimeConfig = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const fixtureServer = fs.readFileSync(path.join(root, 'scripts', 'fixture-server.mjs'), 'utf8');
const playwrightConfig = fs.readFileSync(path.join(root, 'playwright.config.mjs'), 'utf8');
const enhancements = fs.readFileSync(path.join(root, 'public', 'app-enhancements.js'), 'utf8');

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(index.includes('id="main"') || app.includes('id="main"'), 'main landmark is missing');
expect(index.includes('Skip to content'), 'skip link is missing');
expect(index.includes('data-skip-link'), 'skip link behavior hook is missing');
expect(app.includes("main.setAttribute('tabindex', '-1')"), 'skip link does not focus the dynamic main landmark');
expect(index.includes('prefers-reduced-motion'), 'reduced-motion handling is missing');
expect(index.includes('./config.js'), 'runtime/build configuration is not loaded');
expect(app.includes("window.TMLB_API_BASE"), 'API configuration hook is missing');
expect(app.includes("window.TMLB_SUPABASE_URL"), 'Supabase URL configuration hook is missing');
expect(app.includes("window.TMLB_SUPABASE_PUBLISHABLE_KEY"), 'Supabase publishable-key hook is missing');
expect(
  runtimeConfig.includes('https://xyzrtrugifrnwoukrxyj.supabase.co'),
  'qualified-catalog Supabase project is not configured'
);
expect(runtimeConfig.includes('sb_publishable_'), 'Supabase publishable key is not configured');
expect(app.includes('Backend not configured'), 'unconfigured production backend state is missing');
expect(
  app.includes("configured = 'http://127.0.0.1:8080/api/v1'"),
  'local fallback does not target the backend on port 8080'
);
expect(app.includes('isLoopbackApiBase'), 'strict loopback API validation is missing');
expect(
  app.includes("defaults.targetAddressSpace = 'loopback'"),
  'loopback fetches do not declare their target address space'
);
expect(app.includes("cache: 'no-store'"), 'API reads may reuse stale catalog responses');
expect(app.includes("data-action=\"connect-local\""), 'Pages has no explicit localhost permission action');
expect(app.includes("name: 'loopback-network'"), 'Pages does not inspect the loopback permission state');
expect(
  app.includes("api('/health/ready')"),
  'Pages does not verify the local backend before loading catalog data'
);
expect(app.includes("'/datasets"), 'source-first dataset endpoint is missing');
expect(app.includes("'/papers"), 'paper endpoint is missing');
expect(app.includes("'/reproductions"), 'reproduction endpoint is missing');
expect(app.includes("'/catalog/coverage"), 'coverage endpoint is missing');
expect(app.includes("summary.counts"), 'coverage response is not using canonical nested counts');
expect(app.includes('Tasks and immutable releases'), 'release/task evidence panel is missing');
expect(app.includes('Papers linked'), 'homepage does not show distinct linked papers');
expect(!app.includes("'Papers tracked'"), 'homepage still exposes the paper-candidate count');
expect(
  app.includes('Qualified - paper evidence linked'),
  'qualified public datasets do not show an accurate qualification badge'
);
expect(
  app.includes('Evidence-linked paper relationships'),
  'paper counts are still presented as universally human-confirmed'
);
expect(app.includes('#/paper/'), 'paper detail route is missing');
expect(app.includes('#/reproduction/'), 'reproduction detail route is missing');
expect(
  app.includes("#/datasets?query=' + encodeURIComponent(domain[1])"),
  'research domain links do not deep-link their filter term'
);
expect(
  app.includes("params.has('query')"),
  'datasets route does not parse a deep-link query'
);
expect(app.includes('Exact usage evidence'), 'paper evidence rendering is missing');
expect(app.includes('static trainable ML'), 'ML-only scope is not communicated');
expect(app.includes('normalizeReview'), 'dataset review provenance normalization is missing');
expect(app.includes('AI reviewed · audit pending'), 'AI review audit-pending status is missing');
expect(app.includes('Human audits run retroactively'), 'retroactive human audit policy is not communicated');
expect(!app.includes('after all human publication gates'), 'obsolete human-first publication wording remains');

// Homepage dataset finder (positive contracts).
expect(app.includes('aria-label="Dataset finder"'), 'finder panel label is missing');
expect(app.includes('role="search"'), 'finder search region is missing');
expect(app.includes('aria-label="Find a dataset"'), 'finder search region label is missing');
expect(app.includes('for="finder-query"'), 'finder input label is missing');
expect(app.includes('data-finder-input'), 'finder search input hook is missing');
expect(app.includes('type="search"'), 'finder input type is not a native search field');
expect(app.includes('data-action="finder-topic"'), 'finder topic button action is missing');
expect(app.includes('data-action="view-all-finder"'), 'finder catalog handoff marker is missing');
expect(app.includes('data-action="browse-all-finder"'), 'finder browse-all handoff marker is missing');
expect(app.includes('matchesQuery'), 'shared query matcher is missing');
expect(app.includes('queryMatches'), 'shared OR/AND query tokenizer is missing');
expect(app.includes('datasetCorpus'), 'shared query corpus builder is missing');
expect(app.includes('resetNonQueryFilters'), 'finder handoff does not reset stale filters');
expect(app.includes('matches.slice(0, 3)'), 'finder inline output is not capped at three results');
for (const topic of [
  'Channel / MIMO / CSI',
  'RF / IQ / Spectrum',
  'Mobility / Localization',
  'Traffic / KPI / QoE'
]) {
  expect(app.includes(topic), `finder topic label is missing: ${topic}`);
}

// Removed decorative observatory graph must not return (negative contracts).
for (const marker of [
  'ow-observatory',
  'ow-spectrum',
  'ow-trace',
  'ow-grid-lines',
  'ow-markers',
  'ow-reticle',
  'ow-readouts',
  'owTrace',
  'Catalog totals',
  'observatoryPanel',
  'viewBox="0 0 640 330"'
]) {
  expect(
    !app.includes(marker) && !index.includes(marker),
    `removed observatory graph marker returned: ${marker}`
  );
}
expect(
  workflow.includes('cp index.html app.js config.js dist/'),
  'Pages does not publish the Supabase runtime configuration'
);
expect(workflow.includes('npm ci'), 'Pages validation does not install locked test dependencies');
expect(workflow.includes('playwright install --with-deps chromium'), 'Pages validation does not install Chromium');
expect(workflow.includes('npm run test:e2e'), 'Pages does not run browser tests before deployment');
expect(packageJson.devDependencies?.['@playwright/test'], 'Playwright is not a development dependency');
expect(packageJson.scripts?.['test:e2e'] === 'playwright test', 'Playwright test script is missing');
expect(fixtureServer.includes('emptyResponse'), 'deterministic empty API fixture is missing');
expect(fixtureServer.includes("api.mode === 'error'"), 'deterministic API failure fixture is missing');
expect(playwrightConfig.includes("'desktop-chromium'"), 'desktop browser project is missing');
expect(playwrightConfig.includes("'mobile-chromium'"), 'mobile browser project is missing');
expect(!index.includes('node_modules/'), 'production HTML must not depend on node_modules');
for (const contributionFile of [
  'CONTRIBUTING.md',
  path.join('.github', 'PULL_REQUEST_TEMPLATE.md'),
  path.join('.github', 'ISSUE_TEMPLATE', 'dataset-suggestion.yml'),
  path.join('.github', 'ISSUE_TEMPLATE', 'evidence-correction.yml'),
  path.join('.github', 'ISSUE_TEMPLATE', 'takedown.yml')
]) {
  expect(fs.existsSync(path.join(root, contributionFile)), `public contribution guidance is missing: ${contributionFile}`);
}

const forbiddenUi = [
  'data-action="open-submit"',
  'data-action="open-dispute"',
  'prediction-file submission',
  'Test labels are never released',
  "api('/workers",
  "api('/judgments",
  "api('/runs",
  "api('/benchmarks"
];
for (const marker of forbiddenUi) {
  expect(!app.includes(marker), `unsupported public UI remains: ${marker}`);
}

// Direct, truthful hero and section copy (positive contracts).
const directCopy = [
  'Open Wireless Learning',
  'Wireless ML datasets, prepared releases, and research evidence.',
  'Why OWL exists',
  'it is difficult to trace dataset versions, intended tasks, and their use in papers',
  'Prepared releases provide documented splits and checksums. Reproduction reports show what ran and how it was scored.',
  'What the catalog includes',
  'Browse the catalog.',
  'Find wireless ML datasets, prepared releases, linked papers, and reproduction reports. Read how the catalog keeps metadata, releases, and evidence separate.',
  "navLink('methodology', 'Methodology')",
  '<h1 class="tml-page-title">Coverage</h1>',
  'No prepared release',
  "x.reproductions.length === 1 ? ' report' : ' reports'",
  'esc(executionSummary)'
];
for (const marker of directCopy) {
  expect(app.includes(marker), `direct catalog copy is missing: ${marker}`);
}
expect(index.includes('wireless ML dataset catalog'), 'index title does not use direct dataset catalog wording');
expect(enhancements.includes('are not published to a leaderboard'), 'enhancements evaluator copy drifted from app.js');
expect(!enhancements.includes('updateContributionCopy'), 'removed contribution patch still exists in enhancements');
expect(!enhancements.includes('leaderboard publication'), 'obsolete leaderboard-publication wording remains in enhancements');

// Removed phrases and functions must not return (negative contracts).
const removedMarkers = [
  'RESEARCH PUBLICATION 014',
  'From wireless data to defensible research.',
  'reproducibility crisis',
  'rigid, transparent',
  'instant verification',
  'cryptographic certainty',
  'Progress is evidence.',
  'Start with the data.',
  'IDX_01',
  'IDX_02',
  'IDX_03',
  'IDX_04',
  'IDX_05',
  'IDX_06',
  'IDX_07',
  'IDX_08',
  '70 / 15 / 15',
  'Seeds 42',
  'There are no platform accounts',
  'leaderboard publication',
  'updateContributionCopy',
  'Controlled studies',
  "navLink('reproductions', 'Studies')",
  'Attributable outcomes'
];
for (const marker of removedMarkers) {
  expect(!app.includes(marker), `removed phrase or function returned: ${marker}`);
}

// Removed decorative pseudo-labels must not return (negative contracts).
const removedPseudoLabels = [
  'PUBLIC INDEX',
  'PUBLIC RESEARCH CATALOG',
  'PUBLIC DATASET CATALOG',
  'PUBLIC SCOPE',
  'WHY OPENWIRELESSLEARNING EXISTS',
  'CATALOG SCOPE',
  'CLASSIFICATION',
  'PUBLIC RECORD',
  'CATALOGED',
  'PUBLIC MANIFESTS',
  'EXACT EVIDENCE',
  'PUBLIC DATA INDEX',
  'VISIBLE RECORDS',
  'STATIC DATASETS',
  'OPEN INDEX'
];
for (const marker of removedPseudoLabels) {
  expect(!app.includes(marker), `removed pseudo-label returned: ${marker}`);
}

for (const obsolete of ['data.js', 'TeleMLEBench.standalone.html', 'build_standalone.py', path.join('src', 'TeleMLEBench.source.html')]) {
  expect(!fs.existsSync(path.join(root, obsolete)), `obsolete demo artifact remains: ${obsolete}`);
}

try {
  new vm.Script(app, { filename: 'app.js' });
} catch (error) {
  failures.push(`app.js is not valid JavaScript: ${error.message}`);
}

if (failures.length) {
  console.error(failures.map((x) => `FAIL: ${x}`).join('\n'));
  process.exit(1);
}

console.log('OpenWirelessLearning static frontend contract passed.');
