"""Baseline event classifiers on engineered features.

The bar the GNN must clear: a HistGradientBoosting classifier (sklearn's
LightGBM-alike; no extra dependency) and a small MLP, both trained on
the ttrigs-only engineered features from `nab_ml.features`.
"""

from __future__ import annotations

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline


def make_gbdt(seed: int = 0) -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        max_iter=400,
        learning_rate=0.08,
        max_depth=None,
        max_leaf_nodes=63,
        l2_regularization=1e-3,
        class_weight="balanced",
        random_state=seed,
        early_stopping=True,
        validation_fraction=0.1,
    )


def make_mlp(seed: int = 0) -> Pipeline:
    return Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "mlp",
                MLPClassifier(
                    hidden_layer_sizes=(128, 64),
                    alpha=1e-4,
                    max_iter=300,
                    early_stopping=True,
                    random_state=seed,
                ),
            ),
        ]
    )


def rule_based_predict(feats: np.ndarray, feature_names: list[str]) -> np.ndarray:
    """A hand-written cut-based classifier mirroring how a physicist would
    triage events from trigger patterns alone.  Serves as the zeroth-order
    baseline (and a sanity check that the features carry signal)."""
    ix = {n: i for i, n in enumerate(feature_names)}
    n = feats.shape[0]
    pred = np.zeros(n, dtype=np.int64)  # CLEAN_COINC default

    n_trig = feats[:, ix["n_trig"]]
    n_sub30 = feats[:, ix["n_sub30_upper"]]
    dt_pe = feats[:, ix["dt_pe_best"]]
    n_lower = feats[:, ix["n_lower"]]
    n_upper = feats[:, ix["n_upper"]]
    e_second = feats[:, ix["e_second"]]
    ring_spread = feats[:, ix["ring_spread"]]
    t_span = feats[:, ix["t_span"]]

    from ..taxonomy import CLASS_TO_IDX as C

    # order matters: later assignments override earlier ones
    pred[(n_trig >= 3) & (e_second > 30)] = C["BS_SAME_DET"]
    pred[(n_trig >= 3) & (n_upper > 0) & (n_lower > 0) & (e_second > 30)] = C[
        "BS_OTHER_DET"
    ]
    pred[(n_sub30 == 0) & (n_trig >= 1)] = C["MISSED_PROTON"]
    pred[(n_sub30 >= 1) & (dt_pe < 0)] = C["MISSED_ELECTRON"]
    pred[(n_trig >= 4) & (t_span > 45)] = C["ACCIDENTAL"]
    pred[(n_trig >= 3) & (ring_spread > 5) & (t_span > 20)] = C["NOISE_CONTAM"]
    return pred
