# TeleMLEBench

A standalone, dependency-free implementation of the **TeleMLEBench leaderboard** —
a searchable catalog of telecom-ML benchmarks (modulation classification, CSI feedback,
beam/blockage prediction, radio-map estimation) where every leaderboard shows not just
what a paper **claims**, but what was **independently reproduced**.

This was implemented from the Claude Design comp `TeleMLEBench.dc.html`, which only ran
inside the proprietary `support.js` React runtime. This version is plain HTML/CSS/JS — no
build step, no framework, no network dependency (other than the optional Google-Fonts
webfont, which falls back gracefully).

## Run it

Just open **`index.html`** in any modern browser (double-click it, or serve the folder).
No install, no server required.

For a single, easy-to-share file, open **`TeleMLEBench.standalone.html`** — the same app
with `data.js` and `app.js` inlined.

## What's here

| File | Purpose |
|------|---------|
| `index.html` | App shell + full stylesheet; loads `data.js` then `app.js`. |
| `data.js` | The demo dataset (`window.TMLB_DATA`) — 4 benchmarks, 20 submissions. Extracted byte-for-byte from the design comp so all Unicode (−, ·, ≈, ×, ⟨⟩, …) is exact. |
| `app.js` | Scoring/ranking/delta logic, a small state store, a string-template renderer, and click/keyboard event delegation. |
| `TeleMLEBench.standalone.html` | Single-file build (everything inlined). |
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
    score (e.g. the 0.94 F1 / 0.23 dB demo rows) never gets crowned.
- **Reproduction panel** (click any AI-reproduced row), **submit** and **dispute** modals.
- **Deep-link routes** via the URL hash: `#/`, `#/datasets`, `#/dataset/<id>`
  (e.g. `#/dataset/radioml2018`). Browser back/forward and Escape-to-close are supported.

All numbers are demo data, matching the original design comp.
