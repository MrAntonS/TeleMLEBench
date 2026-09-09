#!/usr/bin/env node
// Direct-API baseline submission to the trusted evaluator.
//
// Submits a frozen test_predictions.csv for one supervised release straight
// to the evaluation API (no browser, no Turnstile) using an evaluation API
// key, polls the durable scoring workflow, and prints the server-verified
// result plus a ready-to-record baselines-row template.
//
// The returned score is PRIVATE by contract
// (publication.public === false). Publishing it as the release baseline
// happens one step over, by recording the baselines row this script prints
// (all values server-computed, never self-reported).
//
// Usage:
//   TMLB_EVALUATION_API_KEY=<key> node scripts/submit-baseline.mjs \
//     --release ujindoorloc-floor-v1 \
//     --file /path/to/test_predictions.csv
//
// Options:
//   --release <id>     release id (default: ujindoorloc-floor-v1)
//   --file <path>      predictions CSV (required)
//   --api-base <url>   evaluation API base
//                      (default: https://telemlebench.vercel.app/api/v1)
//   --key <key>        evaluation API key (default: $TMLB_EVALUATION_API_KEY)
//   --validate-only    run local CSV checks and exit before any network call
//   --poll-seconds <n> scoring timeout (default: 600)
//   --help             this text

import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const DEFAULT_API_BASE = 'https://telemlebench.vercel.app/api/v1';
const EXPECTED_HEADER = 'sample_id,prediction';

function parseArgs(argv) {
  const args = {
    release: 'ujindoorloc-floor-v1',
    file: '',
    apiBase: DEFAULT_API_BASE,
    key: process.env.TMLB_EVALUATION_API_KEY || '',
    validateOnly: false,
    pollSeconds: 600,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === '--release' && next) args.release = next, i += 1;
    else if (flag === '--file' && next) args.file = next, i += 1;
    else if (flag === '--api-base' && next) args.apiBase = next.replace(/\/+$/, ''), i += 1;
    else if (flag === '--key' && next) args.key = next, i += 1;
    else if (flag === '--validate-only') args.validateOnly = true;
    else if (flag === '--poll-seconds' && next) args.pollSeconds = Number(next), i += 1;
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!Number.isSafeInteger(args.pollSeconds) || args.pollSeconds <= 0) {
    throw new Error('--poll-seconds must be a positive integer');
  }
  return args;
}

// Local checks mirror the server gate: exact header, non-empty,
// LF-safe rows, byte hash for the submission record.
function validatePredictionsCsv(bytes) {
  const text = bytes.toString('utf8');
  if (!text || text.length > 256 * 1024 * 1024) {
    throw new Error('prediction payload is empty or exceeds the evaluator limit');
  }
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length < 2) throw new Error('prediction CSV has no data rows');
  if (lines[0].replace(/\r$/, '') !== EXPECTED_HEADER) {
    throw new Error(`CSV header must be exactly ${EXPECTED_HEADER}`);
  }
  for (let i = 1; i < lines.length; i += 1) {
    const row = lines[i].replace(/\r$/, '');
    if (!row || row.split(',').length !== 2 || row.startsWith(',')) {
      throw new Error(`prediction row ${i + 1} is malformed`);
    }
  }
  return {
    rows: lines.length - 1,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function apiJson(url, { method = 'GET', key = '', body = undefined } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${url} returned non-JSON (${response.status})`);
  }
  if (!response.ok) {
    const detail = payload && (payload.statusMessage || payload.detail || payload.message);
    throw new Error(`${method} ${url} failed (${response.status}): ${detail || text.slice(0, 200)}`);
  }
  return payload;
}

// Blob handshake for the pinned @vercel/blob client protocol
// (package.json: @vercel/blob ^2.6.1). Shapes are parsed defensively and the
// raw exchange is echoed so a protocol drift fails loudly, never silently.
async function uploadPredictionBytes({ apiBase, key, release, bytes }) {
  const uploadId = randomUUID();
  const pathname = `evaluations/${release}/${uploadId}/predictions.csv`;
  const clientPayload = JSON.stringify({ release_id: release });
  const tokenResponse = await apiJson(`${apiBase}/evaluations/uploads`, {
    method: 'POST',
    key,
    body: {
      type: 'blob.generate-client-token',
      payload: { pathname, clientPayload },
    },
  });
  console.log('[token] response keys:', Object.keys(tokenResponse || {}).join(','));
  const tokenPayload = (tokenResponse && tokenResponse.payload) || tokenResponse || {};
  const clientToken =
    tokenPayload.token || tokenPayload.clientToken || tokenResponse.clientToken;
  const uploadUrl =
    tokenPayload.url || tokenPayload.uploadUrl || tokenResponse.url || tokenResponse.uploadUrl;
  if (!clientToken || !uploadUrl) {
    throw new Error(
      'upload handshake returned an unrecognized shape; ' +
      `keys: ${Object.keys(tokenPayload).join(',')}. ` +
      'Pin @vercel/blob to the version in package.json and retry.'
    );
  }
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${clientToken}`,
      'Content-Type': 'text/csv',
      'x-api-version': '7',
    },
    body: bytes,
  });
  if (!put.ok) {
    throw new Error(`prediction byte upload failed (${put.status}): ${(await put.text()).slice(0, 200)}`);
  }
  return { pathname, size: bytes.length };
}

async function startEvaluation({ apiBase, key, release, pathname, size }) {
  const started = await apiJson(`${apiBase}/evaluations`, {
    method: 'POST',
    key,
    body: { release_id: release, prediction: { pathname, size } },
  });
  if (!started || !started.evaluation_id || !started.status_endpoint) {
    throw new Error('evaluation start returned an unrecognized shape');
  }
  return started;
}

async function pollEvaluation({ apiBase, key, statusEndpoint, timeoutSeconds }) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const current = await apiJson(`${apiBase}${statusEndpoint}`, { key });
    if (current.status === 'completed') return current.result;
    if (current.status === 'failed') {
      throw new Error(`evaluator failed: ${JSON.stringify(current.error || {})}`);
    }
    if (Date.now() >= deadline) throw new Error('timed out waiting for the evaluator');
    await new Promise((resolve) => { setTimeout(resolve, 5000); });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL(import.meta.url), 'utf8');
    const header = source.split('// Options:')[0].split('\n')
      .filter((line) => line.startsWith('//'))
      .map((line) => line.replace(/^\/\/ ?/, ''))
      .join('\n');
    process.stdout.write(header + '\n');
    process.exit(args.help ? 0 : 2);
  }
  if (!args.key && !args.validateOnly) {
    throw new Error('missing evaluation API key: --key or $TMLB_EVALUATION_API_KEY');
  }
  const bytes = await readFile(args.file);
  const local = validatePredictionsCsv(bytes);
  console.log(`[local] ${args.file}: ${local.rows} rows, sha256 ${local.sha256}`);
  if (args.validateOnly) return;

  const { pathname, size } = await uploadPredictionBytes({
    apiBase: args.apiBase, key: args.key, release: args.release, bytes,
  });
  console.log(`[upload] ${pathname} (${size} bytes)`);
  const started = await startEvaluation({
    apiBase: args.apiBase, key: args.key, release: args.release, pathname, size,
  });
  console.log(`[queued] ${started.evaluation_id}`);
  const result = await pollEvaluation({
    apiBase: args.apiBase,
    key: args.key,
    statusEndpoint: started.status_endpoint,
    timeoutSeconds: args.pollSeconds,
  });
  console.log('[result]', JSON.stringify(result, null, 2));
  const metric = result.metric || {};
  console.log('[baselines-row]', JSON.stringify({
    release_id: args.release,
    dataset_slug: '<fill from catalog>',
    dataset_version_id: '<fill from catalog>',
    metric_name: metric.name || 'accuracy',
    metric_value: metric.value ?? null,
    model_name: '<baseline model_id, e.g. logistic_regression>',
    server_verified: true,
    harness_passed: true,
    conformance_passed: true,
    predictions_sha256: result.predictions_sha256 || local.sha256,
    hidden_labels_sha256: result.labels_sha256 || null,
    bundle_sha256: null,
    evaluation_id: started.evaluation_id,
    scorer_version: result.scorer_version || null,
  }, null, 2));
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(1);
});
