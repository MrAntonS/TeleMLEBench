import numpy as np

from nab_ml.impact import (
    bias_summary,
    impact_report_md,
    ml_correction_scenario,
    ml_veto_scenario,
    per_class_bias_table,
)
from nab_ml.taxonomy import CLASS_TO_IDX, N_CLASSES


def _fake(n=5000, seed=0):
    rng = np.random.default_rng(seed)
    cls = rng.integers(0, N_CLASSES, n)
    clean = cls == CLASS_TO_IDX["CLEAN_COINC"]
    # clean events unbiased; lossy classes biased low in energy
    d_eeng = rng.normal(0, 2, n) + np.where(clean, 0.0, -25.0)
    d_tof = rng.normal(0, 0.05, n) + np.where(clean, 0.0, 0.4)
    selected = rng.random(n) > 0.2
    # a good classifier: P(clean) high for clean events
    p_clean = np.clip(np.where(clean, 0.9, 0.1) + rng.normal(0, 0.1, n), 0, 1)
    return cls, d_eeng, d_tof, selected, p_clean


def test_bias_table_and_summary():
    cls, de, dt, sel, _ = _fake()
    rows = per_class_bias_table(cls, de, dt, sel)
    assert len(rows) == N_CLASSES
    total = bias_summary(de, dt, sel)
    # contributions must add up to the total bias
    contrib = sum(r.get("contrib_de", 0.0) for r in rows)
    assert abs(contrib - total["bias_de"]) < 1e-9


def test_veto_reduces_bias():
    cls, de, dt, sel, p = _fake()
    pts = ml_veto_scenario(cls, p, de, dt, sel)
    loose, mid, tight = pts[0], pts[len(pts) // 2], pts[-1]
    assert abs(tight["bias_de"]) < abs(loose["bias_de"])
    assert tight["purity"] > loose["purity"]
    # a good classifier keeps most clean events at a moderate threshold
    assert mid["efficiency"] > 0.9


def test_correction_reduces_rms():
    cls, de, dt, sel, _ = _fake()
    # a perfect residual predictor for non-clean events
    pred_de = np.where(cls == CLASS_TO_IDX["CLEAN_COINC"], 0.0, -25.0)
    pred_dt = np.where(cls == CLASS_TO_IDX["CLEAN_COINC"], 0.0, 0.4)
    out = ml_correction_scenario(de, dt, pred_de, pred_dt, sel)
    assert out["after"]["rms_de"] < out["before"]["rms_de"]
    assert abs(out["after"]["bias_de"]) < abs(out["before"]["bias_de"])


def test_report_renders():
    cls, de, dt, sel, p = _fake()
    rows = per_class_bias_table(cls, de, dt, sel)
    veto = ml_veto_scenario(cls, p, de, dt, sel)
    corr = ml_correction_scenario(de, dt, np.zeros_like(de), np.zeros_like(dt), sel)
    md = impact_report_md(rows, veto, corr)
    assert "Systematic-impact" in md and "ML-veto" in md
