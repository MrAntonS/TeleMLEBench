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
- `GET /papers` and `GET /papers/{paper_id}`
- `GET /reproductions` and `GET /reproductions/{experiment_id}`
- `GET /releases/{release_id}/manifest`
- `GET /catalog/coverage`
- `GET /catalog/sources`

It does not call the retired `/benchmarks`, `/runs`, submission, hidden-label,
or worker surfaces. Missing release, paper-evidence, or reproduction fields are
shown as unavailable; the client does not fabricate them.

## GitHub Pages

Set the repository variable `TMLB_API_BASE` to the deployed HTTPS API origin,
including `/api/v1`, for example:

```text
https://api.example.org/api/v1
```

An empty value no longer blocks publication: Pages deploys the public shell and
the interface states that its backend is not configured. A configured value
must use HTTPS and end in `/api/v1`; invalid non-empty values still fail the
deployment. The workflow generates `config.js` into the deployment artifact,
and production never guesses a Pages-local API.

## Validate

```bash
npm ci
npx playwright install chromium
npm test
```

`npm test` runs the dependency-free static contract and a deterministic
Playwright suite. The suite starts a local fixture API and covers populated,
empty, and unavailable service states; desktop and mobile navigation; basic
landmark, label, focus, keyboard, and overflow checks; and the dataset, paper,
and reproduction detail routes. No live backend or credentials are required.

The production site itself remains dependency-free: Playwright and its fixture
server are development/CI tooling only. GitHub Pages runs both test layers
before staging or deploying the three production assets.

## Routes

- `#/home`
- `#/datasets`
- `#/dataset/{slug}`
- `#/papers`
- `#/paper/{paper_id}`
- `#/reproductions`
- `#/reproduction/{experiment_id}`
- `#/methodology`
- `#/coverage`
- `#/contribute`

## Contribute

Use the repository's structured issue forms for dataset suggestions,
evidence corrections or paper links, and takedown concerns. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for evidence, safety, testing, and pull
request requirements. Public issues are never an upload path for dataset
payloads, restricted papers, credentials, private links, or personal data.
