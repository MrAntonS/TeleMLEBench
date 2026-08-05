// Browser transport for @vercel/blob 2.6's constrained client-token protocol.
// The token is scoped by the server to one private pathname, size, media type,
// and ten-minute validity window. No store credential reaches the browser.
export async function uploadPrediction({ apiBase, apiKey, turnstileToken, file, releaseId, onProgress }) {
  if (!(file instanceof File)) throw new Error('Choose a prediction CSV first.');
  const compressed = /\.csv\.gz$/i.test(file.name);
  if (!compressed && !/\.csv$/i.test(file.name)) {
    throw new Error('Predictions must be a .csv or .csv.gz file.');
  }
  if (!apiKey && !turnstileToken) throw new Error('Complete the human-verification check first.');
  const uploadId = crypto.randomUUID();
  const pathname = `evaluations/${releaseId}/${uploadId}/predictions.csv${compressed ? '.gz' : ''}`;
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const tokenResponse = await fetch(`${String(apiBase).replace(/\/+$/, '')}/evaluations/uploads`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'blob.generate-client-token',
      payload: {
        pathname,
        multipart: false,
        clientPayload: JSON.stringify({
          release_id: releaseId,
          turnstile_token: turnstileToken || ''
        })
      }
    })
  });
  if (!tokenResponse.ok) {
    throw new Error(tokenResponse.status === 401 || tokenResponse.status === 403
      ? 'Human verification was rejected or expired. Please try it again.'
      : 'The private upload could not be authorized.');
  }
  const tokenBody = await tokenResponse.json();
  const clientToken = String(tokenBody.clientToken || '');
  const evaluationToken = String(tokenBody.evaluationToken || apiKey || '');
  const tokenParts = clientToken.split('_');
  const storeId = tokenParts[3] || '';
  if (!clientToken.startsWith('vercel_blob_client_') || !storeId) {
    throw new Error('The upload service returned an invalid constrained token.');
  }

  const result = await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', `https://vercel.com/api/blob/?pathname=${encodeURIComponent(pathname)}`);
    request.responseType = 'json';
    request.setRequestHeader('authorization', `Bearer ${clientToken}`);
    request.setRequestHeader('x-api-blob-request-id', `${storeId}:${Date.now()}:${crypto.randomUUID()}`);
    request.setRequestHeader('x-vercel-blob-store-id', storeId);
    request.setRequestHeader('x-api-blob-request-attempt', '0');
    request.setRequestHeader('x-api-version', '12');
    request.setRequestHeader('x-content-length', String(file.size));
    request.setRequestHeader('x-vercel-blob-access', 'private');
    request.setRequestHeader('x-content-type', compressed ? 'application/gzip' : 'text/csv');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percentage: event.total ? (event.loaded / event.total) * 100 : 0
        });
      }
    };
    request.onerror = () => reject(new Error('The private prediction upload lost its network connection.'));
    request.onabort = () => reject(new Error('The private prediction upload was cancelled.'));
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`The private prediction upload failed (${request.status}).`));
        return;
      }
      const body = request.response || {};
      if (body.pathname !== pathname) {
        reject(new Error('The upload service returned a mismatched private pathname.'));
        return;
      }
      resolve(body);
    };
    request.send(file);
  });
  return { blob: result, evaluationToken };
}
