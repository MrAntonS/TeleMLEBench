import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
}

test('browser configuration exposes a site key but never server secrets', () => {
  const route = read('server/api/v1/evaluations/config.get.ts');
  assert.match(route, /turnstile_site_key/);
  assert.match(route, /enabled/);
  assert.doesNotMatch(route, /turnstile_secret_key\s*:/i);
  assert.doesNotMatch(route, /grant_secret\s*:/i);
});

test('upload authorization validates grant configuration before Turnstile', () => {
  const route = read('server/api/v1/evaluations/uploads.post.ts');
  assert.ok(
    route.indexOf('isEvaluationGrantSecretConfigured') <
      route.indexOf('verifyTurnstileToken(turnstileToken')
  );
  assert.match(route, /optionalEvaluationApiPrincipal/);
  assert.match(route, /issueEvaluationGrant/);
});

test('evaluation claims a browser grant before starting a workflow', () => {
  const route = read('server/api/v1/evaluations/index.post.ts');
  assert.ok(route.indexOf('claimEvaluationGrant') < route.indexOf('start(scorePredictionsWorkflow'));
  assert.match(route, /principal\.kind === "captcha_grant"/);
});

test('SDK API keys remain hash-verified server-side', () => {
  const auth = read('server/lib/evaluation-auth.ts');
  assert.match(auth, /TMLB_EVALUATION_API_KEY_SHA256S/);
  assert.match(auth, /timingSafeEqual/);
});
