import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('existing Pages files expose release downloads through the Vercel API', () => {
  const config = read('config.js');
  const app = read('app.js');

  assert.match(
    config,
    /TMLB_EVALUATION_API_BASE\s*=\s*'https:\/\/telemlebench\.vercel\.app\/api\/v1'/
  );
  assert.match(app, /Published split downloads/);
  assert.match(app, /loadPublishedReleaseCatalog/);
  assert.match(app, /dataset_aliases/);
  assert.match(app, /Download ready/);
  assert.match(app, /\/releases\?dataset=/);
  assert.match(app, /test_features/);
  assert.match(app, /\/evaluations\/uploads/);
  assert.match(app, /\/evaluations\/config/);
  assert.match(app, /challenges\.cloudflare\.com\/turnstile/);
  assert.match(app, /turnstile_token/);
  assert.match(app, /Human verification/);
  assert.doesNotMatch(app, /Evaluation API key/);
  assert.doesNotMatch(app, /name = 'evaluation-key'/);
  assert.match(app, /blob\.generate-client-token/);
  assert.doesNotMatch(app, /import\('\/browser\/blob-upload\.js'\)/);
});
