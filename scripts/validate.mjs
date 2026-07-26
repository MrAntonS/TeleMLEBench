import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const fixtureServer = fs.readFileSync(path.join(root, 'scripts', 'fixture-server.mjs'), 'utf8');
const playwrightConfig = fs.readFileSync(path.join(root, 'playwright.config.mjs'), 'utf8');

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(index.includes('id="main"') || app.includes('id="main"'), 'main landmark is missing');
expect(index.includes('Skip to content'), 'skip link is missing');
expect(index.includes('data-skip-link'), 'skip link behavior hook is missing');
expect(app.includes("main.setAttribute('tabindex', '-1')"), 'skip link does not focus the dynamic main landmark');
expect(index.includes('prefers-reduced-motion'), 'reduced-motion handling is missing');
expect(index.includes('./config.js'), 'runtime/build configuration is not loaded');
expect(app.includes("window.TMLB_API_BASE"), 'API configuration hook is missing');
expect(app.includes("'/datasets"), 'source-first dataset endpoint is missing');
expect(app.includes("'/papers"), 'paper endpoint is missing');
expect(app.includes("'/reproductions"), 'reproduction endpoint is missing');
expect(app.includes("'/catalog/coverage"), 'coverage endpoint is missing');
expect(app.includes("summary.counts"), 'coverage response is not using canonical nested counts');
expect(app.includes('Tasks and immutable releases'), 'release/task evidence panel is missing');
expect(app.includes('#/paper/'), 'paper detail route is missing');
expect(app.includes('#/reproduction/'), 'reproduction detail route is missing');
expect(app.includes('Exact usage evidence'), 'paper evidence rendering is missing');
expect(app.includes('static trainable ML'), 'ML-only scope is not communicated');
expect(app.includes('signal-path'), 'provenance signal-path signature is missing');
expect(workflow.includes('vars.TMLB_API_BASE'), 'Pages does not use the configured API variable');
expect(workflow.includes('https://'), 'Pages does not enforce HTTPS');
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

console.log('TeleMLEBench static frontend contract passed.');
