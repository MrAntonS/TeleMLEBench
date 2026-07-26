## Scope

Describe the dataset, evidence, frontend behavior, documentation, or test contract changed by this pull request.

## Evidence and behavior

- Public record or issue:
- Upstream source/version:
- User-visible outcome:
- Screenshots for visual changes:

## Verification

- [ ] `npm run test:static`
- [ ] `npm run test:e2e`
- [ ] Desktop and mobile behavior were checked when the UI changed.
- [ ] Empty, unavailable, and pending states remain distinct.

## Safety and publication checklist

- [ ] I did not commit credentials, `.env` files, database files, dataset payloads, paper PDFs, restricted supplements, private URLs, or personal data.
- [ ] The production bundle remains dependency-free and contains no `localhost` API origin.
- [ ] The UI uses supported public `/api/v1` routes and does not expose internal jobs, reviews, raw provider metadata, hidden labels, or self-reported scoring.
- [ ] Dataset identity is not inferred from its name, and a paper citation is not presented as dataset use.
- [ ] Claims, paper-specific splits, TeleMLEBench splits, attempted runs, and verified server-scored results remain visibly distinct.
