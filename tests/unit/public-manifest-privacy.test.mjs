// Public manifests must never expose hidden test labels: no path under private/, no
// label role, and no label checksum. Offline checks run against recorded upstream
// manifests (scrubbed) with synthetic private entries injected; set OWL_LIVE=1 to
// also check the live Hugging Face manifests and the live /releases/{id}/manifest.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { transformSync } from 'esbuild';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

async function loadReleases() {
  const { code } = transformSync(read('server/lib/releases.ts'), { loader: 'ts', format: 'esm' });
  const file = join(mkdtempSync(join(tmpdir(), 'owl-releases-')), 'releases.mjs');
  writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}

const lib = await loadReleases();
const BUILD_SCRIPT = read('sdk/python/src/owl_wireless/split_builder.py');
const FAKE_LABEL_SHA = 'f'.repeat(64);
const FAKE_LABEL_SHA_GZ = 'e'.repeat(64);

function rawManifest(id) {
  return JSON.parse(read(`tests/fixtures/raw-manifests/${id}.json`));
}

function withPrivateEntries(raw) {
  const copy = structuredClone(raw);
  copy.artifacts.push(
    { role: 'hidden_test_labels', path: 'private/hidden-test-labels.csv', public: false, sha256: FAKE_LABEL_SHA, size_bytes: 10 },
    // A mislabeled entry must still be dropped.
    { role: 'test_labels', path: 'private/hidden-test-labels.csv.gz', public: true, sha256: FAKE_LABEL_SHA_GZ, size_bytes: 10,
      uncompressed: { path: 'private/hidden-test-labels.csv', sha256: FAKE_LABEL_SHA, size_bytes: 20 } },
    { role: 'train', path: 'data/private/x.csv', public: true, sha256: FAKE_LABEL_SHA, size_bytes: 10 },
  );
  return copy;
}

// The rule the test enforces, independent of the implementation under test.
function privateEntries(value, path = '$') {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...privateEntries(v, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    const role = String(value.role || '').toLowerCase();
    if (/label/.test(role)) found.push(`${path}: role ${value.role}`);
    for (const [k, v] of Object.entries(value)) found.push(...privateEntries(v, `${path}.${k}`));
  } else if (typeof value === 'string') {
    const s = value.toLowerCase();
    if (/(^|\/)private\//.test(s) || /hidden[-_]?test[-_]?labels?/.test(s)) found.push(`${path}: ${value}`);
    if (s === FAKE_LABEL_SHA || s === FAKE_LABEL_SHA_GZ) found.push(`${path}: label checksum`);
  }
  return found;
}

for (const descriptor of lib.listReleaseDescriptors()) {
  test(`${descriptor.id}: public manifest and task file carry no private or label entries`, () => {
    const raw = withPrivateEntries(rawManifest(descriptor.id));
    const release = lib.normalizePublicManifest(descriptor, raw, { buildScript: BUILD_SCRIPT });
    assert.deepEqual(privateEntries(release), []);
    assert.deepEqual(privateEntries(JSON.parse(lib.taskFileText(descriptor, raw))), []);
    assert.ok(release.license && release.license.source_url, 'license and its source URL are published');
  });
}

test('the recorded upstream fixtures themselves are scrubbed', () => {
  for (const name of readdirSync(new URL('tests/fixtures/raw-manifests/', root))) {
    const raw = JSON.parse(read(`tests/fixtures/raw-manifests/${name}`));
    assert.deepEqual(privateEntries(raw), [], name);
  }
});

test('provider-only releases publish the split definition and no data files', () => {
  for (const id of ['cicids2017-flow-classification-v1', 'ciciot2023-attack-classification-v1']) {
    const descriptor = lib.getReleaseDescriptor(id);
    assert.equal(descriptor.distribution, 'provider_only');
    assert.equal(descriptor.license.redistribution, 'not_allowed');
    const release = lib.normalizePublicManifest(descriptor, rawManifest(id), { buildScript: BUILD_SCRIPT });
    const roles = release.files.map((f) => f.role).sort();
    assert.deepEqual(roles, ['build_script', 'split_assignment', 'task']);
    assert.match(release.provider_url, /^https:\/\/www\.unb\.ca\/cic\/datasets\//);
    assert.ok(release.source.files.length >= 1);
    for (const f of release.source.files) assert.match(f.sha256, /^[a-f0-9]{64}$/);
    const task = JSON.parse(lib.taskFileText(descriptor, rawManifest(id)));
    assert.equal(task.feature_fields.length, release.feature_count);
    assert.deepEqual(Object.keys(task.reference_outputs).sort(), ['test_features', 'train', 'validation']);
  }
  const route = read('server/api/v1/releases/[releaseId]/files/[role].get.ts');
  assert.match(route, /provider_only/);
  assert.match(route, /statusCode: 410/);
});

test('RadioML release is linked to its catalog version and shows NC-SA terms', () => {
  const d = lib.getReleaseDescriptor('radioml2016-10a-modulation-classification-v1');
  assert.equal(d.catalogDatasetVersionId, 'dsv_ebcdc40ddf743d67343b2440');
  const release = lib.normalizePublicManifest(d, rawManifest(d.id), {});
  assert.equal(release.catalog_dataset_version_id, 'dsv_ebcdc40ddf743d67343b2440');
  assert.equal(release.license.spdx, 'CC-BY-NC-SA-4.0');
  assert.match(release.license.terms, /NonCommercial/);
  assert.match(release.license.terms, /ShareAlike/);
});

test('GitHub Pages content contains no private manifest entries', () => {
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const pagesFiles = ['index.html', 'app.js', 'config.js', ...walk(new URL('data', root).pathname)
    .map((p) => p.slice(new URL('.', root).pathname.length))];
  for (const p of pagesFiles.filter((f) => f.endsWith('.json'))) {
    assert.deepEqual(privateEntries(JSON.parse(read(p))), [], p);
  }
});

const live = process.env.OWL_LIVE === '1';
test('live: Hugging Face and API manifests carry no private or label entries', { skip: !live && 'set OWL_LIVE=1' }, async () => {
  const api = (process.env.OWL_API || 'https://telemlebench.vercel.app/api/v1').replace(/\/+$/, '');
  const failures = [];
  for (const d of lib.listReleaseDescriptors()) {
    for (const [label, url] of [['huggingface', lib.publicManifestUrl(d.id)], ['api', `${api}/releases/${d.id}/manifest`]]) {
      const res = await fetch(url);
      if (!res.ok) { failures.push(`${label} ${d.id}: HTTP ${res.status}`); continue; }
      const hits = privateEntries(await res.json());
      if (hits.length) failures.push(`${label} ${d.id}: ${hits.join('; ')}`);
    }
  }
  assert.deepEqual(failures, []);
});
