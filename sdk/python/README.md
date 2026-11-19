# owl-wireless

Python client for **OWL (Open Wireless Learning)**: the telecom ML dataset catalog, checksum-verified
releases, paper reproduction pages, and private server-side scoring on hidden test labels.

```bash
pip install owl-wireless            # Python >= 3.9; optional: pip install "owl-wireless[arrow]"
```

The import name is `owl_wireless` (a different `owl` package exists on PyPI); the command is `owl`.

## Quickstart

```python
import owl_wireless as owl, pandas as pd
from sklearn.linear_model import LogisticRegression

split = owl.dataset("ujiindoorloc").load()           # download, cache, verify SHA-256
cols = [c for c in split.test_inputs.columns if c != "sample_id"]
prep = lambda df: df[cols].replace(100, -110).add(110).div(110)   # RSSI 100 = not heard

model = LogisticRegression(max_iter=2000).fit(prep(split.train), split.train[split.target])
print("val", (model.predict(prep(split.val)) == split.val[split.target]).mean())
preds = pd.DataFrame({"sample_id": split.test_inputs["sample_id"],
                      "prediction": model.predict(prep(split.test_inputs))})
print(owl.score(preds, dataset="ujiindoorloc"))      # needs OWL_TOKEN; private result
p = owl.paper("P62")
print(p.claimed.value, p.baseline.score, p.metadata["batch_size"].source)
```

## API

```python
owl.datasets(task=None, released=None)   # -> list[DatasetInfo]
ds = owl.dataset("ujiindoorloc")         # slug, title, DOI, catalog id or release alias
ds.info                                  # task, license, access, redistribution, paper_count, release_versions
ds.papers()                              # -> list[PaperInfo] with .claimed and .baseline (None if absent)
split = ds.load(version=None)            # latest release by default
split = ds.load(source_dir="~/Downloads/CICIDS2017")   # datasets OWL does not redistribute
split.train, split.val, split.test_inputs   # DataFrames; dict of numpy arrays for IQ (.npz) releases
split.target, split.metric, split.files     # target column, metric, verified local paths

p = owl.paper("P62")                     # OWL id, DOI or arXiv id
p.metadata                               # {key: Detail(status, value, source, evidence, assumed_value, ...)}
p.claimed                                # Claim(value, unit, metric, split, location, page, url)
p.baseline                               # Baseline(score, validation_rule, agent, model, gap, ...) or None
p.artifact.download("dir/")              # reproduce.py, config.yaml, RESULT.json, logs

owl.score(predictions, dataset="ujiindoorloc", version=None)   # -> ScoreResult (private)
```

Command line, same functions:

```bash
owl datasets [--task localization] [--released]
owl get ujiindoorloc
owl get cicids2017 --source-dir ~/Downloads/CICIDS2017
owl paper P62 [--download DIR]
owl score preds.csv --dataset ujiindoorloc
```

Add `--json` to any command for machine-readable output.

## Behaviour

**Downloads.** `load()` downloads from OWL only when the release is *mirrored* and the catalog marks the
dataset's redistribution as `allowed`. Every file is checked against the SHA-256 in the release manifest. A
mismatch raises `ChecksumMismatch` and deletes the partial file. Each release carries its license, where the
license was checked, the attribution text, and any extra terms, such as RadioML's NonCommercial / ShareAlike
(`ds.info.releases[0].license`).

**Datasets OWL does not redistribute** (for example CICIDS2017 and CICIoT2023). OWL publishes a *split definition*
instead of data: sample IDs per split (`assignments.csv`), the task file (target, feature columns, provider file
names with SHA-256), and a build script. Download the provider files yourself, then:

```python
split = owl.dataset("cicids2017").load(source_dir="~/Downloads/CICIDS2017")
```

This verifies the provider files' checksums and builds the same train / validation / test-features CSVs locally,
streaming in constant memory. Without `source_dir`, `load()` raises `DatasetNotReleased` with the provider link
(`exc.provider_url`). The same build works without Python packages:
`python build_split.py --task task.json --assignments assignments.csv --source DIR --out OUT`, using the files
from `/releases/{id}/files/{task,split_assignment,build_script}`. Hidden-label scoring works the same way, because
the test labels stay on the server.

**Cache.** Files go to `~/.cache/owl` (override with `OWL_CACHE`). A file whose checksum already matches is
never downloaded again. A `<file>.sha256` sidecar records the verified hash for the file's size and mtime,
so big files are hashed once.

**Data formats.** CSV / CSV.GZ releases load as pandas DataFrames with a `sample_id` column. IQ releases
(RadioML, WiSig) are zip archives of `.npz` groups. They load as `dict[str, numpy.ndarray]` (for example `iq`
with shape `(n, 2, length)`, plus `sample_id`), concatenated in archive order. Test inputs never contain the
target.

**Scoring.** Upload a CSV / CSV.GZ path or a DataFrame with exactly `sample_id,prediction`, in test-file
order. The client checks the row count, and the `sample_id` order too when the test file is cached, before
uploading. Only predictions are sent. Labels stay on the server, and the result is returned to you, not
published and not written to disk.

**Data fidelity.** Values come from OWL as-is. Missing fields are `None`. Assumed reproduction details keep
`source == "assumed"`, with the assumed value in `assumed_value` (their `value` stays `None`).

## Evaluation token (`OWL_TOKEN`)

The website protects scoring with a Cloudflare Turnstile captcha. Scripts use an evaluation API token
instead, sent as `Authorization: Bearer $OWL_TOKEN` on the same `/api/v1/evaluations` endpoints. Tokens are
issued by the OWL maintainers: they run `scripts/evaluation-key.sh --generate` and add only the token's
SHA-256 digest to the backend's `TMLB_EVALUATION_API_KEY_SHA256S`. Keep the token out of source control.

```bash
export OWL_TOKEN=...      # or owl.score(..., token="...")
```

## Endpoints

| What | Default | Override |
| --- | --- | --- |
| Release registry, manifests, file redirects, scoring | `https://telemlebench.vercel.app/api/v1` | `OWL_API` |
| Catalog (read-only Supabase tables) | project URL and publishable key from the site's `config.js` | `OWL_SUPABASE_URL`, `OWL_SUPABASE_KEY` |
| Paper pages and run artifacts | `https://owl.publicvm.com/data/owl/` | `OWL_SITE` |

## Errors

All exceptions derive from `owl_wireless.OWLError`: `NotFound`, `Ambiguous`, `DatasetNotReleased`, `ChecksumMismatch`,
`NotReproduced` (raised by `paper.artifact` when there is no validated reproduction),
`AuthenticationRequired`, `ScoringError` (with `.code` and `.row_number`) and `ServiceError`.

## Development

```bash
pip install -e ".[test]"
pytest                                  # offline, against recorded responses in tests/fixtures
OWL_LIVE=1 OWL_TOKEN=... pytest tests/test_live.py -s   # live smoke test
python tests/record_fixtures.py         # re-record fixtures
```

License: Apache-2.0.
