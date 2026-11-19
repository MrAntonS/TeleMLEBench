// Regenerate tests/fixtures/releases.json and manifest_ujindoorloc.json from the *current*
// server code (server/lib/releases.ts) applied to the recorded upstream manifests
// (tests/fixtures/raw-manifests at the repo root, already scrubbed of private entries).
// This is byte-for-byte what /api/v1/releases returns once the backend is deployed.
//
//   node sdk/python/tests/build_api_fixtures.mjs        (from the repo root, after npm ci)
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = new URL('../../../', import.meta.url);
const require = createRequire(new URL('package.json', repo));
const { transformSync } = require('esbuild');

const { code } = transformSync(readFileSync(new URL('server/lib/releases.ts', repo), 'utf8'), { loader: 'ts', format: 'esm' });
const file = join(mkdtempSync(join(tmpdir(), 'owl-fixtures-')), 'releases.mjs');
writeFileSync(file, code);
const lib = await import(pathToFileURL(file).href);
const buildScript = readFileSync(new URL('sdk/python/src/owl_wireless/split_builder.py', repo), 'utf8');

const items = [];
const tasks = {};
for (const d of lib.listReleaseDescriptors()) {
  const raw = JSON.parse(readFileSync(new URL(`tests/fixtures/raw-manifests/${d.id}.json`, repo), 'utf8'));
  items.push(lib.normalizePublicManifest(d, raw, { buildScript }));
  tasks[d.id] = lib.taskFileText(d, raw);
}
const out = new URL('sdk/python/tests/fixtures/', repo);
writeFileSync(new URL('releases.json', out), JSON.stringify({ items, total: items.length, errors: [] }, null, 1) + '\n');
writeFileSync(new URL('manifest_ujindoorloc.json', out),
  JSON.stringify(items.find((r) => r.id === 'ujindoorloc-floor-v1'), null, 1) + '\n');
console.log(`wrote ${items.length} releases`);
