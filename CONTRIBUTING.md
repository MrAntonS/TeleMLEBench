# Contributing to TeleMLEBench

TeleMLEBench is an evidence-led public interface for telecom ML datasets,
immutable task releases, exact paper-use relationships, and controlled
reproduction reports. Contributions must preserve those distinctions.

## Choose the right path

- Use **Suggest a telecom ML dataset** for an official landing page or stable
  identifier that is not yet represented.
- Use **Correct metadata or link a paper** for sourced metadata, identity,
  version, paper-use, or reproduction-report corrections.
- Use **Request correction, restriction, or takedown** for license, ownership,
  privacy, sensitivity, access, or redistribution concerns.
- Open a pull request for frontend code, documentation, test fixtures, or a
  reviewed evidence correction linked to an issue.

Public issues are not an upload channel. Never attach dataset payloads,
paywalled papers, restricted supplements, credentials, private download URLs,
identity documents, or personal data. For active secrets or vulnerabilities,
use the repository's private security-reporting channel when available.

## Evidence rules

- Link the exact provider record and version. Names alone are not identity
  evidence.
- Distinguish measured data, fixed simulated data, generators, software,
  models, papers, and figures.
- Link the exact license or terms; a repository being publicly reachable does
  not prove redistribution is allowed.
- For a paper relationship, provide a short quote with page or section showing
  actual training or evaluation. A citation or related-work mention is not
  enough.
- Do not describe an attempt as verified unless the backend reports a trusted,
  server-recomputed result whose controls passed.

## Frontend development

The production site is plain HTML, CSS, and JavaScript. Runtime data comes only
from supported public `/api/v1` routes. Keep development dependencies and
fixture tooling out of the Pages artifact.

```bash
npm ci
npx playwright install chromium
npm test
```

The browser suite is deterministic and does not require a live backend. Update
its fixtures when the public API contract changes. UI changes should preserve:

- one named main landmark and operable skip navigation;
- keyboard-operable desktop and mobile navigation;
- visible focus and labeled controls;
- responsive layouts without document-level horizontal overflow;
- distinct populated, empty, pending, blocked, and unavailable states;
- safe escaping of provider and paper content.

## Pull requests

Keep changes reviewable and link the relevant issue or source evidence. Explain
the public behavior changed, include screenshots for visual changes, and run
the static and browser suites. Do not bundle a production API URL in source:
GitHub Pages injects `TMLB_API_BASE` from its repository variable after tests
pass.
