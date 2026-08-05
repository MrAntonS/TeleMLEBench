import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isEvaluationGrantSecretConfigured,
  issueEvaluationGrant,
  verifyEvaluationGrant,
} from '../../server/lib/evaluation-grants.mjs';
import {
  claimEvaluationGrant,
  EvaluationGrantAlreadyClaimedError,
  evaluationGrantClaimPath,
} from '../../server/lib/evaluation-claim.mjs';
import {
  TurnstileConfigurationError,
  verifyTurnstileToken,
} from '../../server/lib/turnstile.mjs';

const secret = 'test-only-grant-secret-that-is-at-least-32-bytes';
const nowMs = Date.UTC(2026, 7, 4, 20, 0, 0);

test('evaluation grant is bound to one release and upload path', () => {
  const token = issueEvaluationGrant({
    releaseId: 'veremi-v1',
    pathname: 'evaluations/veremi-v1/one/predictions.csv',
    nowMs,
    grantId: 'grant-one',
  }, secret);
  const payload = verifyEvaluationGrant(token, {
    releaseId: 'veremi-v1',
    pathname: 'evaluations/veremi-v1/one/predictions.csv',
    nowMs: nowMs + 30_000,
  }, secret);
  assert.equal(payload.jti, 'grant-one');
  assert.equal(
    verifyEvaluationGrant(token, { releaseId: 'another-release', nowMs }, secret),
    null
  );
  assert.equal(
    verifyEvaluationGrant(token, { pathname: 'evaluations/other.csv', nowMs }, secret),
    null
  );
});

test('evaluation grant rejects tampering and expiration', () => {
  const token = issueEvaluationGrant({
    releaseId: 'veremi-v1',
    pathname: 'evaluations/veremi-v1/one/predictions.csv',
    ttlSeconds: 60,
    nowMs,
  }, secret);
  assert.equal(verifyEvaluationGrant(token + 'x', { nowMs }, secret), null);
  assert.equal(verifyEvaluationGrant(token, { nowMs: nowMs + 61_000 }, secret), null);
});

test('evaluation grant signing requires a strong server-only secret', () => {
  assert.equal(isEvaluationGrantSecretConfigured('short'), false);
  assert.equal(isEvaluationGrantSecretConfigured(secret), true);
  assert.throws(
    () => issueEvaluationGrant({
      releaseId: 'veremi-v1',
      pathname: 'evaluations/veremi-v1/one/predictions.csv',
    }, 'short'),
    /at least 32 bytes/
  );
});

test('browser evaluation grant can be claimed only once', async () => {
  const stored = new Set();
  const putImpl = async (pathname, body, options) => {
    assert.equal(body, 'claimed');
    assert.equal(options.access, 'private');
    assert.equal(options.allowOverwrite, false);
    if (stored.has(pathname)) {
      const error = new Error('exists');
      error.name = 'BlobPreconditionFailedError';
      throw error;
    }
    stored.add(pathname);
  };
  const expectedPath = evaluationGrantClaimPath('grant-one');
  assert.equal(await claimEvaluationGrant('grant-one', putImpl), expectedPath);
  await assert.rejects(
    claimEvaluationGrant('grant-one', putImpl),
    EvaluationGrantAlreadyClaimedError
  );
});

test('Turnstile validation requires matching hostname and action', async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        success: true,
        hostname: 'mrantons.github.io',
        action: 'evaluation_upload',
        challenge_ts: '2026-08-04T20:00:00Z',
      };
    },
  });
  const result = await verifyTurnstileToken('browser-token', {
    secret: 'turnstile-secret',
    expectedHostname: 'mrantons.github.io',
    fetchImpl,
  });
  assert.equal(result.success, true);
  const mismatch = await verifyTurnstileToken('browser-token', {
    secret: 'turnstile-secret',
    expectedHostname: 'example.com',
    fetchImpl,
  });
  assert.deepEqual(mismatch, { success: false, code: 'hostname-mismatch' });
});

test('Turnstile cannot silently run without server configuration', async () => {
  await assert.rejects(
    verifyTurnstileToken('browser-token'),
    TurnstileConfigurationError
  );
});

test('Turnstile rejects an expired or reused challenge result', async () => {
  const result = await verifyTurnstileToken('used-token', {
    secret: 'turnstile-secret',
    expectedHostname: 'mrantons.github.io',
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { success: false, 'error-codes': ['timeout-or-duplicate'] };
      },
    }),
  });
  assert.deepEqual(result, { success: false, code: 'timeout-or-duplicate' });
});
