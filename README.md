# TeleMLEBench

A standalone, dependency-free implementation of the **TeleMLEBench leaderboard** —
a searchable catalog of telecom-ML benchmarks (modulation classification, CSI feedback,
beam/blockage prediction, radio-map estimation) where every leaderboard shows not just
what a paper **claims**, but what was **independently reproduced**.

This was implemented from the Claude Design comp `TeleMLEBench.dc.html`, which only ran
inside the proprietary `support.js` React runtime. This version is plain HTML/CSS/JS — no
build step, no framework — and loads all of its data live from the **TeleMLEBench REST
API** (`/api/v1`).

## Run it

The app needs the [TeleMLEBench API](#connecting-to-the-api) reachable from the browser.

1. Start the API, e.g. `uvicorn api:app --port 8080` (serves `http://localhost:8080/api/v1`).
2. Open **`index.html`** in any modern browser (double-click it, or serve the folder) —
   it defaults to the local API above.

For a single, easy-to-share file, open **`TeleMLEBench.standalone.html`** — the same app
with `app.js` inlined.

## Connecting to the API

The API base URL is resolved in this order (first match wins):

1. a `?api=<url>` query-string parameter (handy for quick testing);
2. `window.TMLB_API_BASE` — set in `index.html` (this is the spot to edit for deployment);
3. a `<meta name="tmlb-api-base" content="…">` tag;
4. the default `http://localhost:8080/api/v1`.

To point the deployed site at a real backend, edit the config block near the bottom of
`index.html`:

```html
<script>
  window.TMLB_API_BASE = "https://api.your-host.example/api/v1";
</script>
```

The base URL must end in `/api/v1`. Note that an `https://` page cannot call
`http://localhost` (browsers block mixed content), so when the site is served over HTTPS
(e.g. GitHub Pages) point `TMLB_API_BASE` at an HTTPS API. The API's CORS policy must
allow the site's origin (it defaults to `https://mrantons.github.io` plus localhost dev
ports).

Endpoints used: `GET /benchmarks` (cards), `GET /benchmarks/{slug}` (detail + leaderboard),
and `GET /stats` (hero counters). If the API can't be reached, the app shows an error
state with a **Retry** button rather than any placeholder data.

## What's here

| File | Purpose |
|------|---------|
| `index.html` | App shell + full stylesheet; sets `window.TMLB_API_BASE`, then loads `app.js`. |
| `app.js` | API client + adapters, scoring/ranking/delta logic, a small state store with async loading/error states, a string-template renderer, and click/keyboard event delegation. |
| `TeleMLEBench.standalone.html` | Single-file build (`app.js` inlined). |
| `data.js` | Legacy demo dataset (`window.TMLB_DATA`) from the original design comp — no longer loaded by the app; kept as a reference for the data shape. |
| `src/TeleMLEBench.source.html` | The original design comp, decoded for reference. |

## Features

- **Three views** — Home (hero, stats, featured cards), Datasets (search + category filter),
  and Dataset detail (metadata, `df.head(5)` preview, download splits, leaderboard).
- **Leaderboard logic** faithfully ported from the design:
  - ranks by **reproduced** or **claimed** score (toggle), respecting each metric's direction
    (higher- vs. lower-is-better);
  - colors the **Δ (claimed − reproduced)** gap — green for gains, red (bold for large gaps)
    for regressions, amber for suspect entries;
  - badges sources (Author-verified / AI-reproduced / Official baseline) and reproduction
    status (reproduced / partial / failed / **suspect**);
  - **"Top verified"** deliberately excludes failed and suspect entries, so a leaked
    score (one far better than the claimed number) never gets crowned.
- **Reproduction panel** (click any AI-reproduced row), plus **submit** and **dispute**
  modals. The modals are currently UI-only; wiring them to the API's `POST /submissions`
  would require the researcher auth flow (JWT / API key), which is not implemented here.
- **Loading & error states** for every fetch — spinners while data loads, and an error
  card with **Retry** if the API is unreachable.
- **Deep-link routes** via the URL hash: `#/`, `#/datasets`, `#/dataset/<slug>`
  (e.g. `#/dataset/radioml2016-10a`). Browser back/forward and Escape-to-close are supported.

All numbers come live from the TeleMLEBench API.
