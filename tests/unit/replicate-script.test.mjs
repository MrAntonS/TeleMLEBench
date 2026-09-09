import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { publicBaseline } from '../fixtures/api-data.mjs';
import { buildReplicateScript } from '../../server/lib/replicate-script.mjs';
import { publicRelease } from '../fixtures/api-data.mjs';

const apiBase = 'https://telemlebench.vercel.app/api/v1';

function releaseWithFiles() {
  return {
    ...publicRelease,
    files: [
      { role: 'train', byte_size: 100, sha256: 'a'.repeat(64), download_endpoint: '/api/v1/releases/r/files/train' },
      { role: 'validation', byte_size: 50, sha256: 'b'.repeat(64), download_endpoint: '/api/v1/releases/r/files/validation' },
      { role: 'test_features', byte_size: 50, sha256: 'c'.repeat(64), download_endpoint: '/api/v1/releases/r/files/test' },
    ],
  };
}

test('generated main.py embeds the record and validates input', () => {
  const script = buildReplicateScript({
    baseline: {
      release_id: 'release-radio-kpi-v1',
      dataset_slug: 'radio-kpi',
      metric_name: 'accuracy',
      metric_value: 0.9,
      correct: 9,
      sample_count: 10,
      model_name: 'logistic_regression',
      recipe_version: 'telemlebench-auto-baseline/2',
      seed: 42,
      predictions_sha256: 'd'.repeat(64),
      training: publicBaseline.training,
    },
    release: releaseWithFiles(),
    apiBase,
  });
  assert.match(script, /solver="lbfgs"/);
  assert.match(script, /handover_success/);
  assert.match(script, /IterativeImputer/);
  assert.match(script, /StandardScaler/);
  assert.match(script, new RegExp('d'.repeat(64)));
  assert.match(script, /reproduce the reference score|SUCCESS: reproduced/);
  assert.doesNotMatch(script, /\/api\/v1\/api\/v1/);
  assert.match(script, /"path": "\/releases\/r\/files\/train"/);
});

test('generated main.py is syntactically valid Python', { skip: !process.env.PATH }, () => {
  let python = null;
  for (const candidate of ['python3', 'python']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      python = candidate;
      break;
    } catch {
      // Try the next candidate.
    }
  }
  if (!python) {
    console.log('no Python interpreter; skipping byte-compile check');
    return;
  }
  const script = buildReplicateScript({
    baseline: {
      release_id: 'release-radio-kpi-v1',
      dataset_slug: 'radio-kpi',
      metric_name: 'accuracy',
      metric_value: 0.9,
      correct: 9,
      sample_count: 10,
      model_name: 'logistic_regression',
      recipe_version: 'telemlebench-auto-baseline/2',
      seed: 42,
      predictions_sha256: 'd'.repeat(64),
      training: publicBaseline.training,
    },
    release: releaseWithFiles(),
    apiBase,
  });
  const dir = mkdtempSync(join(tmpdir(), 'tmlb-replicate-'));
  const target = join(dir, 'main.py');
  writeFileSync(target, script);
  execFileSync(python, ['-m', 'py_compile', target]);
});

test('generator refuses incomplete records instead of emitting a broken script', () => {
  assert.throws(
    () => buildReplicateScript({ baseline: { release_id: 'r' }, release: releaseWithFiles(), apiBase }),
    /no training params/
  );
  assert.throws(
    () => buildReplicateScript({
      baseline: {
        release_id: 'r', metric_name: 'accuracy', metric_value: 0.5,
        model_name: 'logistic_regression', predictions_sha256: 'd'.repeat(64),
        training: { params: { C: 1.0 }, target_column: 'y' },
      },
      release: { files: [] },
      apiBase,
    }),
    /missing the train file/
  );
});
