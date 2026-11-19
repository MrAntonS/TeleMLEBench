import gzip
import io
import json
import re

import pandas as pd
import pytest

import owl_wireless as owl

from conftest import API, RELEASE, TEST_IDS, latest_body

STORE = "abc123"
COMPLETED = {
    "status": "completed", "release_id": RELEASE,
    "metric": {"name": "accuracy", "value": 0.8, "correct": 4, "sample_count": 5},
    "labels_sha256": "1" * 64, "predictions_sha256": "2" * 64,
    "scorer_version": "telemlebench-vercel-accuracy/1",
    "alignment": {"join_key": "sample_id", "mode": "strict_test_order"},
    "publication": {"public": False, "note": "This is a private server-verified score."},
}


@pytest.fixture
def evaluator(fake, monkeypatch):
    monkeypatch.setenv("OWL_TOKEN", "test-token")
    state = {"result": COMPLETED, "polls": 0}

    def uploads(r):
        body = json.loads(r.body)
        assert body["type"] == "blob.generate-client-token"
        state["pathname"] = body["payload"]["pathname"]
        return {"type": "blob.generate-client-token", "clientToken": f"vercel_blob_client_{STORE}_tok"}

    def put(r):
        state["uploaded"] = r.body
        return {"pathname": dict(re.findall(r"(pathname)=([^&]+)", r.url))["pathname"].replace("%2F", "/")}

    def start(r):
        body = json.loads(r.body)
        assert body["prediction"]["pathname"] == state["pathname"]
        return 202, {"evaluation_id": "run1.sig", "status": "queued",
                     "status_endpoint": "/api/v1/evaluations/run1.sig"}

    def status(r):
        state["polls"] += 1
        if state["polls"] < 2:
            return 202, {"evaluation_id": "run1.sig", "status": "running"}
        return {"evaluation_id": "run1.sig", "status": "completed", "result": state["result"]}

    fake.route("POST", f"{API}/evaluations/uploads", uploads)
    fake.route("PUT", r"https://vercel\.com/api/blob/", put)
    fake.route("POST", f"{API}/evaluations", start)
    fake.route("GET", f"{API}/evaluations/run1\\.sig", status)
    return state


def preds(ids=TEST_IDS):
    return pd.DataFrame({"sample_id": ids, "prediction": [0, 1, 2, 3, 0][: len(ids)]})


def test_requires_token(fake):
    with pytest.raises(owl.AuthenticationRequired, match="OWL_TOKEN"):
        owl.score(preds(), dataset="ujiindoorloc")


def test_score_flow_uploads_only_predictions(fake, evaluator):
    result = owl.score(preds(), dataset="ujiindoorloc", poll_interval=0)
    assert isinstance(result, owl.ScoreResult)
    assert (result.metric, result.value, result.correct, result.sample_count) == ("accuracy", 0.8, 4, 5)
    assert result.public is False and result.release_id == RELEASE
    assert re.fullmatch(rf"evaluations/{RELEASE}/[0-9a-f-]{{36}}/predictions\.csv\.gz", evaluator["pathname"])
    sent = pd.read_csv(io.BytesIO(gzip.decompress(evaluator["uploaded"])))
    assert list(sent.columns) == ["sample_id", "prediction"] and len(sent) == 5
    for c in fake.calls:
        if "/evaluations" in c.url:
            assert c.headers["Authorization"] == "Bearer test-token"
    put = latest_body(fake, r"vercel\.com", "PUT")
    assert put.headers["authorization"] == f"Bearer vercel_blob_client_{STORE}_tok"
    assert put.headers["x-vercel-blob-access"] == "private"
    # The private result is not written anywhere on disk.
    assert not list(owl._cache.cache_dir().rglob("*result*"))


def test_score_from_csv_path(fake, evaluator, tmp_path):
    path = tmp_path / "preds.csv"
    preds().to_csv(path, index=False)
    assert owl.score(path, dataset="ujiindoorloc", poll_interval=0).value == 0.8
    assert evaluator["pathname"].endswith("/predictions.csv")
    assert evaluator["uploaded"] == path.read_bytes()


def test_rejected_result_raises(fake, evaluator):
    evaluator["result"] = {"status": "rejected", "release_id": RELEASE,
                           "error": {"code": "sample_id_mismatch", "message": "row 3 id mismatch", "row_number": 3}}
    with pytest.raises(owl.ScoringError) as exc:
        owl.score(preds(), dataset="ujiindoorloc", poll_interval=0)
    assert exc.value.code == "sample_id_mismatch" and exc.value.row_number == 3


def test_wrong_row_count_fails_before_upload(fake, evaluator):
    with pytest.raises(owl.ScoringError, match="expected 5"):
        owl.score(preds(TEST_IDS[:3]), dataset="ujiindoorloc")
    assert fake.count(r"/evaluations") == 0


def test_order_checked_against_cached_test_file(fake, evaluator):
    owl.dataset("ujiindoorloc").load()
    with pytest.raises(owl.ScoringError, match="row 1"):
        owl.score(preds(list(reversed(TEST_IDS))), dataset="ujiindoorloc")
    assert fake.count(r"/evaluations") == 0


def test_rejected_token(fake, evaluator):
    fake.route("POST", f"{API}/evaluations/uploads", lambda r: (401, {"message": "bad key"}))
    with pytest.raises(owl.AuthenticationRequired, match="rejected"):
        owl.score(preds(), dataset="ujiindoorloc")
