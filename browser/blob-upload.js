import { upload } from '@vercel/blob/client';

export async function uploadPrediction({
  apiBase,
  apiKey,
  file,
  releaseId,
  onProgress
}) {
  if (!(file instanceof File)) throw new Error('Choose a prediction CSV first.');
  const compressed = /\.csv\.gz$/i.test(file.name);
  if (!compressed && !/\.csv$/i.test(file.name)) {
    throw new Error('Predictions must be a .csv or .csv.gz file.');
  }
  if (!apiKey) throw new Error('An evaluation API key is required.');
  const uploadId = crypto.randomUUID();
  const pathname = `evaluations/${releaseId}/${uploadId}/predictions.csv${compressed ? '.gz' : ''}`;
  return upload(pathname, file, {
    access: 'private',
    contentType: compressed ? 'application/gzip' : 'text/csv',
    handleUploadUrl: `${String(apiBase).replace(/\/+$/, '')}/evaluations/uploads`,
    clientPayload: JSON.stringify({ release_id: releaseId }),
    headers: { Authorization: `Bearer ${apiKey}` },
    multipart: file.size >= 8 * 1024 * 1024,
    onUploadProgress: onProgress
  });
}
