#!/usr/bin/env node
// Verify owl-study.json is synchronized with the embedded OWL_RADIOML_STUDY in app.js.
// Source of truth for website numbers is owl-reproductions/catalog.json (via ../owl-reproductions or /tmp).
// Usage: node scripts/sync-owl-study.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const studyPath = path.join(root, 'owl-study.json');
const appPath = path.join(root, 'app.js');

function fail(msg) {
  console.error('owl-study sync failed: ' + msg);
  process.exit(1);
}

if (!fs.existsSync(studyPath)) fail('owl-study.json missing');
if (!fs.existsSync(appPath)) fail('app.js missing');

const study = JSON.parse(fs.readFileSync(studyPath, 'utf8'));
const app = fs.readFileSync(appPath, 'utf8');

const m = app.match(/var OWL_RADIOML_STUDY\s*=\s*(\{.*?\});/s);
if (!m) fail('embedded OWL_RADIOML_STUDY not found in app.js');
let embedded;
try {
  embedded = JSON.parse(m[1]);
} catch (e) {
  fail('embedded study JSON does not parse: ' + e.message);
}

// Compare experiment IDs and headline numbers
const ids = (study.experiments || []).map((e) => e.experiment_id).sort();
const eids = (embedded.experiments || []).map((e) => e.experiment_id).sort();
if (JSON.stringify(ids) !== JSON.stringify(eids)) {
  fail(`experiment IDs differ: file ${ids} vs embedded ${eids}`);
}
for (const ex of study.experiments) {
  const other = (embedded.experiments || []).find((e) => e.experiment_id === ex.experiment_id);
  if (!other) fail(`missing embedded ${ex.experiment_id}`);
  for (const k of ['published_oa', 'muse_oa', 'difference_pp', 'author_mean_oa']) {
    if (Number(ex[k]).toFixed(6) !== Number(other[k]).toFixed(6)) {
      fail(`${ex.experiment_id}.${k} differs: ${ex[k]} vs ${other[k]}`);
    }
  }
  // per-SNR spot check: MCDformer 12 dB
  if (ex.experiment_id === 'owl-radioml-mcdformer') {
    const a = ex.muse_per_snr['12'];
    const b = other.muse_per_snr['12'];
    if (Number(a).toFixed(6) !== Number(b).toFixed(6)) fail('mcdformer per-SNR 12dB mismatch');
  }
}

console.log(`owl-study sync OK: ${ids.length} experiments, study ${study.study_id}`);
