import { createHash } from 'node:crypto';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MODEL_NAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{1,127}$/;
const RECIPE_VERSION_PATTERN = /^[a-z0-9][a-z0-9_.\/-]{1,127}$/;
export const PUBLIC_BASELINE_SCHEMA = 'telemlebench-server-scored-baseline/1';
export const PUBLIC_BASELINE_PREFIX = 'published-baselines/';

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sorted(value[key]);
    return result;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(sorted(value));
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requiredString(value, label) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function assertCompletedResult(result) {
  const metric = result && result.metric;
  if (result?.status !== 'completed' || result?.publication?.public !== false) {
    throw new Error('only a completed private evaluator result can be promoted');
  }
  if (metric?.name !== 'accuracy' || !Number.isFinite(metric.value) ||
      metric.value < 0 || metric.value > 1 ||
      !Number.isSafeInteger(metric.correct) || metric.correct < 0 ||
      !Number.isSafeInteger(metric.sample_count) || metric.sample_count <= 0 ||
      metric.correct > metric.sample_count ||
      Math.abs(metric.value - (metric.correct / metric.sample_count)) > 1e-15) {
    throw new Error('the evaluator metric is invalid');
  }
  if (!SHA256_PATTERN.test(String(result.predictions_sha256 || '')) ||
      !SHA256_PATTERN.test(String(result.labels_sha256 || '')) ||
      result.scorer_version !== 'telemlebench-vercel-accuracy/1' ||
      result.alignment?.join_key !== 'sample_id' ||
      result.alignment?.mode !== 'strict_test_order') {
    throw new Error('the evaluator result is missing scoring provenance');
  }
}

export function publicBaselinePath(releaseId) {
  const value = requiredString(releaseId, 'release_id');
  if (!/^[a-z0-9][a-z0-9-]{2,120}$/.test(value)) {
    throw new Error('release_id is invalid');
  }
  return `${PUBLIC_BASELINE_PREFIX}${value}.json`;
}

export function buildPublicBaseline({
  descriptor,
  evaluationId,
  result,
  model,
  publishedAt,
}) {
  assertCompletedResult(result);
  const releaseId = requiredString(descriptor?.id, 'release_id');
  if (result.release_id !== releaseId) {
    throw new Error('the evaluator result does not match the release');
  }
  const modelName = requiredString(model?.name, 'model.name');
  const recipeVersion = requiredString(model?.recipeVersion, 'model.recipe_version');
  const seed = Number(model?.seed);
  if (!MODEL_NAME_PATTERN.test(modelName)) throw new Error('model.name is invalid');
  if (!RECIPE_VERSION_PATTERN.test(recipeVersion)) throw new Error('model.recipe_version is invalid');
  if (seed !== 42) throw new Error('the public baseline seed must be 42');
  const completedAt = requiredString(result.completed_at, 'completed_at');
  const publicationTime = requiredString(publishedAt || completedAt, 'published_at');
  if (Number.isNaN(Date.parse(completedAt)) || Number.isNaN(Date.parse(publicationTime))) {
    throw new Error('baseline timestamps are invalid');
  }

  const core = {
    schema_version: PUBLIC_BASELINE_SCHEMA,
    baseline_id: `baseline:${releaseId}:accuracy`,
    release_id: releaseId,
    dataset_id: requiredString(descriptor.datasetId, 'dataset_id'),
    dataset_version_id: requiredString(descriptor.datasetVersionId, 'dataset_version_id'),
    dataset_slug: requiredString(descriptor.catalogSlug, 'dataset_slug'),
    dataset_aliases: Array.isArray(descriptor.aliases) ? [...descriptor.aliases] : [],
    metric_name: 'accuracy',
    metric_value: result.metric.value,
    correct: result.metric.correct,
    sample_count: result.metric.sample_count,
    model_name: modelName,
    recipe_version: recipeVersion,
    seed,
    server_verified: true,
    verification_kind: 'server_scored_predictions',
    prediction_conformance_passed: true,
    training_execution_attested: false,
    predictions_sha256: result.predictions_sha256,
    hidden_labels_sha256: result.labels_sha256,
    scorer_version: result.scorer_version,
    alignment: { join_key: 'sample_id', mode: 'strict_test_order' },
    source_evaluation_id: requiredString(evaluationId, 'evaluation_id'),
    evaluated_at: completedAt,
    published_at: publicationTime,
    publication: {
      public: true,
      note: 'Trusted server score over operator-submitted test predictions; training execution is not attested.',
    },
  };
  return { ...core, record_sha256: sha256(canonicalJson(core)) };
}

export function parsePublicBaseline(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { record_sha256: recordHash, ...core } = value;
  if (value.schema_version !== PUBLIC_BASELINE_SCHEMA ||
      value.publication?.public !== true ||
      value.server_verified !== true ||
      value.verification_kind !== 'server_scored_predictions' ||
      value.prediction_conformance_passed !== true ||
      value.training_execution_attested !== false ||
      !Number.isFinite(value.metric_value) || value.metric_value < 0 || value.metric_value > 1 ||
      !Number.isSafeInteger(value.correct) || !Number.isSafeInteger(value.sample_count) ||
      value.sample_count <= 0 || value.correct < 0 || value.correct > value.sample_count ||
      Math.abs(value.metric_value - (value.correct / value.sample_count)) > 1e-15 ||
      !SHA256_PATTERN.test(String(value.predictions_sha256 || '')) ||
      !SHA256_PATTERN.test(String(value.hidden_labels_sha256 || '')) ||
      !SHA256_PATTERN.test(String(recordHash || '')) ||
      sha256(canonicalJson(core)) !== recordHash) {
    return null;
  }
  return value;
}

const SEEDED_RESULTS = new Map([
  ['ujindoorloc-floor-v1', {
    evaluationId: 'wrun_01M22AASVYZJ9G9G5PC2KSKWQB.FAe5To5t5YHoIGtp2Z6r8Ry6',
    model: {
      name: 'logistic_regression',
      recipeVersion: 'telemlebench-auto-baseline/2',
      seed: 42,
    },
    result: {
      status: 'completed',
      release_id: 'ujindoorloc-floor-v1',
      metric: {
        name: 'accuracy',
        value: 0.42357801080394025,
        correct: 1333,
        sample_count: 3147,
      },
      labels_sha256: '68f47b803ece987b5e51da4d38ace8c7d62e9f4264a88ab2e130c3860b9f75ab',
      predictions_sha256: '57337baf28d159c44dda49bc090fd05a32ede97ba7dd0c196aed1884dac9c2d0',
      scorer_version: 'telemlebench-vercel-accuracy/1',
      alignment: { join_key: 'sample_id', mode: 'strict_test_order' },
      publication: { public: false },
      completed_at: '2026-09-09T05:30:31.967Z',
    },
  }],
]);

export function seededPublicBaseline(descriptor) {
  const seed = SEEDED_RESULTS.get(descriptor?.id);
  if (!seed) return null;
  return buildPublicBaseline({
    descriptor,
    evaluationId: seed.evaluationId,
    result: seed.result,
    model: seed.model,
    publishedAt: seed.result.completed_at,
  });
}
