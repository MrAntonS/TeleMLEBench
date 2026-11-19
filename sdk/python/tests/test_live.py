"""Live smoke test against the real OWL endpoints.

    OWL_LIVE=1 OWL_TOKEN=... pytest tests/test_live.py -s

Downloads the UJIIndoorLoc release (~45 MB, cached in OWL_CACHE or ~/.cache/owl), trains a
logistic-regression baseline, scores it on the hidden test labels, and fetches paper P62.
The scoring step is skipped when OWL_TOKEN is not set.
"""
import os

import pytest

pytestmark = pytest.mark.skipif(os.environ.get("OWL_LIVE") != "1", reason="set OWL_LIVE=1 to hit live endpoints")


@pytest.fixture(autouse=True)
def real_session():
    from owl_wireless import _http

    _http.set_session(None)
    yield


def test_live_smoke():
    import pandas as pd
    from sklearn.linear_model import LogisticRegression

    import owl_wireless as owl

    # 1. load the UJIIndoorLoc release (checksums verified against the manifest)
    split = owl.dataset("ujiindoorloc").load()
    assert split.target == "FLOOR" and split.metric == "accuracy"
    features = [c for c in split.test_inputs.columns if c != "sample_id"]

    def prep(frame):  # RSSI: 100 means "not detected"
        return frame[features].replace(100, -110).add(110).div(110)

    # 2. logistic-regression baseline
    model = LogisticRegression(max_iter=2000).fit(prep(split.train), split.train[split.target])
    val_acc = (model.predict(prep(split.val)) == split.val[split.target]).mean()
    print(f"validation accuracy {val_acc:.4f}")
    assert val_acc > 0.5

    # 3. score on hidden labels (private result)
    preds = pd.DataFrame({"sample_id": split.test_inputs["sample_id"],
                          "prediction": model.predict(prep(split.test_inputs))})
    if os.environ.get("OWL_TOKEN"):
        result = owl.score(preds, dataset="ujiindoorloc")
        print(f"hidden-label {result.metric} {result.value:.4f} ({result.correct}/{result.sample_count})")
        assert result.public is False and 0 <= result.value <= 1
    else:
        print("OWL_TOKEN not set: skipped server-side scoring")

    # 4. paper P62
    p = owl.paper("P62")
    assert p.claimed.value == 95.52
    assert p.baseline is not None and p.metadata["batch_size"].source == "assumed"
