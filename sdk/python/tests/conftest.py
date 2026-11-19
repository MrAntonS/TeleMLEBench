"""Offline test harness: a requests transport that replays recorded responses.

JSON fixtures in ``fixtures/`` were recorded from the live endpoints by ``record_fixtures.py``.
Release data files are synthetic (a few rows) and their checksums are patched into the recorded
release registry and manifest, so download / verification code runs exactly as in production.
"""
from __future__ import annotations

import copy
import hashlib
import io
import json
import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import pytest
import requests
from requests.adapters import BaseAdapter

from owl_wireless import _http

FIX = Path(__file__).parent / "fixtures"
API = "https://api.owl.test/api/v1"
SITE = "https://site.owl.test"
SUPA = "https://supa.owl.test"
HF = "https://hf.owl.test"
RELEASE = "ujindoorloc-floor-v1"


def load(name: str) -> Any:
    return json.loads((FIX / name).read_text())


TRAIN = "sample_id,WAP001,WAP002,FLOOR\n" + "".join(
    f"tr{i},{-40 - i},{100 if i % 3 else -70},{i % 4}\n" for i in range(20))
VALID = "sample_id,WAP001,WAP002,FLOOR\n" + "".join(
    f"va{i},{-45 - i},{-60 - i},{i % 4}\n" for i in range(8))
TEST_IDS = [f"te{i}" for i in range(5)]
TEST = "sample_id,WAP001,WAP002\n" + "".join(f"{s},{-50 - i},{-65}\n" for i, s in enumerate(TEST_IDS))
FILES = {"train": ("data/train.csv", TRAIN), "validation": ("data/validation.csv", VALID),
         "test_features": ("data/test-features.csv", TEST)}


# db/catalog/2026-11-19-redistribution-status.sql, applied to the recorded catalog.
CATALOG_PATCH = {
    "dsv_a130fc2ac4a437717b45eb35": ("CC-BY-4.0", "allowed", "https://veremi-dataset.github.io/veremi/"),
    "dsv_b4b70c9e0abb5c1c91dc310f": ("CC-BY-4.0", "allowed", "https://veremi-dataset.github.io/veremi-extension/"),
    "dsv_2b4b6c2f2f46033eaebd4f5e": ("CC-BY-4.0", "allowed", "https://doi.org/10.5281/zenodo.13921775"),
    "dsv_ebcdc40ddf743d67343b2440": ("CC-BY-NC-SA-4.0", "allowed", "https://www.deepsig.ai/datasets/"),
    "dsv_23647609e257911ae43693c0": ("No license stated (UNB CIC terms)", "not_allowed",
                                     "https://www.unb.ca/cic/datasets/ids-2017.html"),
    "dsv_a19618cffe36f58e6bb774fe": ("No license stated (UNB CIC terms)", "not_allowed",
                                     "https://www.unb.ca/cic/datasets/iotdataset-2023.html"),
}


def catalog(after_sql: bool) -> List[Dict[str, Any]]:
    rows = load("tmlb_datasets.json")
    if after_sql:
        for row in rows:
            for v in row["tmlb_dataset_versions"]:
                if v["id"] in CATALOG_PATCH:
                    v["license_name"], v["redistribution_status"], v["license_source_url"] = CATALOG_PATCH[v["id"]]
    return rows


# A synthetic provider-only release shaped like CICIDS2017: two provider CSVs with padded,
# duplicated headers and float cells, a split definition, and the task file.
CIC = "cicids2017-flow-classification-v1"
PROVIDER_FILES = {
    "Monday-WorkingHours.pcap_ISCX.csv":
        " Destination Port, Flow Bytes/s, Fwd Header Length, Fwd Header Length, Label\n"
        "80,4000000.0,20,20,BENIGN\n443,666666.6667,32,32,BENIGN\n\n22,1.5e-7,40,40,BENIGN\n",
    "Friday-WorkingHours-Afternoon-DDos.pcap_ISCX.csv":
        " Destination Port, Flow Bytes/s, Fwd Header Length, Fwd Header Length, Label\n"
        "80,Infinity,20,24,DDoS\n8080,6.0,20,20,BENIGN\n",
}
CIC_ASSIGN = [  # sample_id, split, file, row
    ("c1", "train", "Monday-WorkingHours.pcap_ISCX.csv", 1),
    ("c2", "val", "Monday-WorkingHours.pcap_ISCX.csv", 2),
    ("c3", "train", "Monday-WorkingHours.pcap_ISCX.csv", 3),
    ("c4", "test", "Friday-WorkingHours-Afternoon-DDos.pcap_ISCX.csv", 1),
    ("c5", "test", "Friday-WorkingHours-Afternoon-DDos.pcap_ISCX.csv", 2),
]
CIC_EXPECTED = {
    "train": "sample_id,Destination Port,Flow Bytes/s,Fwd Header Length__2,Label\nc1,80,4000000,20,BENIGN\n"
             "c3,22,1.5e-7,40,BENIGN\n",
    "validation": "sample_id,Destination Port,Flow Bytes/s,Fwd Header Length__2,Label\nc2,443,666666.6667,32,BENIGN\n",
    "test_features": "sample_id,Destination Port,Flow Bytes/s,Fwd Header Length__2\nc4,80,Infinity,24\nc5,8080,6,20\n",
}


def cic_task() -> Dict[str, Any]:
    sha = lambda t: hashlib.sha256(t.encode()).hexdigest()  # noqa: E731
    return {
        "schema_version": "owl-task/1", "release_id": CIC, "distribution": "provider_only",
        "target_fields": ["Label"], "feature_fields": ["Destination Port", "Flow Bytes/s", "Fwd Header Length__2"],
        "metric": "accuracy", "counts": {"train": 2, "validation": 1, "test": 2},
        "source": {"format": "csv_directory", "provider_url": "https://www.unb.ca/cic/datasets/ids-2017.html",
                   "files": [{"name": n, "sha256": sha(t), "byte_size": len(t.encode())}
                             for n, t in PROVIDER_FILES.items()],
                   "members": list(PROVIDER_FILES)},
        "reference_outputs": {r: {"sha256": sha(t), "byte_size": len(t.encode())} for r, t in CIC_EXPECTED.items()},
    }


class Fake(BaseAdapter):
    def __init__(self) -> None:
        super().__init__()
        self.routes: List[Tuple[str, "re.Pattern[str]", Callable[..., Any]]] = []
        self.calls: List[requests.PreparedRequest] = []

    def route(self, method: str, pattern: str, handler: Callable[..., Any]) -> None:
        self.routes.insert(0, (method, re.compile(pattern), handler))

    def count(self, pattern: str) -> int:
        return sum(1 for c in self.calls if re.search(pattern, c.url))

    def send(self, request: requests.PreparedRequest, **kwargs: Any) -> requests.Response:
        self.calls.append(request)
        url = request.url.split("?")[0]
        for method, pattern, handler in self.routes:
            if method == request.method and pattern.fullmatch(url):
                out = handler(request)
                break
        else:
            out = (404, {"error": f"no fixture for {request.method} {request.url}"})
        status, body, headers = (out + ({},))[:3] if isinstance(out, tuple) else (200, out, {})
        resp = requests.Response()
        resp.status_code = status
        resp.url = request.url
        resp.request = request
        resp.headers.update(headers)
        data = body if isinstance(body, bytes) else body.encode() if isinstance(body, str) else json.dumps(body).encode()
        resp.raw = io.BytesIO(data)
        return resp

    def close(self) -> None:
        pass


def query(request: requests.PreparedRequest) -> Dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlparse(request.url).query).items()}


@pytest.fixture
def fake(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Fake:
    monkeypatch.setenv("OWL_API", API)
    monkeypatch.setenv("OWL_SITE", SITE)
    monkeypatch.setenv("OWL_SUPABASE_URL", SUPA)
    monkeypatch.setenv("OWL_CACHE", str(tmp_path / "cache"))
    monkeypatch.delenv("OWL_TOKEN", raising=False)
    adapter = Fake()
    s = requests.Session()
    s.mount("https://", adapter)
    _http.set_session(s)

    files = {role: (path, text.encode()) for role, (path, text) in FILES.items()}
    sha = {role: hashlib.sha256(b).hexdigest() for role, (_, b) in files.items()}

    def patch(release: Dict[str, Any]) -> Dict[str, Any]:
        release = copy.deepcopy(release)
        for f in release["files"]:
            if f["role"] in files:
                f["sha256"] = sha[f["role"]]
                f["byte_size"] = len(files[f["role"]][1])
        release["split"]["counts"]["test"] = len(TEST_IDS)
        release["evaluation"]["expected_rows"] = len(TEST_IDS)
        return release

    releases = load("releases.json")
    releases["items"] = [patch(r) if r["id"] == RELEASE else r for r in releases["items"]]
    adapter.releases = releases  # type: ignore[attr-defined]
    adapter.served = dict(files)  # type: ignore[attr-defined]

    # Any release manifest (registered first so the specific routes below take precedence).
    adapter.route("GET", f"{API}/releases/[^/]+/manifest",
                  lambda r: next((x for x in releases["items"] if x["id"] == r.url.split("/")[-2]), (404, {})))

    # Provider-only CICIDS2017: replace the split-definition files with the synthetic ones.
    cic_assign = ("sample_id,split,source_file,source_row\n" +
                  "".join(f"{a},{b},{c},{d}\n" for a, b, c, d in CIC_ASSIGN)).encode()
    cic_task_text = (json.dumps(cic_task(), indent=2) + "\n").encode()
    cic_bodies = {"split_assignment": ("assignments.csv", cic_assign), "task": ("task.json", cic_task_text)}

    def patch_cic(release: Dict[str, Any]) -> Dict[str, Any]:
        release = copy.deepcopy(release)
        for f in release["files"]:
            if f["role"] in cic_bodies:
                f["sha256"] = hashlib.sha256(cic_bodies[f["role"]][1]).hexdigest()
                f["byte_size"] = len(cic_bodies[f["role"]][1])
        release["split"]["counts"].update({"train": 2, "validation": 1, "test": 2})
        release["evaluation"]["expected_rows"] = 2
        return release

    releases["items"] = [patch_cic(r) if r["id"] == CIC else r for r in releases["items"]]
    adapter.route("GET", f"{API}/releases/{CIC}/manifest",
                  lambda r: next(x for x in releases["items"] if x["id"] == CIC))

    def cic_file(r: requests.PreparedRequest) -> Any:
        role = r.url.rsplit("/", 1)[1]
        if role in ("train", "validation", "test_features"):
            return 410, {"statusMessage": "OWL does not redistribute this dataset"}
        if role == "split_assignment":
            return 307, b"", {"Location": f"{HF}/{CIC}/assignments.csv"}
        if role == "task":
            return 200, cic_task_text
        return 404, {}

    adapter.route("GET", f"{API}/releases/{CIC}/files/[a-z_]+", cic_file)
    adapter.after_sql = True  # type: ignore[attr-defined]

    adapter.route("GET", f"{API}/releases", lambda r: releases)
    adapter.route("GET", f"{API}/releases/{RELEASE}/manifest", lambda r: patch(load("manifest_ujindoorloc.json")))

    def file_redirect(r: requests.PreparedRequest) -> Any:
        role = r.url.rsplit("/", 1)[1]
        if role not in adapter.served:  # type: ignore[attr-defined]
            return 404, {"error": "role"}
        path = adapter.served[role][0]  # type: ignore[attr-defined]
        return 307, b"", {"Location": f"{HF}/{RELEASE}/{path}", "X-TeleMLEBench-SHA256": sha[role]}

    adapter.route("GET", f"{API}/releases/{RELEASE}/files/[a-z_]+", file_redirect)

    def hf(r: requests.PreparedRequest) -> Any:
        if r.url == f"{HF}/{CIC}/assignments.csv":
            return 200, cic_assign
        if not r.url.startswith(f"{HF}/{RELEASE}/"):
            return 404, b""
        path = r.url.split(f"{HF}/{RELEASE}/", 1)[1]
        for _, (p, body) in adapter.served.items():  # type: ignore[attr-defined]
            if p == path:
                return 200, body
        return 404, b""

    adapter.route("GET", f"{HF}/.+", hf)

    def supabase(r: requests.PreparedRequest) -> Any:
        assert r.headers.get("apikey"), "catalog requests must carry the publishable key"
        table = urlparse(r.url).path.rsplit("/", 1)[1]
        q = query(r)
        if table == "tmlb_datasets":
            return catalog(adapter.after_sql)  # type: ignore[attr-defined]
        if table == "tmlb_dataset_versions":
            return load("tmlb_dataset_versions_uji.json") if q.get("dataset_id") == "eq.10.24432/c5ms59" else []
        if table == "tmlb_dataset_paper_usage":
            return load("tmlb_dataset_paper_usage_uji.json") if q.get("offset") == "0" else []
        if table == "tmlb_papers":
            return load("tmlb_papers_1711.02824.json") if q.get("arxiv_id") == "eq.1711.02824" else []
        return 404, {"message": "relation does not exist"}

    adapter.route("GET", f"{SUPA}/rest/v1/[a-z_]+", supabase)
    adapter.route("GET", f"{SITE}/data/owl/papers.json", lambda r: load("papers.json"))
    adapter.route("GET", f"{SITE}/data/owl/artifacts/P62/[^/]+",
                  lambda r: (200, (FIX / "artifacts" / "P62" / r.url.rsplit("/", 1)[1]).read_bytes()))
    yield adapter
    _http.set_session(None)


def served_text(role: str) -> str:
    return FILES[role][1]


def latest_body(fake: Fake, pattern: str, method: Optional[str] = None) -> Any:
    for c in reversed(fake.calls):
        if re.search(pattern, c.url) and (method is None or c.method == method):
            return c
    raise AssertionError(f"no call matching {pattern}")
