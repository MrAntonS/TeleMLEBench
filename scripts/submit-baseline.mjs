#!/usr/bin/env node
// Direct-API evaluation of candidate baseline predictions.
//
// Submits a frozen test_predictions.csv for one supervised release straight
// to the evaluation API (no browser, no Turnstile) using an evaluation API
// key, polls the durable scoring workflow, and prints a validated private
// evaluation receipt.
//
// The returned score is PRIVATE by contract
// (publication.public === false). It is not a publishable baseline or a
// substitute for the run bundle, harness, and conformance gates.
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
//   --receipt <path>   write the private evaluation receipt as JSON
//   --help             this text

import { createHash, randomUUID } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';

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
    receipt: '',
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
    else if (flag === '--receipt' && next) args.receipt = next, i += 1;
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

// Blob handshake for the pinned @vercel/blob 2.6.1 client protocol. The
// application endpoint returns a constrained client token; the client then
// uploads bytes to Vercel Blob's API with that token. Keeping this small
// implementation here avoids requiring a browser File object or node_modules
// for a 200 KB operator submission.
async function uploadPredictionBytes({ apiBase, key, release, bytes }) {
  const uploadId = randomUUID();
  const pathname = `evaluations/${release}/${uploadId}/predictions.csv`;
  const clientPayload = JSON.stringify({ release_id: release });
  const tokenResponse = await apiJson(`${apiBase}/evaluations/uploads`, {
    method: 'POST',
    key,
    body: {
      type: 'blob.generate-client-token',
      payload: { pathname, clientPayload, multipart: false },
    },
  });
  const clientToken = tokenResponse && tokenResponse.clientToken;
  if (tokenResponse?.type !== 'blob.generate-client-token' ||
      typeof clientToken !== 'string' ||
      !clientToken.startsWith('vercel_blob_client_')) {
    throw new Error('upload handshake returned an invalid constrained client token');
  }
  const storeId = clientToken.split('_')[3] || '';
  if (!/^[A-Za-z0-9-]+$/.test(storeId)) {
    throw new Error('upload handshake returned an invalid Blob store identifier');
  }
  const blobUrl = new URL('https://vercel.com/api/blob/');
  blobUrl.searchParams.set('pathname', pathname);
  const put = await fetch(blobUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${clientToken}`,
      'x-api-blob-request-id': `${storeId}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      'x-vercel-blob-store-id': storeId,
      'x-api-blob-request-attempt': '0',
      'x-api-version': '12',
      'x-vercel-blob-access': 'private',
      'x-content-type': 'text/csv',
    },
    body: bytes,
  });
  if (!put.ok) {
    throw new Error(`prediction byte upload failed (${put.status}): ${(await put.text()).slice(0, 200)}`);
  }
  const uploaded = await put.json();
  if (!uploaded || uploaded.pathname !== pathname) {
    throw new Error('Blob upload response did not confirm the requested private pathname');
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
  const statusUrl = /^https?:\/\//i.test(statusEndpoint)
    ? statusEndpoint
    : statusEndpoint.startsWith('/')
      ? new URL(statusEndpoint, new URL(apiBase).origin).toString()
      : `${apiBase}/${statusEndpoint.replace(/^\/+/, '')}`;
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const current = await apiJson(statusUrl, { key });
    if (current.status === 'completed') return current.result;
    if (current.status === 'failed') {
      throw new Error(`evaluator failed: ${JSON.stringify(current.error || {})}`);
    }
    if (Date.now() >= deadline) throw new Error('timed out waiting for the evaluator');
    await new Promise((resolve) => { setTimeout(resolve, 5000); });
  }
}

function privateEvaluationReceipt({ evaluationId, release, result, local }) {
  const metric = result && result.metric;
  if (result?.status !== 'completed' || result?.publication?.public !== false ||
      metric?.name !== 'accuracy' || !Number.isFinite(metric.value) ||
      metric.value < 0 || metric.value > 1 ||
      !Number.isSafeInteger(metric.correct) || metric.correct < 0 ||
      metric.sample_count !== local.rows || metric.correct > metric.sample_count) {
    throw new Error('evaluator returned an invalid completed-result contract');
  }
  if (result.predictions_sha256 !== local.sha256) {
    throw new Error('server prediction hash does not match the submitted bytes');
  }
  if (!/^[a-f0-9]{64}$/.test(String(result.labels_sha256 || '')) ||
      result.scorer_version !== 'telemlebench-vercel-accuracy/1' ||
      result.alignment?.join_key !== 'sample_id' ||
      result.alignment?.mode !== 'strict_test_order') {
    throw new Error('evaluator receipt is missing trusted scoring provenance');
  }
  return {
    schema_version: 'telemlebench-private-evaluation-receipt/1',
    evaluation_id: evaluationId,
    release_id: release,
    status: result.status,
    metric,
    predictions_sha256: result.predictions_sha256,
    labels_sha256: result.labels_sha256,
    scorer_version: result.scorer_version,
    alignment: result.alignment,
    publication: result.publication,
    completed_at: result.completed_at,
  };
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
  const receipt = privateEvaluationReceipt({
    evaluationId: started.evaluation_id,
    release: args.release,
    result,
    local,
  });
  console.log('[private-evaluation-receipt]', JSON.stringify(receipt, null, 2));
  if (args.receipt) {
    await writeFile(args.receipt, JSON.stringify(receipt, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    await chmod(args.receipt, 0o600);
    console.log(`[receipt] ${args.receipt}`);
  }
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(1);
});
