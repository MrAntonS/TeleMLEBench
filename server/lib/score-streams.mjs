import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';

import { parse } from 'csv-parse';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_SAMPLE_ID_BYTES = 2048;

export class PredictionValidationError extends Error {
  constructor(code, message, rowNumber = null) {
    super(message);
    this.name = 'PredictionValidationError';
    this.code = code;
    this.rowNumber = rowNumber;
  }
}

function hashingPass(hash) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    }
  });
}

function csvRows(source, compressed, hash) {
  let decoded = source.pipe(hashingPass(hash));
  if (compressed) decoded = decoded.pipe(createGunzip());
  return decoded.pipe(parse({
    bom: true,
    columns: false,
    encoding: 'utf8',
    max_record_size: MAX_RECORD_BYTES,
    relax_column_count: false,
    relax_quotes: false,
    skip_empty_lines: false,
    trim: false
  }));
}

function exactHeader(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length ||
      actual.some((value, index) => value !== expected[index])) {
    throw new PredictionValidationError(
      'invalid_header',
      `${label} CSV header must be exactly ${expected.join(',')}`
    );
  }
}

function labelHeader(actual) {
  if (!Array.isArray(actual) || actual.length !== 2 ||
      actual[0] !== 'sample_id' || !actual[1] || actual[1] === 'prediction') {
    throw new Error('The trusted label artifact has an invalid schema');
  }
}

function validRow(row) {
  return Array.isArray(row) && row.length === 2 &&
    typeof row[0] === 'string' && typeof row[1] === 'string';
}

function destroy(stream) {
  if (stream && typeof stream.destroy === 'function' && !stream.destroyed) {
    stream.destroy();
  }
}

/**
 * Stream an accuracy evaluation without loading labels or predictions into memory.
 * The prediction rows must preserve the public test-feature order; every row is
 * still joined and checked by sample_id before its value is compared.
 */
export async function scoreCsvStreams({
  labelStream,
  predictionStream,
  labelsCompressed = false,
  predictionsCompressed = false,
  expectedRows,
  expectedLabelsSha256
}) {
  if (!Number.isSafeInteger(expectedRows) || expectedRows <= 0) {
    throw new Error('The trusted evaluator has no positive expected row count');
  }
  if (!SHA256_PATTERN.test(String(expectedLabelsSha256 || ''))) {
    throw new Error('The trusted evaluator label hash is invalid');
  }

  const labelHash = createHash('sha256');
  const predictionHash = createHash('sha256');
  const labels = csvRows(labelStream, labelsCompressed, labelHash);
  const predictions = csvRows(predictionStream, predictionsCompressed, predictionHash);
  const labelIterator = labels[Symbol.asyncIterator]();
  const predictionIterator = predictions[Symbol.asyncIterator]();
  let sampleCount = 0;
  let correct = 0;

  try {
    const [labelFirst, predictionFirst] = await Promise.all([
      labelIterator.next(),
      predictionIterator.next()
    ]);
    if (labelFirst.done) throw new Error('The trusted label artifact is empty');
    if (predictionFirst.done) {
      throw new PredictionValidationError('empty_predictions', 'Prediction CSV is empty');
    }
    labelHeader(labelFirst.value);
    exactHeader(predictionFirst.value, ['sample_id', 'prediction'], 'Prediction');

    while (true) {
      const [labelNext, predictionNext] = await Promise.all([
        labelIterator.next(),
        predictionIterator.next()
      ]);
      if (labelNext.done || predictionNext.done) {
        if (labelNext.done !== predictionNext.done) {
          throw new PredictionValidationError(
            predictionNext.done ? 'missing_predictions' : 'extra_predictions',
            predictionNext.done
              ? 'Prediction CSV ended before every test sample was scored'
              : 'Prediction CSV contains rows beyond the test split',
            sampleCount + 2
          );
        }
        break;
      }

      sampleCount += 1;
      if (sampleCount > expectedRows) {
        throw new PredictionValidationError(
          'extra_predictions',
          'Prediction CSV contains rows beyond the published test split',
          sampleCount + 1
        );
      }
      if (!validRow(labelNext.value)) {
        throw new Error(`The trusted label artifact has an invalid row at ${sampleCount + 1}`);
      }
      if (!validRow(predictionNext.value)) {
        throw new PredictionValidationError(
          'invalid_row',
          'Every prediction row must contain exactly sample_id and prediction',
          sampleCount + 1
        );
      }

      const [expectedId, expectedValue] = labelNext.value;
      const [submittedId, submittedValue] = predictionNext.value;
      if (!submittedId || Buffer.byteLength(submittedId, 'utf8') > MAX_SAMPLE_ID_BYTES) {
        throw new PredictionValidationError(
          'invalid_sample_id',
          'Prediction sample_id is empty or too long',
          sampleCount + 1
        );
      }
      if (submittedId !== expectedId) {
        throw new PredictionValidationError(
          'sample_id_mismatch',
          'Prediction sample_id does not match the public test-feature order',
          sampleCount + 1
        );
      }
      if (submittedValue === '') {
        throw new PredictionValidationError(
          'empty_prediction',
          'Prediction values cannot be empty',
          sampleCount + 1
        );
      }
      if (submittedValue === expectedValue) correct += 1;
    }

    if (sampleCount !== expectedRows) {
      throw new PredictionValidationError(
        sampleCount < expectedRows ? 'missing_predictions' : 'extra_predictions',
        `Prediction CSV contains ${sampleCount} data rows; ${expectedRows} are required`
      );
    }

    const labelsSha256 = labelHash.digest('hex');
    if (labelsSha256 !== expectedLabelsSha256) {
      throw new Error('The trusted label artifact failed its SHA-256 integrity check');
    }
    return {
      correct,
      sampleCount,
      value: correct / sampleCount,
      labelsSha256,
      predictionsSha256: predictionHash.digest('hex')
    };
  } finally {
    destroy(labels);
    destroy(predictions);
    destroy(labelStream);
    destroy(predictionStream);
  }
}
