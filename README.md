# OpenWirelessLearning (OWL) frontend

OpenWirelessLearning (OWL) is a dependency-free public frontend for a source-first catalog of
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

1. Use the committed read-only Supabase project in `config.js`.
2. From a `127.0.0.1` preview only, append
   `?api=http://127.0.0.1:8080/api/v1` to test the FastAPI backend.

The default frontend reads the qualified public catalog directly from Supabase.
Its publishable browser key is intentionally public; row-level security allows
anonymous reads and denies anonymous writes. The client maps these public
tables to the existing screen contract:

- `tmlb_datasets`
- `tmlb_dataset_versions`
- `tmlb_dataset_sources`
- `tmlb_source_files`
- `tmlb_dataset_profiles`
- `tmlb_papers`
- `tmlb_paper_versions`
- `tmlb_dataset_paper_usage`

Only datasets that passed publication qualification and have confirmed
paper-use evidence are present in these tables. Missing release or reproduction
records are shown as unavailable; the client does not fabricate them. The
local `?api=` override retains the source-first FastAPI contract for development.

## GitHub Pages

The Pages workflow publishes `config.js` with the static site. Production uses
the HTTPS Supabase project configured there and never defaults to localhost.
No Vercel deployment or server-side proxy is required.

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
