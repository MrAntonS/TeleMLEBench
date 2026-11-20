// Builds the static paper-page data layer (data/owl/) from the OWL research
// workbench. Run: node scripts/build-owl-papers.mjs [path/to/OWL-research]
//
// Inputs (all read-only):
//   papers/P*/source-manifest.json          paper metadata (title, authors, venue, arXiv/DOI)
//   papers/P*/DISCLOSURE_TABLE.json         paper-only extraction of the ten reproduction details
//   experiments/reproduction-benchmark/targets/P*.json          verified claimed results
//   experiments/reproduction-benchmark/runs/FINAL_CELLS.json   validated reproduction cells
//   experiments/reproduction-benchmark/runs/<run>/             reproduce.py, RESULT.json, logs
//   experiments/metadata-extraction-benchmark/.../cohort.json  author code repositories
//   papers/_owl30/OWL_Phase1_30_Paper_Inventory.csv   P01-P30 title, year, dataset, links
//   papers/_owl30/hand_audit_P01_P30.csv               P01-P30 hand-audit mark per detail, author-code status, counts
//   experiments/muse-reproductions/P01..P06/           Muse Spark reproductions (OpenCode): src, FROZEN_CONFIG, RESULTS, reports, logs
//
// Outputs:
//   data/owl/papers.json                     one record per paper with a disclosure table
//   data/owl/artifacts/<paper>/*             downloadable run artifacts for reproduced papers
//
// Only real values are written. Anything missing stays null and the page shows
// "not given" / "Not reproduced yet". Curated values below (code-sourced seed,
// assumed hyperparameters) are each tied to a source line that this script
// re-checks, so a drifting input fails the build instead of shipping a wrong value.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const research = path.resolve(process.argv[2] || process.env.OWL_RESEARCH || path.join(os.homedir(), 'OWL-research'));
const bench = path.join(research, 'experiments', 'reproduction-benchmark');
const cohortFile = path.join(research, 'experiments', 'metadata-extraction-benchmark', 'experiment-a',
  'protocol', 'ocr_pluscode_v2', 'cohort.json');
const outDir = path.join(repoRoot, 'data', 'owl');
const artifactDir = path.join(outDir, 'artifacts');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const exists = (file) => fs.existsSync(file);
const fail = (message) => { throw new Error(message); };
// Logs and scripts must not leak local filesystem paths, the local user name
// or the host name (OpenHands logs record both in each event's metadata).
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Run hosts other than this one (nextg-NN) also appear in OpenHands logs.
const scrub = (text) => text.replaceAll(os.homedir(), '~')
  .replace(/\bnextg-\d+(\.[a-z.]+)?/g, 'host')
  .replace(new RegExp('\\b' + escapeRe(os.userInfo().username) + '\\b', 'g'), 'user')
  .replace(new RegExp('\\b' + escapeRe(os.hostname()) + '\\b', 'g'), 'host')
  .replace(new RegExp('\\b' + escapeRe(os.hostname().split('.')[0]) + '\\b', 'g'), 'host');

const CRITERIA = [
  ['architecture', 'Architecture'],
  ['optimizer_lr', 'Optimizer / LR'],
  ['batch_size', 'Batch size'],
  ['epochs', 'Epochs'],
  ['random_seed', 'Training seed'],
  ['dataset_version', 'Data version'],
  ['preprocessing_augmentation', 'Preprocessing'],
  ['train_val_test_split', 'Split'],
  ['split_seed', 'Split seed'],
  ['evaluation_protocol', 'Evaluation protocol']
];

// Catalog dataset pages (tmlb_datasets.slug) for each OWL dataset family.
// Families without a catalog record (DeepMIMO) get no dataset link.
const DATASETS = {
  'UJIIndoorLoc': { slug: '10-24432__c5ms59', name: 'UJIIndoorLoc' },
  'VeReMi': { slug: '10-5281__zenodo-20081895', name: 'VeReMi' },
  'VeReMi Extension (2020)': { slug: '10-5281__zenodo-20090854', name: 'VeReMi Extension' },
  'WiSig': { slug: 'curated-url-https-cores-ee-ucla-edu-wisig-overview-206e82c51852', name: 'WiSig' },
  'CICIoT2023': { slug: 'curated-url-https-www-unb-ca-cic-datasets-iotdataset-2023-html-73dd07fac094', name: 'CICIoT2023' },
  'RadioMapSeer': { slug: 'radiomapseer', name: 'RadioMapSeer' },
  'DeepSense 6G': { slug: '10-21227__wq34-a443', name: 'DeepSense 6G' },
  '5G-NIDD': { slug: '10-21227__xtep-hv36', name: '5G-NIDD' },
  'N-BaIoT': { slug: '10-24432__c5rc8j', name: 'N-BaIoT' },
  'RadioML': { slug: 'radioml-2016-10a', name: 'RadioML 2016.10A' },
  'ORACLE': { slug: 'curated-url-https-genesys-lab-org-oracle-aa924b03ae27', name: 'ORACLE' },
  'DeepMIMO': { slug: null, name: 'DeepMIMO' }
};

// Repositories that could not be fetched for the +code extraction
// (owl-pluscode-results README: 5 HTTP 404, 1 invalid TLS). Not linked.
const UNREACHABLE_CODE = new Set(['P65', 'P71', 'P76', 'P80', 'P88', 'P100']);

// Values taken from the authors' code and reviewed for the paper page.
const CODE_VALUES = {
  P62: {
    random_seed: {
      value: '1000 (RandStream mt19937ar, seed + 12·(s−1) per repetition)',
      evidence: 'Main_B0_NA.m lines 7–17 @ fe6c49ce: seed = 1000; jump = 12; RandStream(\'mt19937ar\',\'Seed\',seed+jump*(s-1))'
    },
    optimizer_lr: {
      value: 'Adam, learning rate 1e-4 (floor-stage CNN)',
      evidence: 'CNN_Prediction_HX_1130.m lines 324–327 @ fe6c49ce: trainingOptions(\'adam\', \'MaxEpochs\',50, \'MiniBatchSize\',miniBatchSize, \'InitialLearnRate\',1e-4)'
    },
    batch_size: {
      value: '20 (floor-stage CNN)',
      evidence: 'CNN_Prediction_HX_1130.m lines 322–326 @ fe6c49ce: miniBatchSize = 20; \'MiniBatchSize\',miniBatchSize'
    },
    epochs: {
      value: '50 (floor-stage CNN)',
      evidence: 'CNN_Prediction_HX_1130.m lines 324–325 @ fe6c49ce: trainingOptions(\'adam\', \'MaxEpochs\',50'
    }
  }
};

// The OWL baseline shown on each paper page: the closest validated run given
// the paper plus the OWL spec (paper Table 5). `run` names that run in
// FINAL_CELLS.json; the build fails unless it is marked ok under condition owl.
// `assumed` lists details that neither the paper nor the authors' code (via the
// OWL spec) gives and that the agent set itself; `check` is a substring that
// must appear on that line of the run's reproduce.py.
const REPRODUCTIONS = {
  P61: {
    run: 'P61-20261118T011646Z/openhands-gemma-4-31b-owl',
    method: 'WiFi FAB-MAP',
    claimSplit: 'UJIIndoorLoc validation set (1,111 examples) used as test; database from the training set',
    owlSplit: 'validation (1,111 examples), same set as the paper',
    assumed: {},
    note: 'Same evaluation set and configuration as the paper’s best row (5 dBm bins from −110 to −10 dBm, PzGe = 0.3135, PzGne = 0.0004). The script matches each scan against all 19,937 training scans with an independent per-feature observation model: it builds no Chow-Liu tree and skips the paper’s DBScan clustering of the database. Matching is deterministic, so no seed is needed, and the offline re-run gave the same score.'
  },
  P62: {
    run: 'P62-20261118T011649Z/aider-gemma-4-31b-owl',
    method: 'SCNN (sequential classification neural network)',
    claimSplit: 'UJIIndoorLoc validation set (1,111 observations)',
    owlSplit: 'validation (1,111 observations), same set as the paper',
    assumed: {},
    note: 'Same 1,111-observation validation set as the paper. Optimizer (Adam), learning rate (1e-4), batch size (20), epochs (50) and seed (1000) are not in the paper; the OWL spec gave them from the authors’ code, where they configure the floor-stage CNN, and the agent used them for every stage. The paper gives no layer sizes and the spec gives no AP coordinates for RSSI images, so each stage is an MLP (64-32 hidden units) instead of a CNN. The script drops only zero-variance APs, not the paper’s unstable-location APs, and scores floor hit rate after a predicted-building stage.'
  },
  P68: {
    run: 'P68-20261117T192020Z/aider-gemma-4-26b-a4b-owl',
    method: 'XAI feature ensemble (Leveled) + CatBoost',
    claimSplit: '70/30 train/test split of VeReMi, random under-sampling for balance',
    owlSplit: '70/30 train/test split, random under-sampling',
    assumed: {
      optimizer_lr: { value: 'CatBoost learning rate 0.1', line: 107, check: 'learning_rate=0.1' },
      epochs: { value: 'CatBoost 100 iterations', line: 106, check: 'iterations=100' }
    },
    note: 'The sandbox provides one VeReMi simulation run (two receiver logs), not the 225 scenarios the paper uses. The script trains CatBoost on the Leveled top-4 features (pos_x, pos_y, spd_x, spd_y) after random under-sampling, standard scaling and a 70/30 split. CatBoost iterations and learning rate are not given by the paper or the authors’ code and were assumed. It uses seed 42 for the split, where the authors’ code (via the OWL spec) uses 100. Labels are joined to messages by nearest timestamp, and the scaler is fit before the split.'
  },
  P96: {
    run: 'P96-20261119T042753Z/aider-qwen3.8-27b-owl',
    method: 'Dense ResNet-68 C (complex convolutions)',
    claimMetric: 'peak classification accuracy (paper: 14 dB SNR)',
    claimSplit: '50/50 random train/test split, repeated five times',
    owlSplit: '50/50 random split of the 187k labelled pool, scored at 12 dB SNR',
    assumed: {
      optimizer_lr: { value: 'Adam, learning rate 1e-3', line: 240, check: 'lr=0.001' },
      batch_size: { value: '1024', line: 232, check: 'batch_size=1024' },
      epochs: { value: '20', line: 243, check: 'num_epochs = 20' },
      random_seed: { value: '42', line: 18, check: 'set_seed(42)' },
      split_seed: { value: '42 (global NumPy seed, np.random.permutation)', line: 213, check: 'np.random.permutation(len(X))' }
    },
    note: 'Not the same evaluation point: the public release lacks 33 (modulation, SNR) groups, including AM-DSB and GFSK at 14 dB, so OWL scores at 12 dB, where a faithful run is expected about 1 point below the 14 dB peak. The model is a complex-convolution ResNet with basic blocks [3, 4, 6, 3] (the script calls it ResNet-50), not a Dense ResNet-68, and it is trained once rather than five times. Optimizer, learning rate, batch size, epochs and seeds are assumed. The script checks test accuracy after each epoch from epoch 11 for early stopping, but the stop never triggered, so all 20 epochs ran.'
  }
};

// ---- P01-P30: the hand-audited set -------------------------------------------------------
const OWL30 = path.join(research, 'papers', '_owl30');
const HAND_COLS = {
  architecture: 'architecture', optimizer_lr: 'optimizer_lr', batch_size: 'batch_size', epochs: 'epochs',
  random_seed: 'training_seed', dataset_version: 'data_version', preprocessing_augmentation: 'preprocessing',
  train_val_test_split: 'split', split_seed: 'split_seed', evaluation_protocol: 'eval_protocol'
};
const HAND_MARKS = new Set(['full', 'partial', 'absent', 'code', 'partial+code', 'not_applicable']);

function readCsv(file) {
  const [head, ...rows] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return rows.map((line) => {
    const cells = [];
    let cur = '', quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
  });
}

// P02 is marked "verified" in the hand audit, but its repository could not be tied to the
// authors, so it gets the inventory link and no code credit. P13 and P30 are verified but
// the inventory has no URL; the repository is the one printed in the paper itself.
const NO_CODE_CREDIT = new Set(['P02']);
const PAPER_STATED_CODE = {
  P13: 'https://github.com/Enrique-Marmol/Federated-Learning-for-Misbehaviour-Detection-with-Variational-Autoencoder-and-Gaussian-Mixture-Mode',
  P30: 'https://github.com/BeechburgPieStar/IB-RFF'
};

// Paper claims (overall accuracy on RadioML 2016.10a) for the six Muse reproductions. `claim` must
// equal paper_reported in each RESULTS.json (checked below).
const MUSE_CLAIMS = {
  P01: { value: 62.51, expected: { repro: 59.47, gap: 3.0 } },
  P02: { value: 62.44, expected: { repro: 59.45, gap: 3.0 } },
  P03: { value: 63.24, expected: { repro: 60.90, gap: 2.3 } },
  P04: { value: 63.35, expected: { repro: 63.01, gap: 0.3 } },
  P05: { value: 62.63, expected: { repro: 59.11, gap: 3.5 } },
  P06: { value: 63.41, expected: { repro: 62.02, gap: 1.4 } }
};
const MUSE_TOLERANCE = 0.05;

// Re-scoring of saved test predictions (experiments/muse-reproductions/_rescore/rescore.py): the split
// code in each run's src/ rebuilds the locked test labels from the dataset, their hash matches
// RESULTS.json, and y_pred is scored against them. P02 and P04 saved no predictions.
const RESCORED = { P01: 59.466, P03: 60.9, P05: 59.109, P06: 62.018 };

// `assumed`: details the paper does not give. `where` names the place in the run that sets the value;
// `file`/`line`/`check` (when given) are re-checked against the run's src/ so a drifting input fails the build.
const MUSE = {
  P01: {
    dir: 'AMC-Net', method: 'AMC-Net (multiscale CNN with an attention module)',
    claimLocator: 'Table 1, p. 4',
    assumed: {
      batch_size: { value: '256', where: 'src/train.py line 47', file: 'src/train.py', line: 47, check: 'default=256' },
      epochs: { value: 'at most 100 epochs, early stopping on validation loss (patience 10 is from the paper)', where: 'src/train.py line 46', file: 'src/train.py', line: 46, check: 'default=100' },
      random_seed: { value: '0', where: 'src/train.py line 48', file: 'src/train.py', line: 48, check: 'default=0' },
      split_seed: { value: '0', where: 'src/common.py line 13', file: 'src/common.py', line: 13, check: 'seed=0' },
      preprocessing_augmentation: { value: 'none: raw I/Q as stored', where: 'src/dataset.py line 29', file: 'src/dataset.py', line: 29, check: 'torch.from_numpy(np.ascontiguousarray(arr))' }
    },
    note: 'Deviation from the paper: Adam learning rate 3e-4, not the paper’s 1e-3, because 1e-3 did not train stably in three full runs (MISSING_PARAMETERS.md M4; FROZEN_CONFIG.json hyperparameters.lr). Gradient clipping at 1.0 and the key/query dimension (64) are also not in the paper. Split is stratified per (modulation, SNR), 600/200/200, seed 0.'
  },
  P02: {
    dir: 'AWN', method: 'AWN (adaptive wavelet network)',
    claimLocator: 'Table I, p. 557',
    assumed: {
      epochs: { value: 'at most 50 epochs, early stopping on validation cross-entropy, patience 10', where: 'src/train2.py line 11; FROZEN_CONFIG.json hyperparameters.max_epochs, patience', file: 'src/train2.py', line: 11, check: 'default=50' },
      random_seed: { value: '0', where: 'src/train2.py line 17', file: 'src/train2.py', line: 17, check: 'default=0' },
      split_seed: { value: '0', where: 'src/dataset.py line 29', file: 'src/dataset.py', line: 29, check: 'seed=0' },
      preprocessing_augmentation: { value: 'none: raw I/Q float32', where: 'src/dataset.py line 24', file: 'src/dataset.py', line: 24, check: 'astype(np.float32)' }
    },
    note: 'Deviation from the paper: early stopping on validation cross-entropy with patience 10 (the paper says patience 5 on the verification loss); a first run with patience 5 on total loss stopped at epoch 8, undertrained (MISSING_PARAMETERS.md items 10–11). The paper’s wavelet-level setting T = 1 and 600/200/200 per-(modulation, SNR) split were followed.'
  },
  P03: {
    dir: 'ICRNNA', method: 'CNN–BiLSTM with additive attention',
    claimLocator: 'Table 3, p. 6',
    assumed: {
      optimizer_lr: { value: 'Adam (weight decay 1e-4 and the learning-rate schedule are from the paper)', where: 'src/train.py line 39', file: 'src/train.py', line: 39, check: 'torch.optim.Adam' },
      random_seed: { value: '42', where: 'src/train.py line 16', file: 'src/train.py', line: 16, check: 'default=42' },
      split_seed: { value: '42', where: 'src/dataset.py line 28', file: 'src/dataset.py', line: 28, check: 'random_state=seed' },
      preprocessing_augmentation: { value: 'global standardization with the training-set mean and std', where: 'src/train.py line 30', file: 'src/train.py', line: 30, check: 'compute_norm_stats(X[tr])' }
    },
    note: 'Deviations from the paper: batch size 128 (paper: 32) and training stopped at epoch 26 of 58 because of the time budget, with the best-validation checkpoint used (MISSING_PARAMETERS.md items 10 and 14). The split is a 70/15/15 split stratified by (modulation, SNR), seed 42.'
  },
  P04: {
    dir: 'MCDformer', method: 'MCDformer (multi-channel convolutional distilled transformer)',
    claimLocator: 'Table I, row MCDformer-A, p. 6',
    assumed: {
      train_val_test_split: { value: '60/20/20, stratified per (modulation, SNR)', where: 'src/dataset.py line 22', file: 'src/dataset.py', line: 22, check: 'train_frac=0.6' },
      split_seed: { value: '0', where: 'src/dataset.py line 22', file: 'src/dataset.py', line: 22, check: 'seed=0' },
      random_seed: { value: '0', where: 'src/train.py line 10', file: 'src/train.py', line: 10, check: 'seed=0' },
      epochs: { value: 'at most 30 epochs, early stopping on validation accuracy, patience 6', where: 'FROZEN_CONFIG.json hyperparameters.max_epochs, early_stop (set on the run’s command line; src/train.py defaults are 40 and 8)' },
      preprocessing_augmentation: { value: 'none: raw I/Q', where: 'src/dataset.py line 16', file: 'src/dataset.py', line: 16, check: 'astype(np.float32)' }
    },
    note: 'The paper only says its split is the same as AMC-Net and AWN, so the ratio and seed are assumed. Training stopped after epoch 14 because of the time budget; the best validation epoch was 14 (FROZEN_CONFIG.json).'
  },
  P05: {
    dir: 'CDSCNN', method: 'CDSCNN (complex-valued depthwise separable CNN)',
    claimLocator: 'Table II, Sec. III-F, abstract',
    assumed: {
      split_seed: { value: '12345', where: 'src/train.py line 16; FROZEN_CONFIG.json split.seed', file: 'src/train.py', line: 16, check: 'build_split(d, seed=12345)' },
      random_seed: { value: '0 and 1 (two runs, accuracy averaged)', where: 'FROZEN_CONFIG.json training.seeds' },
      epochs: { value: 'at most 35 epochs', where: 'FROZEN_CONFIG.json training.max_epochs' }
    },
    note: 'Deviations from the paper: two training runs averaged (the paper averages 10), batch size 1024 and 512 (paper: 128). Per-run accuracy 58.22% and 60.00%. The cosine-restart schedule (T0 = 10), channel widths and pooling sizes are assumed (MISSING_PARAMETERS.md items 2–3, 7). Split 800/100/100 per (modulation, SNR).'
  },
  P06: {
    dir: 'MCCFN', method: 'MCCFN (multi-scale complex-valued convolutional fusion network)',
    claimLocator: 'Table 1, p. 236; abstract 63.415%',
    assumed: {
      epochs: { value: 'at most 50 epochs, best-validation checkpoint', where: 'src/train.py line 47', file: 'src/train.py', line: 47, check: 'default=50' },
      random_seed: { value: '42', where: 'src/train.py line 50', file: 'src/train.py', line: 50, check: 'default=42' },
      split_seed: { value: '42', where: 'src/data.py line 32', file: 'src/data.py', line: 32, check: 'seed=42' },
      preprocessing_augmentation: { value: 'none: raw I/Q float32', where: 'src/data.py line 26', file: 'src/data.py', line: 26, check: 'astype(np.float32)' }
    },
    note: 'Split is stratified per (modulation, SNR), 700/200/100 (7:2:1), seed 42. Attention key/value dimension (64), kernel sizes and the per-epoch schedule granularity are assumed (MISSING_PARAMETERS.md items 3–5, 10).'
  }
};
const MUSE_CONDITION = 'PDF only, no OWL metadata, no author code';
const MUSE_FILES = ['FROZEN_CONFIG.json', 'RESULTS.json', 'MISSING_PARAMETERS.md', 'FINAL_REPORT.md'];

const HARNESS_LABEL = { deepagents: 'Deep Agents 0.7.3', openhands: 'OpenHands 1.16', aider: 'Aider 0.86.2' };
const MODEL_LABEL = { 'gemma-4-31b': 'Gemma 4 31B', 'gemma-4-26b-a4b': 'Gemma 4 26B-A4B', 'qwen3.8-27b': 'Qwen3.8-27B' };

function detailStatus(c) {
  if (c.completeness === 'NOT_APPLICABLE') return 'na';
  if (c.status === 'SPECIFIED' && c.completeness === 'FULL') return 'full';
  if (c.completeness === 'ABSENT') return 'absent';
  return 'partial';
}

function evidenceLocators(c) {
  return (c.evidence || []).map((e) => (e.page ? 'p. ' + e.page + ', ' : '') + (e.locator || '')).filter(Boolean);
}

// "Table I, PDF page 5 (frozen ... OCR page-0005.md line 31: '| ... |'); paper reports 0.946 on a 0-1 scale"
// -> "Table I, PDF page 5; paper reports 0.946 on a 0-1 scale". The OCR pointer
// can contain quotes, pipes and parentheses, so cut it by position, not by regex.
function stripLocator(locator) {
  let s = String(locator || '').split(' — DEVIATION')[0];
  const cut = s.indexOf(' (frozen');
  if (cut >= 0) {
    const rest = s.slice(cut).match(/\)\s*(;[^)]*)$/);
    s = s.slice(0, cut) + (rest ? rest[1] : '');
  }
  return s.split(';').map((part) => part.trim())
    .filter((part) => part && !/\.md\b|frozen/.test(part)).join('; ');
}

function pdfPage(locator) {
  const m = String(locator || '').match(/PDF page (\d+)/);
  return m ? Number(m[1]) : null;
}

function owlShortValue(value) {
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s.length > 60 ? s.slice(0, 59) + '…' : s;
}

function round(value, digits = 2) {
  return value == null ? null : Number(Number(value).toFixed(digits));
}

const cohort = exists(cohortFile) ? readJson(cohortFile) : {};
const cells = readJson(path.join(bench, 'runs', 'FINAL_CELLS.json'));
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(artifactDir, { recursive: true });

const owl30Inventory = exists(path.join(OWL30, 'OWL_Phase1_30_Paper_Inventory.csv'))
  ? Object.fromEntries(readCsv(path.join(OWL30, 'OWL_Phase1_30_Paper_Inventory.csv')).map((r) => [r.ID, r])) : {};
const handAudit = exists(path.join(OWL30, 'hand_audit_P01_P30.csv'))
  ? Object.fromEntries(readCsv(path.join(OWL30, 'hand_audit_P01_P30.csv')).map((r) => [r.id, r])) : {};
const papers = {};
const skipped = [];
const conflicts = [];
const assumedSkipped = [];
const paperDirs = fs.readdirSync(path.join(research, 'papers'))
  .filter((name) => /^P\d+$/.test(name))
  .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

for (const id of paperDirs) {
  const dir = path.join(research, 'papers', id);
  const manifestFile = path.join(dir, 'source-manifest.json');
  const tableFile = path.join(dir, 'DISCLOSURE_TABLE.json');
  if (!exists(manifestFile) || !exists(tableFile)) { skipped.push(`${id} (no disclosure table)`); continue; }
  const m = readJson(manifestFile);
  const t = readJson(tableFile);
  if (t.paper_id !== id) fail(`${id}: disclosure table is for ${t.paper_id}`);

  const family = m.dataset_family === 'VeReMi Extension (2020)' ? m.dataset_family : m.dataset_family_lead;
  const dataset = DATASETS[family] || { slug: null, name: m.dataset_family || family || 'Dataset not recorded' };
  const repro = REPRODUCTIONS[id] || null;
  const muse = MUSE[id] || null;
  const hand = handAudit[id] || null;
  const inv = owl30Inventory[id] || null;
  if (hand && !inv) fail(`${id}: in the hand audit but not in the inventory`);
  const codeValues = CODE_VALUES[id] || {};

  const details = CRITERIA.map(([key, label]) => {
    const c = t.criteria[key];
    if (!c) fail(`${id}: missing criterion ${key}`);
    const row = {
      key,
      label,
      status: detailStatus(c),
      extraction_status: c.status,
      value: c.value || null,
      explanation: c.explanation || null,
      evidence: evidenceLocators(c),
      source: c.value ? 'paper' : null
    };
    if (codeValues[key]) {
      row.status = 'code';
      row.value = codeValues[key].value;
      row.source = 'code';
      row.evidence = [codeValues[key].evidence];
      row.explanation = 'Not stated in the paper; taken from the authors’ code. ' + (c.explanation || '');
    }
    const assumed = repro && repro.assumed[key];
    if (assumed && !codeValues[key]) {
      row.assumed_value = assumed.value;
      row.assumed_where = `reproduce.py line ${assumed.line}`;
      row.source = 'assumed';
    }
    const museAssumed = muse && muse.assumed[key];
    if (museAssumed) {
      if (row.value) {
        assumedSkipped.push(`${id} ${key}: paper value extracted, assumed value not shown`);
      } else {
        row.assumed_value = museAssumed.value;
        row.assumed_where = museAssumed.where;
        row.source = 'assumed';
      }
    }
    if (hand) {
      const mark = hand[HAND_COLS[key]];
      if (!HAND_MARKS.has(mark)) fail(`${id}: unknown hand-audit mark "${mark}" for ${key}`);
      row.hand_audit = mark;
      // Both marks are kept as they are; a disagreement is only listed in the build output.
      const extractedGiven = row.status === 'full' || row.status === 'partial';
      if ((mark === 'absent' && extractedGiven) || (mark === 'full' && row.status === 'absent') ||
          (mark === 'not_applicable' && row.status !== 'na' && row.value)) {
        conflicts.push(`${id} ${key}: hand audit ${mark}, extraction ${row.status}${row.value ? ' (' + owlShortValue(row.value) + ')' : ''}`);
      }
    }
    return row;
  });

  const targetFile = path.join(bench, 'targets', id + '.json');
  let claim = null;
  const target = exists(targetFile) ? readJson(targetFile) : null;
  const targetDataset = target && target.dataset ? String(target.dataset.name || '') : '';
  const familyKey = String(family || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (target && familyKey && !targetDataset.toLowerCase().replace(/[^a-z0-9]/g, '').includes(familyKey)) {
    // The verified headline claim is on another dataset (P70: FEMNIST); do not
    // show it under this paper's dataset family.
    skipped.push(`${id} claim (target dataset "${targetDataset}" is not ${family})`);
  } else if (target) {
    const page = pdfPage(target.target.locator);
    const pdf = m.pdf_url || m.final_pdf_url || m.original_pdf_url || null;
    claim = {
      value: target.target.value,
      unit: target.target.unit || '',
      metric: (repro && repro.claimMetric) || target.target.metric,
      dataset: targetDataset || null,
      description: target.target.description,
      split: repro ? repro.claimSplit : null,
      locator: stripLocator(target.target.locator),
      page,
      url: pdf ? pdf + (page ? '#page=' + page : '') : null
    };
  }

  // ---- Muse Spark reproduction of P01-P06 ------------------------------------------------
  let museResults = null;
  let museRepro = null;
  if (muse) {
    const dir = path.join(research, 'experiments', 'muse-reproductions', id);
    museResults = readJson(path.join(dir, 'RESULTS.json'));
    const expectedClaim = MUSE_CLAIMS[id];
    const toPct = (v) => (v <= 1 ? v * 100 : v);
    const score = round(toPct(museResults.overall_accuracy), 4);
    const claimed = museResults.paper_reported.overall_accuracy_pct ?? museResults.paper_reported.overall_accuracy
      ?? museResults.paper_reported.overall_accuracy_RML2016_10a ?? museResults.paper_reported.accuracy_2016_10a;
    if (Math.abs(toPct(claimed) - expectedClaim.value) > MUSE_TOLERANCE) {
      fail(`${id}: RESULTS.json claim ${toPct(claimed)} differs from the expected ${expectedClaim.value}`);
    }
    const gap = round(Math.abs(score - expectedClaim.value), 2);
    if (Math.abs(score - expectedClaim.expected.repro) > MUSE_TOLERANCE || Math.abs(gap - expectedClaim.expected.gap) > MUSE_TOLERANCE) {
      fail(`${id}: reproduced ${score} / gap ${gap} differs from the expected ${expectedClaim.expected.repro} / ${expectedClaim.expected.gap}`);
    }
    for (const [key, a] of Object.entries(muse.assumed)) {
      if (!a.file) continue;
      const line = fs.readFileSync(path.join(dir, a.file), 'utf8').split('\n')[a.line - 1] || '';
      if (!line.includes(a.check)) fail(`${id}: ${a.file} line ${a.line} no longer contains "${a.check}" (${key})`);
    }
    const rescored = RESCORED[id];
    if (rescored != null && Math.abs(rescored - score) > MUSE_TOLERANCE) fail(`${id}: re-scored ${rescored} differs from ${score}`);
    claim = {
      value: expectedClaim.value,
      unit: '%',
      metric: 'overall accuracy',
      dataset: 'RadioML 2016.10a',
      description: 'Overall accuracy on RadioML 2016.10a, all SNRs (−20 to +18 dB).',
      split: null,
      locator: muse.claimLocator,
      page: null,
      url: (m.landing_url || m.paper_url) || null
    };
    const files = [];
    const dest = path.join(artifactDir, id);
    fs.mkdirSync(dest, { recursive: true });
    const put = (name, body, label) => {
      const target = path.join(dest, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
      files.push({ name, label, path: `data/owl/artifacts/${id}/${name}`, bytes: Buffer.byteLength(body) });
    };
    const walk = (sub) => fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).flatMap((e) => {
      const rel = path.posix.join(sub, e.name);
      return e.isDirectory() ? (e.name === '__pycache__' ? [] : walk(rel)) : [rel];
    }).sort();
    for (const name of MUSE_FILES) {
      put(name, scrub(fs.readFileSync(path.join(dir, name), 'utf8')), {
        'FROZEN_CONFIG.json': 'Frozen configuration (value and source of each setting)',
        'RESULTS.json': 'Result written by the final evaluation',
        'MISSING_PARAMETERS.md': 'What the paper does not give, and the choice made',
        'FINAL_REPORT.md': 'Agent’s final report'
      }[name]);
    }
    for (const rel of walk('src')) {
      if (!/\.(py|txt|md|json|yaml|yml|cfg|sh)$/.test(rel)) continue;
      put(rel, scrub(fs.readFileSync(path.join(dir, rel), 'utf8')), 'Agent’s source code');
    }
    if (exists(path.join(dir, 'logs'))) {
      for (const rel of walk('logs')) {
        const body = fs.readFileSync(path.join(dir, rel), 'utf8');
        if (body.trim()) put(rel, scrub(body), 'Training and evaluation log');
      }
    }
    const rescoredText = rescored != null
      ? 'Saved test predictions re-scored to the same accuracy: the test labels were rebuilt offline from the dataset with the run’s own split code (split hash matches RESULTS.json) and the saved predictions scored ' + round(rescored, 2) + '%. The test set stayed locked until FROZEN_CONFIG.json was frozen.'
      : 'Score comes from the run’s own evaluation: this run saved no test predictions, so it could not be re-scored offline. The test set stayed locked until FROZEN_CONFIG.json was frozen.';
    museRepro = {
      run: `muse-spark-1.3/${muse.dir}`,
      harness: 'OpenCode',
      model: 'Muse Spark 1.3',
      model_id: 'muse-spark-1.3-contributor',
      condition: MUSE_CONDITION,
      metric: 'Overall accuracy (all SNRs)',
      unit: '%',
      score,
      agent_reported: score,
      rerun: rescored != null ? round(rescored, 4) : null,
      split: museResults.split_description,
      gap,
      validation: { rule: rescored != null ? 'p' : 'o', text: rescoredText },
      fidelity: null,
      predictions_kept: false,
      agent_exit: null,
      finished_at: museResults.final_eval_timestamp,
      assumed_record: 'MISSING_PARAMETERS.md and FROZEN_CONFIG.json',
      files,
      note: muse.note
    };
  }

  let reproduction = museRepro;
  if (repro) {
    const cell = cells.find((x) => x.paper === id && x.run === repro.run);
    if (!cell) fail(`${id}: run ${repro.run} is not in FINAL_CELLS`);
    if (cell.kind !== 'ok' || cell.condition !== 'owl') {
      fail(`${id}: run ${repro.run} is ${cell.kind}/${cell.condition} in FINAL_CELLS, expected ok/owl`);
    }
    if (!HARNESS_LABEL[cell.harness] || !MODEL_LABEL[cell.model]) fail(`${id}: no label for ${cell.harness} / ${cell.model}`);
    const runDir = path.join(bench, 'runs', cell.run);
    const run = readJson(path.join(runDir, 'run.json'));
    const script = fs.readFileSync(path.join(runDir, 'reproduce.py'), 'utf8');
    const lines = script.split('\n');
    for (const [key, a] of Object.entries(repro.assumed)) {
      if (!String(lines[a.line - 1] || '').includes(a.check)) {
        fail(`${id}: reproduce.py line ${a.line} no longer contains "${a.check}" (${key})`);
      }
    }
    const agentValue = run.agent_reported && run.agent_reported.value;
    const rerunValue = run.rerun && run.rerun.value;
    const sameOnRerun = agentValue != null && rerunValue != null && Math.abs(agentValue - rerunValue) <= 0.5;
    // Rule (i) scores the re-run; rule (ii) scores what the agent's log printed.
    const score = round(sameOnRerun ? rerunValue : agentValue, 4);
    if (claim && Math.abs(Math.abs(claim.value - score) - cell.gap) > 0.01) {
      fail(`${id}: score ${score} does not match FINAL_CELLS gap ${cell.gap} for claim ${claim.value}`);
    }
    const validation = sameOnRerun
      ? { rule: 'i', text: 'Validated re-run: the final reproduce.py was re-run offline in a fresh sandbox and gave the same score (within 0.5 points). Fabrication screen passed.' }
      : { rule: 'ii', text: `Validated by the agent’s own log (rule ii): the agent printed ${round(agentValue)}%. The offline re-run gave ${round(rerunValue)}%, so this score is not bit-reproducible. Fabrication screen passed.` };

    const files = [];
    const dest = path.join(artifactDir, id);
    fs.mkdirSync(dest, { recursive: true });
    const put = (name, body, label) => {
      fs.writeFileSync(path.join(dest, name), body);
      files.push({ name, label, path: `data/owl/artifacts/${id}/${name}`, bytes: Buffer.byteLength(body) });
    };
    put('reproduce.py', scrub(script), 'Agent’s final script');
    const configLines = [
      `# OWL reproduction config for ${id} (${m.title})`,
      `# Run: ${cell.run}`,
      '# Generated by scripts/build-owl-papers.mjs from the run’s reproduce.py.',
      '# "assumed" = the paper does not give this value; the reproduction agent chose it.',
      `paper: ${id}`,
      `agent: {harness: "${HARNESS_LABEL[cell.harness]}", model: "${run.model}"}`,
      'inputs: [PAPER.md, OWL_SPEC.json, TASK.md]   # no author code; OWL_SPEC.json carries values extracted from it',
      'assumed:'
    ];
    for (const [key, a] of Object.entries(repro.assumed)) {
      configLines.push(`  ${key}: {value: "${a.value}", where: "reproduce.py:${a.line}"}`);
    }
    if (!Object.keys(repro.assumed).length) configLines.push('  {}');
    const fromCode = Object.entries(codeValues);
    if (fromCode.length) {
      configLines.push('from_author_code:');
      for (const [key, v] of fromCode) configLines.push(`  ${key}: {value: "${v.value}", evidence: "${v.evidence.replace(/"/g, '\'')}"}`);
    }
    put('config.yaml', configLines.join('\n') + '\n', 'Assumed values and their source lines');
    put('RESULT.json', fs.readFileSync(path.join(runDir, 'workspace-RESULT.json'), 'utf8'), 'Result written by reproduce.py');
    const agentLog = fs.readFileSync(path.join(runDir, 'agent.stdout.log'), 'utf8');
    if (agentLog.trim()) put('run.log', scrub(agentLog), 'Agent run log');
    const rerunLog = fs.readFileSync(path.join(runDir, 'rerun.stdout.log'), 'utf8');
    if (rerunLog.trim()) put('rerun.log', scrub(rerunLog), 'Offline re-run output');

    reproduction = {
      run: cell.run,
      harness: HARNESS_LABEL[cell.harness],
      model: MODEL_LABEL[cell.model],
      model_id: run.model,
      condition: 'Paper + OWL spec, no author code',
      metric: run.agent_reported.result.metric,
      unit: run.agent_reported.result.unit || '%',
      score: score,
      agent_reported: round(agentValue, 4),
      rerun: round(rerunValue, 4),
      split: repro.owlSplit,
      gap: round(cell.gap, 2),
      validation,
      fidelity: cell.fidelity,
      predictions_kept: false,
      agent_exit: run.agent && run.agent.exit_code,
      finished_at: run.finished_at,
      files,
      note: repro.note
    };
  }

  let codeUrl = cohort[id] && !UNREACHABLE_CODE.has(id) ? cohort[id] : null;
  const cov = t.paper_only_coverage || {};
  let fullyReported = { k: cov.fully_specified ?? details.filter((d) => d.status === 'full').length, n: cov.applicable ?? 10 };
  if (hand) {
    // Checked by hand (paper column), not the extractor's count.
    const mk = /^(\d+)\/(\d+)$/.exec(hand.fully_reported_paper);
    if (!mk) fail(`${id}: bad hand-audit count "${hand.fully_reported_paper}"`);
    fullyReported = { k: Number(mk[1]), n: Number(mk[2]) };
    // Code is credited only when the hand audit verified it; P02 keeps its link without credit.
    const credited = hand.author_code === 'verified';
    const link = inv['Code URL (if identified)'] || PAPER_STATED_CODE[id] || null;
    codeUrl = (credited || NO_CODE_CREDIT.has(id)) && link ? link : null;
  }
  papers[id] = {
    id,
    title: m.title,
    authors: Array.isArray(m.authors) ? m.authors : [],
    year: m.year || null,
    venue: m.venue || null,
    arxiv_id: m.arxiv_id || null,
    doi: m.doi || null,
    url: m.landing_url || m.paper_url || (m.doi ? 'https://doi.org/' + m.doi : null),
    pdf_url: m.pdf_url || null,
    method: repro ? repro.method : (muse ? muse.method : (inv ? inv.Method : null)),
    experiment: hand ? null : (t.primary_experiment ? t.primary_experiment.id : null),
    experiment_description: t.primary_experiment ? t.primary_experiment.description : null,
    dataset: { family: family || null, slug: dataset.slug, name: dataset.name },
    code_url: codeUrl,
    fully_reported: fullyReported,
    hand_audit: hand ? { author_code: hand.author_code, fully_reported_paper: hand.fully_reported_paper, fully_reported_with_code: hand.fully_reported_with_code } : null,
    details,
    claim,
    reproduction
  };
}

const out = {
  generated_at: new Date().toISOString(),
  source: 'OWL research workbench: paper-only disclosure tables, verified claim targets, Table 4 reproduction cells',
  baseline_policy: 'OWL baseline = the closest validated run given the paper and the OWL spec (Table 5), from FINAL_CELLS.json',
  papers
};
fs.writeFileSync(path.join(outDir, 'papers.json'), JSON.stringify(out, null, 1) + '\n');
if (conflicts.length) console.log(`hand audit vs extraction (both kept):\n  ${conflicts.join('\n  ')}`);
if (assumedSkipped.length) console.log(`assumed values not shown:\n  ${assumedSkipped.join('\n  ')}`);
const all = Object.values(papers);
console.log(`wrote ${all.length} papers (${all.filter((p) => p.reproduction).length} reproduced, ${all.filter((p) => p.claim).length} with claims) to data/owl/papers.json`);
if (skipped.length) console.log(`skipped: ${skipped.join('; ')}`);
