// Generates a self-contained main.py that replicates one published baseline.
// Everything the script needs is embedded from the stored baseline record plus
// the release manifest: hyperparameters, feature lists, expected hashes, and
// download locations. The script verifies library versions, validates the
// downloads against manifest checksums, reruns the exact pipeline, and checks
// the predictions hash — exiting non-zero unless the result reproduces.

const MODEL_IMPORTS = {
  logistic_regression: ['sklearn.linear_model', 'LogisticRegression'],
};

function py(value) {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number cannot be embedded');
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((entry) => py(entry)).join(', ') + ']';
  if (typeof value === 'object') {
    return '{' + Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}: ${py(entry)}`).join(', ') + '}';
  }
  throw new Error('unsupported value in replication script');
}

function requiredString(value, label) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw new Error(`${label} is required`);
  return result;
}

export function buildReplicateScript({ baseline, release, apiBase }) {
  if (!baseline || typeof baseline !== 'object') throw new Error('baseline is required');
  const releaseId = requiredString(baseline.release_id, 'baseline.release_id');
  const training = baseline.training && typeof baseline.training === 'object' ? baseline.training : {};
  const params = training.params && typeof training.params === 'object' ? training.params : {};
  if (!Object.keys(params).length) throw new Error('baseline has no training params to replicate');
  const target = training.target_column || (release && Array.isArray(release.target_fields) ? release.target_fields[0] : '');
  requiredString(target, 'training.target_column');
  const features = Array.isArray(training.selected_features) ? training.selected_features : [];
  const columns = Array.isArray(training.feature_columns) ? training.feature_columns : [];
  const metric = requiredString(baseline.metric_name, 'baseline.metric_name');
  const expectedValue = Number(baseline.metric_value);
  if (!Number.isFinite(expectedValue)) throw new Error('baseline.metric_value is invalid');
  const seed = baseline.seed == null ? 42 : Number(baseline.seed);
  const metricLabel = /^[a-z0-9_ ]{1,64}$/i.test(metric) ? metric : 'score';
  const base = requiredString(apiBase, 'apiBase').replace(/\/+$/, '');
  const files = release && Array.isArray(release.files) ? release.files : [];
  const byRole = {};
  for (const file of files) {
    if (file && typeof file === 'object' && file.role && file.download_endpoint && file.sha256) {
      // Only the three splits replication needs; auxiliary manifest files
      // (split assignments and the like) are not downloadable this way.
      if (!['train', 'validation', 'test_features'].includes(file.role)) continue;
      // download_endpoint already starts with /api/v1; store the path relative
      // to the API base so the script joins exactly one prefix.
      byRole[file.role] = {
        path: String(file.download_endpoint).replace(/^\/api\/v1/, ''),
        sha256: String(file.sha256),
        bytes: Number(file.byte_size) || 0,
      };
    }
  }
  for (const role of ['train', 'validation', 'test_features']) {
    if (!byRole[role]) throw new Error(`release is missing the ${role} file`);
  }
  const libs = training.library_versions && typeof training.library_versions === 'object'
    ? training.library_versions
    : {};
  const importPair = MODEL_IMPORTS[baseline.model_name];
  const paramLines = Object.keys(params).map((name) => `        ${name}=${py(params[name])},`).join('\n');
  const modelSection = importPair
    ? `    from ${importPair[0]} import ${importPair[1]}\n    model = ${importPair[1]}(\n${paramLines}\n    )`
    : `    # No code template for model '${baseline.model_name}' (recipe ${baseline.recipe_version || 'unknown'}).\n    # PARAMS for manual use: ${py(params)}\n    raise SystemExit("Replication needs a code template for this model.")`;
  const columnNote = columns.length && features.length
    ? 'impute and scale on ALL_COLUMNS, then select FEATURES (reference order)'
    : 'exact column lists were not recorded for this baseline; using a heuristic — the hash check below is the arbiter';
  const allColumns = columns.length ? columns : features;
  const featuresOrHeuristic = features.length ? features : 'auto';
  const validationMetrics = training.validation_metrics && typeof training.validation_metrics === 'object'
    ? training.validation_metrics
    : {};
  const runtimeLibs = ['numpy', 'pandas', 'scipy', 'sklearn']
    .filter((name) => libs[name])
    .map((name) => `${name === 'sklearn' ? 'scikit-learn' : name}==${libs[name]}`);
  const pipCommand = runtimeLibs.length ? `pip install ${runtimeLibs.join(' ')}` : '';

  return `#!/usr/bin/env python3
"""Replicate TelemleBench baseline ${releaseId} (${baseline.model_name}).

Usage:${pipCommand ? `
    ${pipCommand}` : ''}
    python main.py [--data-dir ./data]

The script downloads the prepared split, reruns the exact pipeline, and
exits 0 only if the predictions hash matches the published record.
"""
import argparse
import hashlib
import html
import json
import re
import urllib.request
from pathlib import Path

API_BASE = ${py(base)}
RELEASE_ID = ${py(releaseId)}
TARGET = ${py(target)}
SEED = ${py(seed)}
PARAMS = ${py(params)}
ALL_COLUMNS = ${py(allColumns)}
FEATURES = ${py(featuresOrHeuristic)}
EXPECTED_LIBS = ${py(libs)}
EXPECTED_VALIDATION = ${py(validationMetrics)}
EXPECTED = {
    "metric": ${py(metric)},
    "value": ${py(expectedValue)},
    "correct": ${py(baseline.correct)},
    "samples": ${py(baseline.sample_count)},
    "predictions_sha256": ${py(String(baseline.predictions_sha256 || ''))},
}
FILES = ${py(byRole)}


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve(url):
    """Follow HTTP redirects and HTML meta-refresh download pages to the file."""
    with urllib.request.urlopen(url) as response:
        if response.geturl() != url:
            return response.geturl()
        body = response.read(4096).decode("utf-8", "replace")
    match = re.search(r"url=([^\\"']+)", body)
    if match:
        return html.unescape(match.group(1))
    return url


def ensure_file(url, dest, sha256, expected_bytes):
    if dest.exists():
        if expected_bytes and dest.stat().st_size == expected_bytes and sha256_file(dest) == sha256:
            print(f"reuse {dest.name} (checksum ok)")
            return
    print(f"download {dest.name} ...")
    urllib.request.urlretrieve(resolve(url), dest)
    actual = sha256_file(dest)
    if actual != sha256:
        raise SystemExit(f"checksum mismatch for {dest.name}: {actual} != {sha256}")
    print(f"verified {dest.name}")


def check_versions():
    # Only the packages this script imports can change the result; the rest
    # of the recorded environment is informational.
    import sys
    wanted = {
        "pandas": ("pandas", None),
        "sklearn": ("scikit-learn", None),
        "numpy": ("numpy", None),
        "scipy": ("scipy", None),
    }
    problems = []
    if EXPECTED_LIBS.get("python"):
        running = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        if running != EXPECTED_LIBS["python"]:
            problems.append(f"python {running} != {EXPECTED_LIBS['python']} (predictions may differ)")
    for module_name, (dist_name, _) in wanted.items():
        expected = EXPECTED_LIBS.get(module_name)
        if not expected:
            continue
        installed = None
        try:
            from importlib import metadata
            installed = metadata.version(dist_name)
        except Exception:
            try:
                import importlib
                installed = importlib.import_module(module_name).__version__
            except Exception:
                installed = None
        if installed is None:
            problems.append(f"{module_name} is not installed (expected {expected})")
        elif str(installed) != str(expected):
            problems.append(f"{module_name} {installed} != {expected} (predictions may differ)")
    if problems:
        print("WARNING: environment differs from the published run:")
        for problem in problems:
            print(f"  - {problem}")
        print("The predictions hash at the end is the arbiter.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="./data")
    args = parser.parse_args()
    data = Path(args.data_dir)
    data.mkdir(parents=True, exist_ok=True)

    check_versions()
    local = {}
    for role, info in FILES.items():
        dest = data / f"{role}.csv"
        ensure_file(API_BASE + info["path"], dest, info["sha256"], info["bytes"])
        local[role] = dest

    import pandas as pd
    from sklearn.experimental import enable_iterative_imputer  # noqa: F401
    from sklearn.impute import IterativeImputer
    from sklearn.preprocessing import LabelEncoder, StandardScaler

    train = pd.read_csv(local["train"], dtype={"sample_id": str})
    valid = pd.read_csv(local["validation"], dtype={"sample_id": str})
    test = pd.read_csv(local["test_features"], dtype={"sample_id": str})

    feature_set = FEATURES
    if feature_set == "auto":
        # ${columnNote}
        feature_set = [c for c in train.columns if c not in ("sample_id", TARGET)]
    column_set = ALL_COLUMNS if ALL_COLUMNS else feature_set

    enc = LabelEncoder()
    y_train = enc.fit_transform(train[TARGET])
    y_valid = enc.transform(valid[TARGET])

    imp = IterativeImputer(max_iter=10, random_state=SEED, skip_complete=True, keep_empty_features=True)
    x_train = imp.fit_transform(train[column_set].to_numpy(dtype="float64"))
    x_valid = imp.transform(valid[column_set].to_numpy(dtype="float64"))
    x_test = imp.transform(test[column_set].to_numpy(dtype="float64"))

    scaler = StandardScaler()
    x_train = scaler.fit_transform(x_train)
    x_valid = scaler.transform(x_valid)
    x_test = scaler.transform(x_test)

    cols = [list(column_set).index(c) for c in feature_set]
${modelSection}
    model.fit(x_train[:, cols], y_train)
    validation = float(model.score(x_valid[:, cols], y_valid))
    primary_metric = next(iter(EXPECTED_VALIDATION), None)
    print(f"validation ${metricLabel}: {validation}")
    if primary_metric is not None:
        expected_primary = EXPECTED_VALIDATION[primary_metric]
        if abs(validation - expected_primary) > 1e-12:
            print(f"WARNING: validation {primary_metric} {validation} != {expected_primary}; "
                  "the pipeline differs — predictions are unlikely to match.")
        else:
            print(f"validation matches the published run ({primary_metric} {expected_primary}).")
    for key, expected in EXPECTED_VALIDATION.items():
        if key != primary_metric:
            print(f"  reference {key}: {expected}")

    pred = enc.inverse_transform(model.predict(x_test[:, cols]))
    out = Path("test_predictions.csv")
    pd.DataFrame({"sample_id": test["sample_id"], "prediction": pred}).to_csv(out, index=False)
    actual = sha256_file(out)
    print(f"wrote {out} ({len(pred)} rows)")
    print(f"predictions sha256: {actual}")
    if actual != EXPECTED["predictions_sha256"]:
        raise SystemExit(
            f"MISMATCH: {actual} != {EXPECTED['predictions_sha256']} — "
            "the result did not reproduce (check library versions above).")
    print(f"SUCCESS: reproduced {EXPECTED['metric']} {EXPECTED['value']} "
          f"({EXPECTED['correct']}/{EXPECTED['samples']}). "
          "Upload test_predictions.csv on the dataset page to score it.")


if __name__ == "__main__":
    main()
`;
}
