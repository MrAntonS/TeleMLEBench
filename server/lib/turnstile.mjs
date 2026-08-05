const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export class TurnstileConfigurationError extends Error {}
export class TurnstileUnavailableError extends Error {}

/**
 * @param {string} token
 * @param {{
 *   secret?: string,
 *   expectedHostname?: string,
 *   expectedAction?: string,
 *   remoteIp?: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number
 * }} [options]
 */
export async function verifyTurnstileToken(token, {
  secret,
  expectedHostname,
  expectedAction = 'evaluation_upload',
  remoteIp,
  fetchImpl = fetch,
  timeoutMs = 8000,
} = {}) {
  const responseToken = String(token || '');
  const secretKey = String(secret || '');
  const hostname = String(expectedHostname || '').toLowerCase();
  if (!secretKey || !hostname) {
    throw new TurnstileConfigurationError('Turnstile is not configured');
  }
  if (!responseToken || responseToken.length > 2048) {
    return { success: false, code: 'invalid-input-response' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: secretKey,
        response: responseToken,
        ...(remoteIp ? { remoteip: String(remoteIp) } : {}),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new TurnstileUnavailableError(
      error?.name === 'AbortError'
        ? 'Turnstile verification timed out'
        : 'Turnstile verification is unavailable'
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new TurnstileUnavailableError('Turnstile verification is unavailable');
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new TurnstileUnavailableError('Turnstile returned an invalid response');
  }
  if (result?.success !== true) {
    const codes = Array.isArray(result?.['error-codes']) ? result['error-codes'] : [];
    return { success: false, code: String(codes[0] || 'challenge-failed') };
  }
  if (String(result.hostname || '').toLowerCase() !== hostname) {
    return { success: false, code: 'hostname-mismatch' };
  }
  if (String(result.action || '') !== String(expectedAction)) {
    return { success: false, code: 'action-mismatch' };
  }
  return {
    success: true,
    hostname: String(result.hostname),
    action: String(result.action),
    challengeTimestamp: String(result.challenge_ts || ''),
  };
}
