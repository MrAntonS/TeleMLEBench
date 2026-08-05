import { createHash } from 'node:crypto';

export class EvaluationGrantAlreadyClaimedError extends Error {}

export function evaluationGrantClaimPath(grantId) {
  const value = String(grantId || '');
  if (!value || value.length > 256) {
    throw new Error('A valid evaluation grant ID is required');
  }
  const digest = createHash('sha256').update(value, 'utf8').digest('hex');
  return 'evaluation-grants/' + digest + '.claim';
}

export async function claimEvaluationGrant(grantId, putImpl) {
  const pathname = evaluationGrantClaimPath(grantId);
  try {
    await putImpl(pathname, 'claimed', {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 60,
      contentType: 'text/plain',
    });
  } catch (error) {
    if (error?.name === 'BlobPreconditionFailedError') {
      throw new EvaluationGrantAlreadyClaimedError('Evaluation grant was already used');
    }
    throw error;
  }
  return pathname;
}
