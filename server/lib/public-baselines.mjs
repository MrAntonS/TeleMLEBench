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
  if (value.feature_columns !== undefined) {
    if (!Array.isArray(value.feature_columns) || value.feature_columns.length > 5000) {
      throw new Error('training.feature_columns must be a list of at most 5000 names');
    }
    clean.feature_columns = value.feature_columns.map((name) => {
      const label = requiredString(name, 'training.feature_columns entry');
      if (!/^[A-Za-z0-9_.\-]{1,128}$/.test(label)) {
        throw new Error('training.feature_columns has an invalid entry');
      }
      return label;
    });
  }
  if (value.library_versions !== undefined) {
    const versions = value.library_versions;
    if (!versions || typeof versions !== 'object' || Array.isArray(versions)) {
      throw new Error('training.library_versions must be an object');
    }
    const entries = Object.entries(versions);
    if (entries.length > 32) {
      throw new Error('training.library_versions must hold at most 32 entries');
    }
    clean.library_versions = {};
    for (const [key, entry] of entries) {
      if (!/^[a-z0-9_]{1,64}$/.test(key) || typeof entry !== 'string' || entry.length > 64) {
        throw new Error('training.library_versions must map names to short version strings');
      }
      clean.library_versions[key] = entry;
    }
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
        selected_features: ["WAP002", "WAP004", "WAP006", "WAP007", "WAP008", "WAP009", "WAP010", "WAP011", "WAP012", "WAP013", "WAP014", "WAP015", "WAP016", "WAP019", "WAP020", "WAP021", "WAP022", "WAP023", "WAP024", "WAP025", "WAP026", "WAP027", "WAP028", "WAP029", "WAP030", "WAP031", "WAP032", "WAP033", "WAP034", "WAP035", "WAP036", "WAP037", "WAP038", "WAP039", "WAP040", "WAP041", "WAP042", "WAP043", "WAP044", "WAP045", "WAP046", "WAP047", "WAP048", "WAP049", "WAP050", "WAP051", "WAP052", "WAP053", "WAP054", "WAP055", "WAP057", "WAP058", "WAP059", "WAP060", "WAP061", "WAP062", "WAP063", "WAP064", "WAP065", "WAP066", "WAP067", "WAP068", "WAP069", "WAP070", "WAP071", "WAP072", "WAP073", "WAP074", "WAP075", "WAP076", "WAP077", "WAP078", "WAP079", "WAP080", "WAP081", "WAP082", "WAP083", "WAP084", "WAP085", "WAP086", "WAP087", "WAP088", "WAP089", "WAP090", "WAP091", "WAP092", "WAP094", "WAP095", "WAP096", "WAP097", "WAP098", "WAP099", "WAP101", "WAP102", "WAP103", "WAP104", "WAP105", "WAP106", "WAP107", "WAP108", "WAP109", "WAP110", "WAP111", "WAP112", "WAP113", "WAP114", "WAP115", "WAP116", "WAP117", "WAP118", "WAP119", "WAP120", "WAP121", "WAP122", "WAP123", "WAP124", "WAP125", "WAP126", "WAP127", "WAP128", "WAP129", "WAP130", "WAP131", "WAP132", "WAP133", "WAP134", "WAP135", "WAP136", "WAP137", "WAP138", "WAP139", "WAP140", "WAP141", "WAP142", "WAP143", "WAP144", "WAP145", "WAP146", "WAP147", "WAP148", "WAP149", "WAP150", "WAP151", "WAP153", "WAP154", "WAP155", "WAP156", "WAP160", "WAP161", "WAP162", "WAP163", "WAP164", "WAP165", "WAP166", "WAP167", "WAP168", "WAP169", "WAP170", "WAP171", "WAP172", "WAP173", "WAP174", "WAP175", "WAP176", "WAP177", "WAP178", "WAP179", "WAP180", "WAP181", "WAP182", "WAP183", "WAP184", "WAP185", "WAP186", "WAP187", "WAP188", "WAP189", "WAP190", "WAP191", "WAP192", "WAP196", "WAP198", "WAP202", "WAP203", "WAP204", "WAP206", "WAP207", "WAP212", "WAP213", "WAP214", "WAP215", "WAP217", "WAP218", "WAP221", "WAP222", "WAP223", "WAP224", "WAP225", "WAP228", "WAP229", "WAP230", "WAP232", "WAP233", "WAP234", "WAP235", "WAP236", "WAP237", "WAP238", "WAP240", "WAP242", "WAP247", "WAP248", "WAP249", "WAP250", "WAP252", "WAP253", "WAP255", "WAP256", "WAP257", "WAP258", "WAP259", "WAP260", "WAP261", "WAP262", "WAP263", "WAP264", "WAP266", "WAP267", "WAP268", "WAP270", "WAP271", "WAP272", "WAP273", "WAP274", "WAP275", "WAP276", "WAP277", "WAP278", "WAP279", "WAP280", "WAP281", "WAP282", "WAP283", "WAP284", "WAP285", "WAP286", "WAP288", "WAP289", "WAP290", "WAP291", "WAP292", "WAP293", "WAP294", "WAP295", "WAP297", "WAP298", "WAP299", "WAP300", "WAP302", "WAP304", "WAP305", "WAP307", "WAP308", "WAP309", "WAP310", "WAP311", "WAP312", "WAP313", "WAP314", "WAP315", "WAP316", "WAP317", "WAP318", "WAP319", "WAP321", "WAP322", "WAP323", "WAP325", "WAP327", "WAP328", "WAP329", "WAP330", "WAP332", "WAP333", "WAP334", "WAP335", "WAP336", "WAP337", "WAP338", "WAP340", "WAP341", "WAP342", "WAP343", "WAP344", "WAP345", "WAP346", "WAP347", "WAP348", "WAP350", "WAP351", "WAP355", "WAP356", "WAP360", "WAP361", "WAP363", "WAP366", "WAP367", "WAP368", "WAP369", "WAP370", "WAP371", "WAP372", "WAP374", "WAP375", "WAP376", "WAP377", "WAP379", "WAP380", "WAP381", "WAP382", "WAP383", "WAP384", "WAP385", "WAP386", "WAP388", "WAP389", "WAP390", "WAP391", "WAP392", "WAP393", "WAP394", "WAP395", "WAP396", "WAP397", "WAP398", "WAP399", "WAP400", "WAP401", "WAP402", "WAP403", "WAP404", "WAP405", "WAP408", "WAP409", "WAP410", "WAP411", "WAP412", "WAP413", "WAP415", "WAP416", "WAP418", "WAP422", "WAP423", "WAP425", "WAP426", "WAP428", "WAP431", "WAP432", "WAP434", "WAP435", "WAP436", "WAP439", "WAP440", "WAP442", "WAP443", "WAP447", "WAP448", "WAP449", "WAP450", "WAP452", "WAP453", "WAP454", "WAP456", "WAP457", "WAP459", "WAP461", "WAP465", "WAP467", "WAP471", "WAP472", "WAP473", "WAP474", "WAP475", "WAP476", "WAP478", "WAP479", "WAP480", "WAP481", "WAP482", "WAP483", "WAP484", "WAP486", "WAP489", "WAP490", "WAP492", "WAP493", "WAP494", "WAP495", "WAP496", "WAP500", "WAP501", "WAP502", "WAP503", "WAP504", "WAP505", "WAP506", "WAP507", "WAP508", "WAP511", "WAP512", "WAP514", "WAP515", "WAP516", "WAP517", "WAP518", "WAP520"],
        feature_columns: ["WAP001", "WAP002", "WAP003", "WAP004", "WAP005", "WAP006", "WAP007", "WAP008", "WAP009", "WAP010", "WAP011", "WAP012", "WAP013", "WAP014", "WAP015", "WAP016", "WAP017", "WAP018", "WAP019", "WAP020", "WAP021", "WAP022", "WAP023", "WAP024", "WAP025", "WAP026", "WAP027", "WAP028", "WAP029", "WAP030", "WAP031", "WAP032", "WAP033", "WAP034", "WAP035", "WAP036", "WAP037", "WAP038", "WAP039", "WAP040", "WAP041", "WAP042", "WAP043", "WAP044", "WAP045", "WAP046", "WAP047", "WAP048", "WAP049", "WAP050", "WAP051", "WAP052", "WAP053", "WAP054", "WAP055", "WAP056", "WAP057", "WAP058", "WAP059", "WAP060", "WAP061", "WAP062", "WAP063", "WAP064", "WAP065", "WAP066", "WAP067", "WAP068", "WAP069", "WAP070", "WAP071", "WAP072", "WAP073", "WAP074", "WAP075", "WAP076", "WAP077", "WAP078", "WAP079", "WAP080", "WAP081", "WAP082", "WAP083", "WAP084", "WAP085", "WAP086", "WAP087", "WAP088", "WAP089", "WAP090", "WAP091", "WAP092", "WAP093", "WAP094", "WAP095", "WAP096", "WAP097", "WAP098", "WAP099", "WAP100", "WAP101", "WAP102", "WAP103", "WAP104", "WAP105", "WAP106", "WAP107", "WAP108", "WAP109", "WAP110", "WAP111", "WAP112", "WAP113", "WAP114", "WAP115", "WAP116", "WAP117", "WAP118", "WAP119", "WAP120", "WAP121", "WAP122", "WAP123", "WAP124", "WAP125", "WAP126", "WAP127", "WAP128", "WAP129", "WAP130", "WAP131", "WAP132", "WAP133", "WAP134", "WAP135", "WAP136", "WAP137", "WAP138", "WAP139", "WAP140", "WAP141", "WAP142", "WAP143", "WAP144", "WAP145", "WAP146", "WAP147", "WAP148", "WAP149", "WAP150", "WAP151", "WAP152", "WAP153", "WAP154", "WAP155", "WAP156", "WAP157", "WAP158", "WAP159", "WAP160", "WAP161", "WAP162", "WAP163", "WAP164", "WAP165", "WAP166", "WAP167", "WAP168", "WAP169", "WAP170", "WAP171", "WAP172", "WAP173", "WAP174", "WAP175", "WAP176", "WAP177", "WAP178", "WAP179", "WAP180", "WAP181", "WAP182", "WAP183", "WAP184", "WAP185", "WAP186", "WAP187", "WAP188", "WAP189", "WAP190", "WAP191", "WAP192", "WAP193", "WAP194", "WAP195", "WAP196", "WAP197", "WAP198", "WAP199", "WAP200", "WAP201", "WAP202", "WAP203", "WAP204", "WAP205", "WAP206", "WAP207", "WAP208", "WAP209", "WAP210", "WAP211", "WAP212", "WAP213", "WAP214", "WAP215", "WAP216", "WAP217", "WAP218", "WAP219", "WAP220", "WAP221", "WAP222", "WAP223", "WAP224", "WAP225", "WAP226", "WAP227", "WAP228", "WAP229", "WAP230", "WAP231", "WAP232", "WAP233", "WAP234", "WAP235", "WAP236", "WAP237", "WAP238", "WAP239", "WAP240", "WAP241", "WAP242", "WAP243", "WAP244", "WAP245", "WAP246", "WAP247", "WAP248", "WAP249", "WAP250", "WAP251", "WAP252", "WAP253", "WAP254", "WAP255", "WAP256", "WAP257", "WAP258", "WAP259", "WAP260", "WAP261", "WAP262", "WAP263", "WAP264", "WAP265", "WAP266", "WAP267", "WAP268", "WAP269", "WAP270", "WAP271", "WAP272", "WAP273", "WAP274", "WAP275", "WAP276", "WAP277", "WAP278", "WAP279", "WAP280", "WAP281", "WAP282", "WAP283", "WAP284", "WAP285", "WAP286", "WAP287", "WAP288", "WAP289", "WAP290", "WAP291", "WAP292", "WAP293", "WAP294", "WAP295", "WAP296", "WAP297", "WAP298", "WAP299", "WAP300", "WAP301", "WAP302", "WAP303", "WAP304", "WAP305", "WAP306", "WAP307", "WAP308", "WAP309", "WAP310", "WAP311", "WAP312", "WAP313", "WAP314", "WAP315", "WAP316", "WAP317", "WAP318", "WAP319", "WAP320", "WAP321", "WAP322", "WAP323", "WAP324", "WAP325", "WAP326", "WAP327", "WAP328", "WAP329", "WAP330", "WAP331", "WAP332", "WAP333", "WAP334", "WAP335", "WAP336", "WAP337", "WAP338", "WAP339", "WAP340", "WAP341", "WAP342", "WAP343", "WAP344", "WAP345", "WAP346", "WAP347", "WAP348", "WAP349", "WAP350", "WAP351", "WAP352", "WAP353", "WAP354", "WAP355", "WAP356", "WAP357", "WAP358", "WAP359", "WAP360", "WAP361", "WAP362", "WAP363", "WAP364", "WAP365", "WAP366", "WAP367", "WAP368", "WAP369", "WAP370", "WAP371", "WAP372", "WAP373", "WAP374", "WAP375", "WAP376", "WAP377", "WAP378", "WAP379", "WAP380", "WAP381", "WAP382", "WAP383", "WAP384", "WAP385", "WAP386", "WAP387", "WAP388", "WAP389", "WAP390", "WAP391", "WAP392", "WAP393", "WAP394", "WAP395", "WAP396", "WAP397", "WAP398", "WAP399", "WAP400", "WAP401", "WAP402", "WAP403", "WAP404", "WAP405", "WAP406", "WAP407", "WAP408", "WAP409", "WAP410", "WAP411", "WAP412", "WAP413", "WAP414", "WAP415", "WAP416", "WAP417", "WAP418", "WAP419", "WAP420", "WAP421", "WAP422", "WAP423", "WAP424", "WAP425", "WAP426", "WAP427", "WAP428", "WAP429", "WAP430", "WAP431", "WAP432", "WAP433", "WAP434", "WAP435", "WAP436", "WAP437", "WAP438", "WAP439", "WAP440", "WAP441", "WAP442", "WAP443", "WAP444", "WAP445", "WAP446", "WAP447", "WAP448", "WAP449", "WAP450", "WAP451", "WAP452", "WAP453", "WAP454", "WAP455", "WAP456", "WAP457", "WAP458", "WAP459", "WAP460", "WAP461", "WAP462", "WAP463", "WAP464", "WAP465", "WAP466", "WAP467", "WAP468", "WAP469", "WAP470", "WAP471", "WAP472", "WAP473", "WAP474", "WAP475", "WAP476", "WAP477", "WAP478", "WAP479", "WAP480", "WAP481", "WAP482", "WAP483", "WAP484", "WAP485", "WAP486", "WAP487", "WAP488", "WAP489", "WAP490", "WAP491", "WAP492", "WAP493", "WAP494", "WAP495", "WAP496", "WAP497", "WAP498", "WAP499", "WAP500", "WAP501", "WAP502", "WAP503", "WAP504", "WAP505", "WAP506", "WAP507", "WAP508", "WAP509", "WAP510", "WAP511", "WAP512", "WAP513", "WAP514", "WAP515", "WAP516", "WAP517", "WAP518", "WAP519", "WAP520"],
        library_versions: {"joblib": "1.5.3", "lightgbm": "4.6.0", "numpy": "1.25.2", "pandas": "2.3.3", "python": "3.10.12", "scipy": "1.15.3", "sklearn": "1.7.2", "threadpoolctl": "3.6.0"},
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
