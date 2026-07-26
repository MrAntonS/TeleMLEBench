import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'pages.yml'), 'utf8');

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(index.includes('id="main"') || app.includes('id="main"'), 'main landmark is missing');
expect(index.includes('Skip to content'), 'skip link is missing');
expect(index.includes('prefers-reduced-motion'), 'reduced-motion handling is missing');
expect(index.includes('./config.js'), 'runtime/build configuration is not loaded');
expect(app.includes("window.TMLB_API_BASE"), 'API configuration hook is missing');
expect(app.includes("'/datasets"), 'source-first dataset endpoint is missing');
expect(app.includes("'/papers"), 'paper endpoint is missing');
expect(app.includes("'/reproductions"), 'reproduction endpoint is missing');
expect(app.includes("'/catalog/coverage"), 'coverage endpoint is missing');
expect(app.includes('static trainable ML'), 'ML-only scope is not communicated');
expect(app.includes('signal-path'), 'provenance signal-path signature is missing');
expect(workflow.includes('vars.TMLB_API_BASE'), 'Pages does not use the configured API variable');
expect(workflow.includes('https://'), 'Pages does not enforce HTTPS');

const forbiddenUi = [
  'data-action="open-submit"',
  'data-action="open-dispute"',
  'prediction-file submission',
  'Test labels are never released',
  "api('/workers",
  "api('/judgments"
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
