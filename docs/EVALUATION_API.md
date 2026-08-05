# Release downloads and hidden-label evaluation API

The Vercel deployment exposes a versioned API at `/api/v1`. Its machine-readable
contract is `/api/v1/openapi.json`.

## Public releases

List all releases or filter by the canonical dataset/version identifier:

```http
GET /api/v1/releases
GET /api/v1/releases?dataset_id=10.24432/c5ms59
GET /api/v1/releases?dataset_version_id=dsv_10089411a0c5dbed537ad731
```

Each item has stable download endpoints for the `train`, `validation`, and
`test_features` roles. The file endpoint returns a `307` redirect to the exact
immutable Hugging Face artifact and includes its SHA-256 in
`X-TeleMLEBench-SHA256`.

```http
GET /api/v1/releases/{releaseId}/manifest
GET /api/v1/releases/{releaseId}/files/train
GET /api/v1/releases/{releaseId}/files/validation
GET /api/v1/releases/{releaseId}/files/test_features
```

Only manifest entries marked `public: true` are returned by this API. Private
evaluator repository paths are never included.

## Prediction format

Supervised releases accept CSV or gzip-compressed CSV with exactly two columns:

```csv
sample_id,prediction
<first public test sample id>,<predicted class>
<second public test sample id>,<predicted class>
```

Rows must preserve the public test-feature order. The evaluator still checks
the `sample_id` on every row before comparing the prediction; missing, extra,
duplicated, or reordered IDs fail closed. This streaming contract makes the
largest releases scoreable without putting millions of hidden labels in memory.

## Browser evaluation flow

The GitHub Pages frontend uses Cloudflare Turnstile instead of asking visitors
for an API key. The browser obtains the public site key from
`GET /api/v1/evaluations/config`, completes the challenge, and includes the
short-lived Turnstile response in the Vercel Blob `clientPayload`.

After server-side verification, the upload-token response includes an
`evaluationToken`. This signed grant expires within one hour and is bound to
the exact release and private prediction pathname. The browser holds it only in
memory, uses it to start and poll that one evaluation, then discards it. The
Turnstile secret and grant-signing secret never reach GitHub Pages.

## SDK evaluation flow

Automated clients and the future SDK use:

```http
Authorization: Bearer $TELEMLEBENCH_EVALUATION_KEY
```

The key itself is not stored in the repository or browser storage. Vercel keeps
only comma-separated SHA-256 digests in
`TMLB_EVALUATION_API_KEY_SHA256S`.

1. Use `POST /api/v1/evaluations/uploads` through the Vercel Blob client-upload
   protocol. The server issues a ten-minute token constrained to one private
   `evaluations/{releaseId}/{uuid}/predictions.csv[.gz]` pathname, allowed media
   types, and that release's maximum size.
2. After Blob returns the private pathname, start the durable scorer:

   ```json
   POST /api/v1/evaluations
   {
     "release_id": "ujindoorloc-floor-v1",
     "prediction": {
       "pathname": "evaluations/ujindoorloc-floor-v1/<uuid>/predictions.csv",
       "size": 123456
     }
   }
   ```

3. Poll the returned `status_endpoint` with the same API key. Browser clients
   use their scoped `evaluationToken` instead. The opaque `evaluation_id` is
   cryptographically bound to the supplied credential.
4. A completed result contains the metric, sample count, label artifact hash,
   exact uploaded prediction hash, and scorer version. The private prediction
   Blob is then deleted.

The current classification response resembles:

```json
{
  "status": "completed",
  "release_id": "ujindoorloc-floor-v1",
  "metric": {
    "name": "accuracy",
    "value": 0.91,
    "correct": 2864,
    "sample_count": 3147
  },
  "labels_sha256": "...",
  "predictions_sha256": "...",
  "scorer_version": "telemlebench-vercel-accuracy/1",
  "publication": {
    "public": false,
    "note": "This is a private server-verified score, not a published reproduction result."
  }
}
```

This API score is suitable for interactive checks and automated reproduction
clients. It does **not** bypass the platform's reproduction controls or publish
a leaderboard metric. A public reproduction result still requires a conformant
run bundle and trusted server ingestion.

## Vercel configuration

Required production secrets/resources:

- a private Vercel Blob store (`BLOB_READ_WRITE_TOKEN` is attached by Vercel);
- `HF_TOKEN` with read access only to `NextGLab/telemlebench-evaluator`;
- one or more SHA-256 evaluation-key digests in
  `TMLB_EVALUATION_API_KEY_SHA256S` for SDK clients;
- `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and
  `TURNSTILE_EXPECTED_HOSTNAME=mrantons.github.io`;
- a random server-only `TMLB_EVALUATION_GRANT_SECRET` of at least 32 bytes.

Vercel Workflow generates queue-only consumer functions. The score step uses
`maxDuration: max`, streams both files, retries infrastructure failures, and
keeps hidden labels out of the browser and public API response.
