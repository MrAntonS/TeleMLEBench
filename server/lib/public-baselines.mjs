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

function scalarParam(value, label) {
  if (value === null) return null;
  if (typeof value === 'string') {
    if (value.length > 256) throw new Error(`${label} is too long`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
    return value;
  }
  if (typeof value === 'boolean') return value;
  throw new Error(`${label} must be a string, number, boolean, or null`);
}

// Optional, strictly-validated training provenance so the replication guide
// can show the exact hyperparameters behind a published baseline. Only
// whitelisted scalar fields survive; anything else rejects the publication.
export function assertTrainingBlock(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('training must be an object');
  }
  const params = value.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('training.params is required');
  }
  const paramEntries = Object.entries(params);
  if (!paramEntries.length || paramEntries.length > 64) {
    throw new Error('training.params must hold 1-64 entries');
  }
  const cleanParams = {};
  for (const [key, entry] of paramEntries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) {
      throw new Error('training.params has an invalid key');
    }
    cleanParams[key] = scalarParam(entry, `training.params.${key}`);
  }
  const clean = { params: cleanParams };
  if (value.target_column !== undefined) {
    clean.target_column = requiredString(value.target_column, 'training.target_column');
  }
  for (const field of ['selected_feature_count', 'n_train', 'n_validation']) {
    if (value[field] !== undefined) {
      const count = Number(value[field]);
      if (!Number.isSafeInteger(count) || count <= 0) {
        throw new Error(`training.${field} must be a positive integer`);
      }
      clean[field] = count;
    }
  }
  if (value.selected_features !== undefined) {
    if (!Array.isArray(value.selected_features) || value.selected_features.length > 5000) {
      throw new Error('training.selected_features must be a list of at most 5000 names');
    }
    clean.selected_features = value.selected_features.map((name) => {
      const label = requiredString(name, 'training.selected_features entry');
      if (!/^[A-Za-z0-9_.\-]{1,128}$/.test(label)) {
        throw new Error('training.selected_features has an invalid entry');
      }
      return label;
    });
  }
  if (value.validation_metrics !== undefined) {
    const metrics = value.validation_metrics;
    if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
      throw new Error('training.validation_metrics must be an object');
    }
    const entries = Object.entries(metrics);
    if (!entries.length || entries.length > 16) {
      throw new Error('training.validation_metrics must hold 1-16 entries');
    }
    clean.validation_metrics = {};
    for (const [key, entry] of entries) {
      if (!/^[a-z0-9_]{1,64}$/.test(key) || typeof entry !== 'number' || !Number.isFinite(entry)) {
        throw new Error('training.validation_metrics must map names to numbers');
      }
      clean.validation_metrics[key] = entry;
    }
  }
  return clean;
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
  const training = assertTrainingBlock(model?.training);

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
    ...(training ? { training } : {}),
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
  if (value.training !== undefined) {
    try {
      assertTrainingBlock(value.training);
    } catch {
      return null;
    }
  }
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
      training: {
        params: {
          C: 1.0,
          class_weight: 'balanced',
          max_iter: 2000,
          random_state: 42,
          solver: 'lbfgs',
        },
        target_column: 'FLOOR',
        selected_feature_count: 416,
        n_train: 14741,
        n_validation: 3160,
        validation_metrics: {
          accuracy: 0.6933544303797469,
          macro_f1: 0.4860473549552755,
        },
      },
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
