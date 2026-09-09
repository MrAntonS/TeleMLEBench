#!/usr/bin/env node
// Publish a completed private evaluation as a public server-scored baseline.
//
// The server derives the public record from the completed evaluator run; the
// client only supplies the evaluation id and the trained-model identity. The
// published record explicitly states that training execution is not attested.
//
// Usage:
//   TMLB_EVALUATION_API_KEY=<key> node scripts/publish-baseline.mjs \
//     --evaluation-id <id> --model logistic_regression \
//     --recipe telemlebench-auto-baseline/2 --seed 42
//
// Options:
//   --evaluation-id <id> operator evaluation id from submit-baseline.mjs
//   --model <name>       trained model id (default: logistic_regression)
//   --recipe <version>   training recipe version (default: telemlebench-auto-baseline/2)
//   --seed <n>           training seed, must be 42 (default: 42)
//   --facts <path>       baseline_facts.json whose whitelisted training fields
//                      (params, target, counts, validation metrics) are published
//                      alongside the score for the replication guide
//   --api-base <url>     baselines API base
//                      (default: https://telemlebench.vercel.app/api/v1)
//   --key <key>        operator API key (default: $TMLB_EVALUATION_API_KEY)
//   --help             this text

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_API_BASE = 'https://telemlebench.vercel.app/api/v1';

function parseArgs(argv) {
  const args = {
    evaluationId: '',
    model: 'logistic_regression',
    recipe: 'telemlebench-auto-baseline/2',
    seed: 42,
    facts: '',
    apiBase: DEFAULT_API_BASE,
    key: process.env.TMLB_EVALUATION_API_KEY || '',
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === '--evaluation-id' && next) args.evaluationId = next, i += 1;
    else if (flag === '--model' && next) args.model = next, i += 1;
    else if (flag === '--recipe' && next) args.recipe = next, i += 1;
    else if (flag === '--seed' && next) args.seed = Number(next), i += 1;
    else if (flag === '--facts' && next) args.facts = next, i += 1;
    else if (flag === '--api-base' && next) args.apiBase = next.replace(/\/+$/, ''), i += 1;
    else if (flag === '--key' && next) args.key = next, i += 1;
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (args.seed !== 42) throw new Error('--seed must be 42 for the public baseline');
  return args;
}

async function keyFromFile() {
  const custom = process.env.TMLB_EVALUATION_API_KEY_FILE;
  const fallback = join(homedir(), '.config', 'telemlebench', 'evaluation-api-key');
  for (const candidate of [custom, fallback].filter(Boolean)) {
    try {
      const value = (await readFile(candidate, 'utf8')).split('\n')[0].trim();
      if (value) return value;
    } catch {
      // Fall through to the next candidate.
    }
  }
  return '';
}

// Extract only the whitelisted, server-validated training fields from a
// baseline_facts.json file. Anything unexpected fails server-side.
async function trainingFromFacts(path) {
  const facts = JSON.parse(await readFile(path, 'utf8'));
  const training = {};
  if (facts.selected_params && typeof facts.selected_params === 'object') {
    training.params = facts.selected_params;
  }
  if (facts.target_column) training.target_column = facts.target_column;
  if (Array.isArray(facts.selected_features)) {
    training.selected_feature_count = facts.selected_features.length;
    training.selected_features = facts.selected_features;
  }
  if (Array.isArray(facts.feature_columns)) {
    training.feature_columns = facts.feature_columns;
  }
  if (facts.library_versions && typeof facts.library_versions === 'object') {
    training.library_versions = {};
    for (const [key, entry] of Object.entries(facts.library_versions)) {
      const flat = String(key).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (flat && typeof entry !== 'object') training.library_versions[flat] = String(entry);
    }
  }
  if (facts.n_train) training.n_train = facts.n_train;
  if (facts.n_validation) training.n_validation = facts.n_validation;
  if (facts.validation_metrics && typeof facts.validation_metrics === 'object') {
    training.validation_metrics = facts.validation_metrics;
  }
  if (!training.params) throw new Error(`${path} has no selected_params to publish`);
  return training;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.evaluationId) {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL(import.meta.url), 'utf8');
    const header = source.split('// Options:')[0].split('\n')
      .filter((line) => line.startsWith('//'))
      .map((line) => line.replace(/^\/\/ ?/, ''))
      .join('\n');
    process.stdout.write(header + '\n');
    process.exit(args.help ? 0 : 2);
  }
  const key = args.key || await keyFromFile();
  if (!key) throw new Error('missing operator API key: --key, $TMLB_EVALUATION_API_KEY, or the saved key file');
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('a SHA-256 digest was supplied; the plaintext operator key is required');
  }
  let training;
  if (args.facts) {
    training = await trainingFromFacts(args.facts);
  }
  const response = await fetch(`${args.apiBase}/baselines`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      evaluation_id: args.evaluationId,
      model: { name: args.model, recipe_version: args.recipe, seed: args.seed, ...(training ? { training } : {}) },
    }),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`POST ${args.apiBase}/baselines returned non-JSON (${response.status})`);
  }
  if (!response.ok) {
    const detail = payload && (payload.statusMessage || payload.detail || payload.message);
    throw new Error(`baseline publication failed (${response.status}): ${detail || text.slice(0, 200)}`);
  }
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(1);
});
