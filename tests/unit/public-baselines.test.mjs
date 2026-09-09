import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertTrainingBlock,
  buildPublicBaseline,
  parsePublicBaseline,
  publicBaselinePath,
  seededPublicBaseline,
} from '../../server/lib/public-baselines.mjs';

const descriptor = {
  id: 'ujindoorloc-floor-v1',
  datasetId: '10.24432/c5ms59',
  datasetVersionId: 'dsv_10089411a0c5dbed537ad731',
  catalogSlug: '10-24432__c5ms59',
  aliases: ['ujindoorloc'],
};

const result = {
  status: 'completed',
  release_id: 'ujindoorloc-floor-v1',
  metric: { name: 'accuracy', value: 0.42357801080394025, correct: 1333, sample_count: 3147 },
  labels_sha256: '68f47b803ece987b5e51da4d38ace8c7d62e9f4264a88ab2e130c3860b9f75ab',
  predictions_sha256: '57337baf28d159c44dda49bc090fd05a32ede97ba7dd0c196aed1884dac9c2d0',
  scorer_version: 'telemlebench-vercel-accuracy/1',
  alignment: { join_key: 'sample_id', mode: 'strict_test_order' },
  publication: { public: false },
  completed_at: '2026-09-09T05:30:31.967Z',
};

test('public baseline path is constrained to a private prefix', () => {
  assert.equal(publicBaselinePath('ujindoorloc-floor-v1'), 'published-baselines/ujindoorloc-floor-v1.json');
  assert.throws(() => publicBaselinePath('../escape'), /release_id is invalid/);
});

test('built baseline is self-validating and explicitly unattested for training', () => {
  const baseline = buildPublicBaseline({
    descriptor,
    evaluationId: 'evaluation-1',
    result,
    model: { name: 'logistic_regression', recipeVersion: 'telemlebench-auto-baseline/2', seed: 42 },
    publishedAt: result.completed_at,
  });
  assert.equal(baseline.verification_kind, 'server_scored_predictions');
  assert.equal(baseline.training_execution_attested, false);
  assert.equal(baseline.prediction_conformance_passed, true);
  assert.equal(baseline.publication.public, true);
  assert.ok(parsePublicBaseline(baseline));
});

test('tampered or private records do not parse as public baselines', () => {
  const baseline = buildPublicBaseline({
    descriptor,
    evaluationId: 'evaluation-1',
    result,
    model: { name: 'logistic_regression', recipeVersion: 'telemlebench-auto-baseline/2', seed: 42 },
    publishedAt: result.completed_at,
  });
  assert.equal(parsePublicBaseline({ ...baseline, metric_value: 0.99 }), null);
  assert.equal(parsePublicBaseline({ ...baseline, publication: { public: false } }), null);
  assert.equal(parsePublicBaseline({ ...baseline, training_execution_attested: true }), null);
});

test('seeded UJI baseline matches the completed private evaluation', () => {
  const baseline = seededPublicBaseline(descriptor);
  assert.ok(baseline);
  assert.equal(baseline.metric_value, 1333 / 3147);
  assert.equal(baseline.model_name, 'logistic_regression');
  assert.ok(parsePublicBaseline(baseline));
});

test('training provenance is optional, whitelisted, and strictly validated', () => {
  const training = {
    params: { C: 1.0, class_weight: 'balanced', max_iter: 2000, random_state: 42, solver: 'lbfgs' },
    target_column: 'FLOOR',
    selected_feature_count: 416,
    selected_features: ['WAP002', 'WAP004'],
    feature_columns: ['WAP001', 'WAP002', 'WAP004'],
    n_train: 14741,
    n_validation: 3160,
    validation_metrics: { accuracy: 0.6933544303797469, macro_f1: 0.4860473549552755 },
    library_versions: { sklearn: '1.7.2', pandas: '2.3.3' },
  };
  const baseline = buildPublicBaseline({
    descriptor,
    evaluationId: 'evaluation-1',
    result,
    model: { name: 'logistic_regression', recipeVersion: 'telemlebench-auto-baseline/2', seed: 42, training },
    publishedAt: result.completed_at,
  });
  assert.deepEqual(baseline.training, training);
  assert.ok(parsePublicBaseline(baseline));
  assert.equal(parsePublicBaseline({ ...baseline, training: { params: {} } }), null);
  assert.throws(() => assertTrainingBlock({}), /training\.params is required/);
  assert.throws(() => assertTrainingBlock({ params: { ok: 1, evil: { nested: true } } }), /must be a string, number, boolean, or null/);
  assert.throws(() => assertTrainingBlock({ params: { ok: 1 }, n_train: -5 }), /positive integer/);
  assert.throws(() => assertTrainingBlock({ params: { ok: 1 }, feature_columns: ['a', 'bad name!'] }), /invalid entry/);
  assert.throws(() => assertTrainingBlock({ params: { ok: 1 }, library_versions: { sklearn: 1.7 } }), /short version strings/);
});

test('seeded UJI baseline carries the replication training facts', () => {
  const baseline = seededPublicBaseline(descriptor);
  assert.equal(baseline.training.target_column, 'FLOOR');
  assert.equal(baseline.training.params.solver, 'lbfgs');
  assert.equal(baseline.training.selected_feature_count, 416);
  assert.ok(parsePublicBaseline(baseline));
});
