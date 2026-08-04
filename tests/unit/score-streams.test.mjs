import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  PredictionValidationError,
  scoreCsvStreams
} from '../../server/lib/score-streams.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const labels = Buffer.from(
  'sample_id,label\n' +
  'sample-a,benign\n' +
  'sample-b,attack\n' +
  'sample-c,attack\n'
);

test('streams an exact sample-id-aligned accuracy score and hashes both inputs', async () => {
  const predictions = Buffer.from(
    'sample_id,prediction\n' +
    'sample-a,benign\n' +
    'sample-b,attack\n' +
    'sample-c,benign\n'
  );
  const result = await scoreCsvStreams({
    labelStream: Readable.from(labels),
    predictionStream: Readable.from(predictions),
    expectedRows: 3,
    expectedLabelsSha256: sha256(labels)
  });
  assert.equal(result.correct, 2);
  assert.equal(result.sampleCount, 3);
  assert.equal(result.value, 2 / 3);
  assert.equal(result.labelsSha256, sha256(labels));
  assert.equal(result.predictionsSha256, sha256(predictions));
});

test('rejects reordered predictions instead of scoring by row position', async () => {
  const predictions = Buffer.from(
    'sample_id,prediction\n' +
    'sample-b,attack\n' +
    'sample-a,benign\n' +
    'sample-c,attack\n'
  );
  await assert.rejects(
    scoreCsvStreams({
      labelStream: Readable.from(labels),
      predictionStream: Readable.from(predictions),
      expectedRows: 3,
      expectedLabelsSha256: sha256(labels)
    }),
    (error) => error instanceof PredictionValidationError &&
      error.code === 'sample_id_mismatch' && error.rowNumber === 2
  );
});

test('supports gzip inputs while verifying hashes over the stored bytes', async () => {
  const compressedLabels = gzipSync(labels);
  const predictions = gzipSync(Buffer.from(
    'sample_id,prediction\n' +
    'sample-a,benign\n' +
    'sample-b,attack\n' +
    'sample-c,attack\n'
  ));
  const result = await scoreCsvStreams({
    labelStream: Readable.from(compressedLabels),
    predictionStream: Readable.from(predictions),
    labelsCompressed: true,
    predictionsCompressed: true,
    expectedRows: 3,
    expectedLabelsSha256: sha256(compressedLabels)
  });
  assert.equal(result.value, 1);
  assert.equal(result.predictionsSha256, sha256(predictions));
});

test('rejects incomplete files and never silently scores a subset', async () => {
  const predictions = Buffer.from(
    'sample_id,prediction\n' +
    'sample-a,benign\n' +
    'sample-b,attack\n'
  );
  await assert.rejects(
    scoreCsvStreams({
      labelStream: Readable.from(labels),
      predictionStream: Readable.from(predictions),
      expectedRows: 3,
      expectedLabelsSha256: sha256(labels)
    }),
    (error) => error instanceof PredictionValidationError &&
      error.code === 'missing_predictions'
  );
});

test('rejects a hidden-label artifact that fails its manifest hash', async () => {
  const predictions = Buffer.from(
    'sample_id,prediction\n' +
    'sample-a,benign\n' +
    'sample-b,attack\n' +
    'sample-c,attack\n'
  );
  await assert.rejects(
    scoreCsvStreams({
      labelStream: Readable.from(labels),
      predictionStream: Readable.from(predictions),
      expectedRows: 3,
      expectedLabelsSha256: '0'.repeat(64)
    }),
    /SHA-256 integrity check/
  );
});
