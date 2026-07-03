"""GNN v2: milder class weighting + macro-F1 model selection, on the
saved 50k dataset. Also:

  * GBDT with the same sqrt weighting (apples-to-apples operating point);
  * a CHEAT-feature ceiling: GBDT given the true lost electron energy
    (te_true - e_detected), quantifying how much of the
    CLEAN vs {BS_LOST, BREMS, DEAD_LAYER} confusion is irreducible at
    trigger level (those classes differ only through invisible energy).

Writes reports/experiment_v2.md, saves data/gnn_v2.pt.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sklearn.ensemble import HistGradientBoostingClassifier

from nab_ml.eval import (
    classification_report_md,
    confusion,
    confusion_md,
    per_class_metrics,
    residual_report,
)
from nab_ml.features import FEATURE_NAMES, event_features
from nab_ml.models.gnn import NabGNN, dataset_to_tensors
from nab_ml.recon import residuals, run_tcoinc
from nab_ml.taxonomy import CLASSES
from nab_ml.toysim import load_dataset
from nab_ml.train import TrainConfig, predict, train_gnn

ROOT = Path(__file__).resolve().parents[1]


def split_idx(n, seed=0):
    rng = np.random.default_rng(seed)
    idx = rng.permutation(n)
    n_tr, n_va = int(0.7 * n), int(0.15 * n)
    return idx[:n_tr], idx[n_tr : n_tr + n_va], idx[n_tr + n_va :]


def acc_f1(y_true, y_pred):
    m = per_class_metrics(confusion(y_true, y_pred, len(CLASSES)))
    return m["accuracy"], m["macro_f1"]


def sqrt_weight_gbdt(y_train, seed=0):
    counts = np.bincount(y_train, minlength=len(CLASSES)).astype(float)
    counts[counts == 0] = 1.0
    w = (counts.sum() / (len(CLASSES) * counts)) ** 0.5
    w /= w.mean()
    return HistGradientBoostingClassifier(
        max_iter=400, learning_rate=0.08, max_leaf_nodes=63,
        l2_regularization=1e-3, random_state=seed, early_stopping=True,
        class_weight={i: w[i] for i in range(len(CLASSES))},
    )


def main(epochs=30):
    t0 = time.time()
    ds = load_dataset(str(ROOT / "data" / "toy_v1.npz"))
    rec = run_tcoinc(ds)
    res = residuals(ds, rec)
    itr, iva, ite = split_idx(ds.n_events)
    y = ds.event_class

    report = ["# Experiment v2 — weighting fix + ceiling study", ""]
    rows = []

    print("features + GBDT variants ...")
    X = event_features(ds)

    gb = sqrt_weight_gbdt(y[itr])
    gb.fit(X[itr], y[itr])
    a, f = acc_f1(y[ite], gb.predict(X[ite]))
    rows.append(("GBDT sqrt-weights", a, f))
    report.append(classification_report_md(y[ite], gb.predict(X[ite]),
                                           "GBDT (sqrt class weights)"))

    # CHEAT ceiling: add true lost energy as a feature
    lost = (ds.te_true - ds.e_detected).reshape(-1, 1)
    Xc = np.hstack([X, lost])
    gbc = sqrt_weight_gbdt(y[itr])
    gbc.fit(Xc[itr], y[itr])
    a_c, f_c = acc_f1(y[ite], gbc.predict(Xc[ite]))
    rows.append(("GBDT + true-lost-energy CHEAT", a_c, f_c))
    report.append(classification_report_md(y[ite], gbc.predict(Xc[ite]),
                                           "GBDT + true lost energy (ceiling)"))

    print("GNN v2 ...")
    tensors = dataset_to_tensors(ds, res)
    t_tr = {k: v[itr] for k, v in tensors.items()}
    t_va = {k: v[iva] for k, v in tensors.items()}
    t_te = {k: v[ite] for k, v in tensors.items()}

    model = NabGNN(dim=96, n_layers=3)
    cfg = TrainConfig(epochs=epochs, batch_size=256, lr=2e-3,
                      weight_power=0.5, weight_clamp=10.0,
                      select_by="macro_f1", patience=8)
    model, hist = train_gnn(model, t_tr, t_va, cfg, verbose=True)
    torch.save(model.state_dict(), ROOT / "data" / "gnn_v2.pt")

    out = predict(model, t_te)
    yp = out["event_logits"].argmax(-1).numpy()
    a, f = acc_f1(y[ite], yp)
    rows.append(("NabGNN v2", a, f))
    report.append(classification_report_md(y[ite], yp, "NabGNN v2"))
    report.append("#### GNN v2 confusion matrix (test)")
    report.append(confusion_md(y[ite], yp))

    node_pred = out["node_logits"].argmax(-1).numpy()
    node_true = t_te["y_node"].numpy()
    m = node_true >= 0
    report.append(
        f"per-trigger accuracy: **{(node_pred[m] == node_true[m]).mean():.4f}**\n"
    )
    res_pred = out["res_pred"].numpy()
    res_true = t_te["y_res"].numpy()
    rmask = t_te["res_mask"].numpy().astype(bool)
    report.append("### Residual regression (test)")
    report.append(residual_report(res_pred[:, 0] * 100, res_true[:, 0] * 100,
                                  rmask, "d_eEng (keV)"))
    report.append(residual_report(res_pred[:, 1] * 5, res_true[:, 1] * 5,
                                  rmask, "d_tof (us)"))

    summary = "\n".join(
        ["| model | accuracy | macro-F1 |", "|---|---|---|"]
        + [f"| {r[0]} | {r[1]:.4f} | {r[2]:.4f} |" for r in rows]
        + ["", "v1 reference: MLP 0.9040/0.6757, GBDT-balanced 0.6859/0.6942, "
           "GNN-v1 0.5271/0.6712", ""]
    )
    report.insert(2, summary)
    report.append(f"\n_wall time: {time.time() - t0:.0f}s_\n")
    (ROOT / "reports" / "experiment_v2.md").write_text("\n".join(report))
    print("\n".join(f"  {r[0]:>32}: acc {r[1]:.4f}  mF1 {r[2]:.4f}" for r in rows))


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 30)
