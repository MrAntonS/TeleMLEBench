import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

function extractStyleLines(source) {
  // Extract the injected release/evaluator style block: lines inside the
  // style.textContent array that start with a quoted .tml- selector.
  const lines = [];
  let inStyleBlock = false;
  for (const line of source.split('\n')) {
    if (line.includes("style.textContent = [") || line.includes('style.textContent=[')) {
      inStyleBlock = true;
      continue;
    }
    if (inStyleBlock) {
      if (line.includes("].join('')") || line.includes('].join(\x22\x22)')) break;
      const match = line.match(/^\s*'(.+)'\s*,?\s*$/);
      if (match) lines.push(match[1]);
    }
  }
  return lines;
}

function canonicalize(css) {
  // Normalise \x22 back to standard double-quotes so the two files can be compared.
  return css.replace(/\\x22/g, '"');
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
  assert.match(enhancement, /\/evaluations\b/);
  assert.match(upload, /\/evaluations\/uploads/);
  assert.match(upload, /blob\.generate-client-token/);

  const stagedEnhancement = enhancement.replace(
    "import('/browser/blob-upload.js')",
    "import('./browser/blob-upload.js')"
  );
  assert.match(stagedEnhancement, /import\('\.\/browser\/blob-upload\.js'\)/);
  assert.doesNotMatch(stagedEnhancement, /import\('\/browser\/blob-upload\.js'\)/);
});

test('app.js and public/app-enhancements.js inject identical release styles', () => {
  const appLines = extractStyleLines(read('app.js')).map(canonicalize);
  const enhLines = extractStyleLines(read('public/app-enhancements.js'));

  assert.ok(appLines.length >= 35, `app.js style block too short: ${appLines.length} rules`);
  assert.strictEqual(
    appLines.length,
    enhLines.length,
    `style rule count mismatch: app.js=${appLines.length}, enhancements=${enhLines.length}`
  );

  for (let i = 0; i < appLines.length; i++) {
    assert.strictEqual(
      appLines[i],
      enhLines[i],
      `Style rule ${i} differs:\n  app: ${appLines[i]}\n  enh: ${enhLines[i]}`
    );
  }
});

test('release style block uses the dark precision-instrument palette, not the obsolete light palette', () => {
  const enh = read('public/app-enhancements.js');
  // Only inspect the extracted style block so unrelated script content
  // does not produce future false positives.
  const block = extractStyleLines(enh).join('\n');

  // The old light palette must be gone from the release styles.
  assert.doesNotMatch(block, /#fbfcff/, 'light-card background #fbfcff in release styles');
  assert.doesNotMatch(block, /:#2563eb\b/, 'light-theme accent #2563eb in release styles');
  assert.doesNotMatch(block, /border-radius:12px/, 'rounded 12px corner in release styles');
  assert.doesNotMatch(block, /border-radius:9px/, 'rounded 9px corner in release styles');
  assert.doesNotMatch(block, /border-radius:8px/, 'rounded 8px corner in release styles');
  assert.doesNotMatch(block, /border-radius:7px/, 'rounded 7px corner in release styles');
  assert.doesNotMatch(block, /border-radius:50%/, 'round step-number circles in release styles');
  assert.doesNotMatch(block, /background:#fff\b/, 'white card background #fff in release styles');
  assert.doesNotMatch(block, /#1d4ed8/, 'dark-blue link color #1d4ed8 in release styles');
  assert.doesNotMatch(block, /#e8efff/, 'light-blue step indicator bg #e8efff in release styles');

  // The dark theme tokens must be present in the release styles.
  assert.match(block, /var\(--accent\)/);
  assert.match(block, /var\(--ink\)/);
  assert.match(block, /var\(--muted\)/);
  assert.match(block, /var\(--subtle\)/);
  assert.match(block, /var\(--green\)/);
  assert.match(block, /var\(--red\)/);
  assert.match(block, /var\(--line-strong\)/);
  assert.match(block, /border-radius:2px/);
  assert.match(block, /rgba\(25,28,30/);
  assert.match(block, /rgba\(144,\s*144,\s*150/);
  assert.match(block, /rgba\(156,\s*240,\s*255/);
});
