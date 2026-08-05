import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

const PREFIX = 'tmlb_eval_grant_v1';
const MAX_TOKEN_LENGTH = 4096;

function signingKey(secret) {
  const value = String(secret || '');
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error('TMLB_EVALUATION_GRANT_SECRET must contain at least 32 bytes');
  }
  return Buffer.from(value, 'utf8');
}

export function isEvaluationGrantSecretConfigured(secret) {
  return Buffer.byteLength(String(secret || ''), 'utf8') >= 32;
}

function signature(encodedPayload, secret) {
  return createHmac('sha256', signingKey(secret))
    .update(PREFIX + '.' + encodedPayload, 'utf8')
    .digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueEvaluationGrant({
  releaseId,
  pathname,
  ttlSeconds = 60 * 60,
  nowMs = Date.now(),
  grantId = randomUUID(),
}, secret) {
  const issuedAt = Math.floor(nowMs / 1000);
  const ttl = Math.max(60, Math.min(Number(ttlSeconds) || 0, 60 * 60));
  const payload = {
    v: 1,
    jti: String(grantId),
    release_id: String(releaseId),
    pathname: String(pathname),
    iat: issuedAt,
    exp: issuedAt + ttl,
  };
  if (!payload.jti || !payload.release_id || !payload.pathname) {
    throw new Error('Evaluation grant bindings are required');
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return PREFIX + '.' + encoded + '.' + signature(encoded, secret);
}

/**
 * @param {string} token
 * @param {{releaseId?: string, pathname?: string, nowMs?: number}} [binding]
 * @param {string} secret
 */
export function verifyEvaluationGrant(token, {
  releaseId,
  pathname,
  nowMs = Date.now(),
} = {}, secret) {
  const value = String(token || '');
  if (!value || value.length > MAX_TOKEN_LENGTH) return null;
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const expected = signature(parts[1], secret);
  if (!safeEqual(parts[2], expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const now = Math.floor(nowMs / 1000);
  if (
    payload?.v !== 1 ||
    typeof payload.jti !== 'string' ||
    typeof payload.release_id !== 'string' ||
    typeof payload.pathname !== 'string' ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.iat > now + 30 ||
    payload.exp <= now ||
    payload.exp - payload.iat > 60 * 60
  ) return null;
  if (releaseId != null && payload.release_id !== String(releaseId)) return null;
  if (pathname != null && payload.pathname !== String(pathname)) return null;
  return payload;
}

export const EVALUATION_GRANT_PREFIX = PREFIX;
