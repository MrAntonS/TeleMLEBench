import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('GitHub Pages loads release UI from the canonical Vercel API', () => {
  const override = read('pages-config-overrides.js');
  const enhancement = read('public/app-enhancements.js');
  const upload = read('public/browser/blob-upload.js');

  assert.match(
    override,
    /TMLB_EVALUATION_API_BASE\s*=\s*'https:\/\/telemlebench\.vercel\.app\/api\/v1'/
  );
  assert.match(override, /\.\/app-enhancements\.js/);
  assert.match(enhancement, /\/releases\?dataset=/);
  assert.match(enhancement, /\/evaluations\/uploads/);
  assert.match(upload, /blob\.generate-client-token/);
  assert.match(upload, /\/evaluations\/[^`]+\/complete/);

  const stagedEnhancement = enhancement.replace(
    "import('/browser/blob-upload.js')",
    "import('./browser/blob-upload.js')"
  );
  assert.match(stagedEnhancement, /import\('\.\/browser\/blob-upload\.js'\)/);
  assert.doesNotMatch(stagedEnhancement, /import\('\/browser\/blob-upload\.js'\)/);
});
