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
// Logs and scripts must not leak local filesystem paths.
const scrub = (text) => text.replaceAll(os.homedir(), '~');

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
// Families without a catalog record (DeepMIMO, ORACLE) get no dataset link.
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
    }
  }
};

// The OWL baseline shown on each paper page: the Deep Agents + Gemma 4 31B
// run given the paper plus the OWL spec, when FINAL_CELLS marks it valid.
// `assumed` lists details the paper does not give and the agent had to choose;
// `check` is a substring that must appear on that line of reproduce.py.
const REPRODUCTIONS = {
  P61: {
    method: 'WiFi FAB-MAP',
    claimSplit: 'UJIIndoorLoc validation set (1,111 examples) used as test; database from the training set',
    owlSplit: 'validation (1,111 examples), same set as the paper',
    assumed: {
      random_seed: { value: '42', line: 64, check: 'np.random.seed(42)' }
    },
    note: 'Same evaluation set as the paper. The script is a simplified FAB-MAP with a naive-Bayes observation model and no Chow-Liu tree, which the paper uses. The agent hit the 45-minute limit; its final script re-ran offline to the same score.'
  },
  P62: {
    method: 'SCNN (sequential classification neural network)',
    claimSplit: 'UJIIndoorLoc validation set (1,111 observations)',
    owlSplit: 'validation (1,111 observations), same set as the paper',
    assumed: {
      optimizer_lr: { value: 'Adam, learning rate 1e-4', line: 31, check: 'lr=1e-4' },
      batch_size: { value: '20', line: 31, check: 'batch_size=20' },
      epochs: { value: '50', line: 31, check: 'epochs=50' }
    },
    note: 'Same 1,111-observation validation set as the paper. Optimizer, learning rate, batch size and epochs are not in the paper and were assumed by the agent. The paper gives no layer sizes, so each stage is a small MLP. The script also filters access points using training and validation data together, which the paper does not describe.'
  },
  P68: {
    method: 'XAI feature ensemble (Leveled) + CatBoost',
    claimSplit: '70/30 train/test split of VeReMi, random under-sampling for balance',
    owlSplit: '70/30 train/test split, random under-sampling',
    assumed: {
      split_seed: { value: '42 (train_test_split random_state)', line: 119, check: 'random_state=42' }
    },
    note: 'OWL scores higher than the claim. The split seed is assumed. The authors’ code uses a random message-level split and selects CatBoost’s best iteration on the test set; agents that follow that split reach 100%, so the gap reflects the paper’s protocol rather than leakage added by OWL.'
  },
  P96: {
    method: 'Dense ResNet-68 C (complex convolutions)',
    claimMetric: 'peak classification accuracy (paper: 14 dB SNR)',
    claimSplit: '50/50 random train/test split, repeated five times',
    owlSplit: '50/50 random split of the 187k labelled pool, scored at 12 dB SNR',
    assumed: {
      optimizer_lr: { value: 'Adam, learning rate 1e-3', line: 115, check: 'lr=1e-3' },
      batch_size: { value: '1024', line: 110, check: 'batch_size=1024' },
      epochs: { value: '5', line: 119, check: 'range(5)' },
      random_seed: { value: '2020', line: 89, check: 'seed = 2020' },
      split_seed: { value: '2020 (train_test_split random_state)', line: 101, check: 'random_state=seed' }
    },
    note: 'Not the same evaluation point: the public release lacks 33 (modulation, SNR) groups, including AM-DSB and GFSK at 14 dB, so OWL scores at 12 dB, where a faithful run is expected about 1 point below the 14 dB peak. The agent trained only 5 epochs (assumed).'
  }
};

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

function round(value, digits = 2) {
  return value == null ? null : Number(Number(value).toFixed(digits));
}

const cohort = exists(cohortFile) ? readJson(cohortFile) : {};
const cells = readJson(path.join(bench, 'runs', 'FINAL_CELLS.json'));
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(artifactDir, { recursive: true });

const papers = {};
const skipped = [];
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

  let reproduction = null;
  if (repro) {
    const cell = cells.find((x) => x.paper === id && x.harness === 'deepagents' &&
      x.model === 'gemma-4-31b' && x.condition === 'owl');
    if (!cell || cell.kind !== 'ok') fail(`${id}: Deep Agents + Gemma 4 31B OWL cell is not valid in FINAL_CELLS`);
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
      'inputs: [PAPER.md, OWL_SPEC.json, TASK.md]   # no author code',
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

  const codeUrl = cohort[id] && !UNREACHABLE_CODE.has(id) ? cohort[id] : null;
  const cov = t.paper_only_coverage || {};
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
    method: repro ? repro.method : null,
    experiment: t.primary_experiment ? t.primary_experiment.id : null,
    experiment_description: t.primary_experiment ? t.primary_experiment.description : null,
    dataset: { family: family || null, slug: dataset.slug, name: dataset.name },
    code_url: codeUrl,
    fully_reported: { k: cov.fully_specified ?? details.filter((d) => d.status === 'full').length, n: cov.applicable ?? 10 },
    details,
    claim,
    reproduction
  };
}

const out = {
  generated_at: new Date().toISOString(),
  source: 'OWL research workbench: paper-only disclosure tables, verified claim targets, Table 4 reproduction cells',
  baseline_policy: 'OWL baseline = Deep Agents + Gemma 4 31B given the paper and the OWL spec, when that run is valid in FINAL_CELLS.json',
  papers
};
fs.writeFileSync(path.join(outDir, 'papers.json'), JSON.stringify(out, null, 1) + '\n');
const all = Object.values(papers);
console.log(`wrote ${all.length} papers (${all.filter((p) => p.reproduction).length} reproduced, ${all.filter((p) => p.claim).length} with claims) to data/owl/papers.json`);
if (skipped.length) console.log(`skipped: ${skipped.join('; ')}`);
