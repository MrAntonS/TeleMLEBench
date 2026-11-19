#!/usr/bin/env node
// Remove hidden-label entries (anything under private/ or with a label role) from every
// public manifest in the Hugging Face release repo, and mark provider-only releases'
// data files as not public. The label hashes stay in the private evaluator repo
// (evaluator-manifest.json), which the scorer already reads; nothing is lost for audit.
//
//   node scripts/scrub-public-manifests.mjs                # dry run: writes cleaned copies, prints changes
//   HF_TOKEN=<write token> node scripts/scrub-public-manifests.mjs --apply
//   ... --apply --delete-provider-only-data                # also delete CICIDS2017 / CICIoT2023 data
//                                                          # files from main (history is NOT rewritten)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'NextGLab/telemlebench-releases';
const RELEASES = [
  'cicids2017-flow-classification-v1', 'ciciot2023-attack-classification-v1', 'n-baiot-attack-classification-v1',
  'radioml2016-10a-modulation-classification-v1', 'topologybench-clustering-v1', 'ujindoorloc-floor-v1',
  'veremi-extension-misbehavior-classification-v1', 'veremi-misbehavior-classification-v1',
  'wisig-manysig-transmitter-classification-v1',
];
const PROVIDER_ONLY = new Set(['cicids2017-flow-classification-v1', 'ciciot2023-attack-classification-v1']);
const DATA_ROLES = new Set(['train', 'validation', 'val', 'test_features', 'test']);

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const deleteData = args.has('--delete-provider-only-data');
const outDir = join(process.cwd(), 'scrubbed-manifests');

const isPrivate = (a) => {
  const p = String(a.path || '').toLowerCase();
  const u = String(a.uncompressed?.path || '').toLowerCase();
  return p.startsWith('private/') || p.includes('/private/') || u.startsWith('private/') ||
    /label/i.test(String(a.role || '')) || /hidden[-_]?test/.test(p);
};

const operations = [];
const deletions = [];
mkdirSync(outDir, { recursive: true });
for (const id of RELEASES) {
  const url = `https://huggingface.co/datasets/${REPO}/resolve/main/${id}/manifest.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const before = await res.text();
  const manifest = JSON.parse(before);
  const removed = manifest.artifacts.filter(isPrivate);
  manifest.artifacts = manifest.artifacts.filter((a) => !isPrivate(a));
  const hidden = [];
  if (PROVIDER_ONLY.has(id)) {
    manifest.distribution = 'provider_only';
    for (const a of manifest.artifacts) {
      if (DATA_ROLES.has(a.role) && a.public !== false) {
        a.public = false; // reference hash for provider-built splits; bytes are not served
        hidden.push(a.path);
        if (deleteData) deletions.push(`${id}/${a.path}`);
      }
    }
  }
  const after = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(join(outDir, `${id}.json`), after);
  console.log(`${id}: removed ${removed.map((a) => a.path).join(', ') || 'nothing'}` +
    (hidden.length ? `; data marked not public: ${hidden.join(', ')}` : ''));
  if (after !== before) operations.push({ path: `${id}/manifest.json`, content: after });
}

if (!apply) {
  console.log(`\nDry run: cleaned manifests written to ${outDir}. Re-run with --apply and HF_TOKEN to commit.`);
  process.exit(0);
}
const token = process.env.HF_TOKEN;
if (!token) throw new Error('HF_TOKEN with write access to ' + REPO + ' is required for --apply');
const lines = [
  { key: 'header', value: { summary: 'Remove hidden-label entries from public manifests', description: 'Label hashes live only in the private evaluator manifest.' } },
  ...operations.map((op) => ({ key: 'file', value: { path: op.path, encoding: 'base64', content: Buffer.from(op.content).toString('base64') } })),
  ...deletions.map((path) => ({ key: 'deletedFile', value: { path } })),
];
const commit = await fetch(`https://huggingface.co/api/datasets/${REPO}/commit/main`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-ndjson' },
  body: lines.map((l) => JSON.stringify(l)).join('\n'),
});
const body = await commit.text();
if (!commit.ok) throw new Error(`commit failed: HTTP ${commit.status} ${body.slice(0, 300)}`);
console.log('committed:', body.slice(0, 300));
