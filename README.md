# TeleMLEBench frontend

TeleMLEBench is a dependency-free public frontend for a source-first catalog of
telecom ML datasets, paper-use evidence, and controlled reproduction reports.

The interface is intentionally evidence-led. It does not expose prediction
uploads, hidden-label scoring, disputes, worker internals, or other workflows
that the public API does not support.

## Local preview

Start the included dependency-free preview server:

```bash
node scripts/serve.mjs
```

Then configure the API in one of two ways:

1. Set `window.TMLB_API_BASE` in `config.js`.
2. From a `127.0.0.1` preview only, append
   `?api=http://127.0.0.1:8080/api/v1`.

The frontend first uses the source-first API:

- `GET /datasets`
- `GET /datasets/{slug}`
- `GET /datasets/{slug}/files`
- `GET /papers`
- `GET /reproductions`
- `GET /catalog/coverage`
- `GET /catalog/sources`

During the backend transition it safely falls back to `/benchmarks`, `/runs`,
and `/stats`. Missing release, paper-evidence, or reproduction fields are shown
as unavailable; the client does not fabricate them.

## GitHub Pages

Set the repository variable `TMLB_API_BASE` to the deployed HTTPS API origin,
including `/api/v1`, for example:

```text
https://api.example.org/api/v1
```

The Pages workflow rejects an empty value, a non-HTTPS value, and a value
without `/api/v1`. It generates `config.js` into the deployment artifact, so
production never defaults to a local API.

## Validate

```bash
node scripts/validate.mjs
```

The static contract check verifies required source-first routes, the API
configuration hook, accessibility landmarks, and the absence of unsupported
public submission/worker UI.

## Routes

- `#/home`
- `#/datasets`
- `#/dataset/{slug}`
- `#/papers`
- `#/reproductions`
- `#/methodology`
- `#/coverage`
- `#/contribute`
