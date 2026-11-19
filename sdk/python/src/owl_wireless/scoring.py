"""Server-side scoring on hidden labels.

Same protocol as the website's "Verify predictions" panel (``app.js``), but authenticated
with an evaluation API token instead of the browser's Turnstile challenge:

1. ``POST /evaluations/uploads`` (Vercel Blob client-token request) with ``Authorization: Bearer $OWL_TOKEN``;
   the server issues a ten-minute token for one private pathname.
2. ``PUT`` the predictions to Vercel Blob with that token.
3. ``POST /evaluations`` to start the scorer, then poll ``status_endpoint``.

Only ``sample_id,prediction`` is uploaded. Labels never leave the server, and the result
is private: it is returned to the caller and not written to disk.
"""
from __future__ import annotations

import gzip
import io
import json
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Union

import pandas as pd

from . import _cache, _http
from .datasets import _resolve, _catalog, ReleaseInfo
from .errors import AuthenticationRequired, NotFound, OWLError, ScoringError, ServiceError

BLOB_API = "https://vercel.com/api/blob/"


@dataclass(frozen=True)
class ScoreResult:
    release_id: str
    metric: str
    value: float
    correct: Optional[int]
    sample_count: Optional[int]
    labels_sha256: Optional[str]
    predictions_sha256: Optional[str]
    scorer_version: Optional[str]
    evaluation_id: str
    public: bool
    note: Optional[str]


def _token(token: Optional[str]) -> str:
    value = token or os.environ.get("OWL_TOKEN", "").strip()
    if not value:
        raise AuthenticationRequired(
            "Scoring needs an evaluation token. Set OWL_TOKEN (or pass token=...). "
            "Tokens are issued by the OWL maintainers; the website uses a captcha instead."
        )
    return value


def _payload(predictions: Union[str, Path, pd.DataFrame]) -> "tuple[bytes, bool]":
    """Return (bytes, gzipped) for a CSV path or a DataFrame with sample_id,prediction."""
    if isinstance(predictions, pd.DataFrame):
        if list(predictions.columns) != ["sample_id", "prediction"]:
            raise ValueError("predictions DataFrame must have exactly the columns sample_id, prediction")
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
            gz.write(predictions.to_csv(index=False).encode("utf-8"))
        return buf.getvalue(), True
    path = Path(predictions)
    name = path.name.lower()
    if not (name.endswith(".csv") or name.endswith(".csv.gz")):
        raise ValueError("predictions must be a .csv or .csv.gz file, or a DataFrame")
    return path.read_bytes(), name.endswith(".gz")


def _check_ids(data: bytes, gzipped: bool, release: ReleaseInfo) -> None:
    """Fail early when row count or sample_id order is wrong (the server checks this too)."""
    frame = pd.read_csv(io.BytesIO(gzip.decompress(data) if gzipped else data), dtype=str)
    if list(frame.columns) != ["sample_id", "prediction"]:
        raise ScoringError("prediction CSV must have exactly the header sample_id,prediction", "bad_header")
    expected = release.counts.get("test")
    if expected is not None and len(frame) != expected:
        raise ScoringError(f"expected {expected} prediction rows, got {len(frame)}", "row_count")
    root = _cache.cache_dir() / "releases" / release.id
    test = release.file("test_features")
    if test is not None:
        cached = root / Path(*test.logical_path.split("/"))
        usable = cached.suffix in (".csv", ".gz") and _cache.is_verified(cached, test.sha256)
    else:  # provider-only release built locally with load(source_dir=...)
        cached = root / "built" / "test-features.csv"
        usable = cached.is_file()
    if usable:
        ids = pd.read_csv(cached, usecols=["sample_id"], dtype=str)["sample_id"]
        bad = (ids.to_numpy() != frame["sample_id"].to_numpy()).nonzero()[0]
        if len(bad):
            raise ScoringError(
                f"sample_id at row {bad[0] + 1} does not match the test file order", "order", int(bad[0]) + 2)


def _api_url(path: str) -> str:
    if path.startswith("/api/v1"):
        path = path[len("/api/v1"):]
    return _http.api_base() + (path if path.startswith("/") else "/" + path)


def _json(resp: Any, what: str) -> Dict[str, Any]:
    if resp.status_code in (401, 403):
        raise AuthenticationRequired(f"{what}: the evaluation token was rejected (HTTP {resp.status_code})")
    if not resp.ok:
        raise ServiceError(f"{what} failed with HTTP {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def score(
    predictions: Union[str, Path, pd.DataFrame],
    dataset: str,
    version: Optional[str] = None,
    token: Optional[str] = None,
    timeout: float = 30 * 60,
    poll_interval: float = 2.0,
) -> ScoreResult:
    """Score ``sample_id,prediction`` rows against the hidden test labels. The result is private."""
    credential = _token(token)
    info = _resolve(dataset, _catalog())
    releases = [r for r in info.releases if version in (None, r.id, r.version)]
    if not releases:
        raise NotFound(f"{info.title} has no OWL release" + (f" {version!r}" if version else ""))
    release = releases[-1]
    if not release.scoring_available:
        raise ScoringError(f"release {release.id} has no hidden-label evaluator", "evaluation_unavailable")

    data, gzipped = _payload(predictions)
    _check_ids(data, gzipped, release)
    pathname = f"evaluations/{release.id}/{uuid.uuid4()}/predictions.csv" + (".gz" if gzipped else "")
    s = _http.session()
    auth = {"Authorization": f"Bearer {credential}", "Accept": "application/json"}

    token_body = _json(s.post(f"{_http.api_base()}/evaluations/uploads", headers=auth, timeout=_http.TIMEOUT, json={
        "type": "blob.generate-client-token",
        "payload": {"pathname": pathname, "multipart": False,
                    "clientPayload": json.dumps({"release_id": release.id})},
    }), "upload authorization")
    client_token = str(token_body.get("clientToken") or "")
    parts = client_token.split("_")
    if not client_token.startswith("vercel_blob_client_") or len(parts) < 4 or not parts[3]:
        raise ServiceError("the upload service returned an invalid client token")
    store_id = parts[3]

    put = s.put(BLOB_API, params={"pathname": pathname}, data=data, timeout=(10, 600), headers={
        "authorization": f"Bearer {client_token}",
        "x-api-blob-request-id": f"{store_id}:{int(time.time() * 1000)}:{uuid.uuid4()}",
        "x-vercel-blob-store-id": store_id,
        "x-api-blob-request-attempt": "0",
        "x-api-version": "12",
        "x-content-length": str(len(data)),
        "x-vercel-blob-access": "private",
        "x-content-type": "application/gzip" if gzipped else "text/csv",
    })
    if not put.ok:
        raise ServiceError(f"private prediction upload failed with HTTP {put.status_code}")
    if put.json().get("pathname") != pathname:
        raise ServiceError("the upload service returned a mismatched pathname")

    accepted = _json(s.post(f"{_http.api_base()}/evaluations", headers=auth, timeout=_http.TIMEOUT, json={
        "release_id": release.id, "prediction": {"pathname": pathname, "size": len(data)},
    }), "starting the evaluation")
    status_url = _api_url(accepted["status_endpoint"])
    evaluation_id = accepted.get("evaluation_id", "")

    deadline = time.monotonic() + timeout
    while True:
        payload = _json(s.get(status_url, headers=auth, timeout=_http.TIMEOUT), "evaluation status")
        if payload.get("status") == "completed":
            result = payload.get("result") or {}
            break
        if payload.get("status") == "failed":
            err = payload.get("error") or {}
            raise ScoringError(err.get("message", "the evaluator failed"), err.get("code"))
        if time.monotonic() > deadline:
            raise OWLError(f"evaluation {evaluation_id} is still running after {timeout:.0f}s; "
                           f"poll {status_url} with the same token")
        time.sleep(poll_interval)

    if result.get("status") != "completed":
        err = result.get("error") or {}
        raise ScoringError(err.get("message", f"evaluation {result.get('status')}"), err.get("code"),
                           err.get("row_number"))
    metric = result.get("metric") or {}
    publication = result.get("publication") or {}
    return ScoreResult(
        release_id=result.get("release_id", release.id), metric=metric.get("name"), value=metric.get("value"),
        correct=metric.get("correct"), sample_count=metric.get("sample_count"),
        labels_sha256=result.get("labels_sha256"), predictions_sha256=result.get("predictions_sha256"),
        scorer_version=result.get("scorer_version"), evaluation_id=evaluation_id,
        public=bool(publication.get("public", False)), note=publication.get("note"),
    )
