"""End-to-end experiment: dataset -> stats memo -> baselines -> GNN -> report.

Usage:  python experiments/run_experiment.py [n_events] [epochs]
Writes markdown reports into reports/.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nab_ml.eval import (
    classification_report_md,
    confusion_md,
    per_class_metrics,
    confusion,
    residual_report,
)
from nab_ml.features import FEATURE_NAMES, event_features
from nab_ml.models.baseline import make_gbdt, make_mlp, rule_based_predict
from nab_ml.recon import residuals, run_tcoinc
from nab_ml.taxonomy import CLASSES, CLASS_TO_IDX
from nab_ml.toysim import NabToySimulator, SimConfig, save_dataset

REPORTS = Path(__file__).resolve().parents[1] / "reports"
DATA = Path(__file__).resolve().parents[1] / "data"


def split_idx(n: int, seed: int = 0):
    rng = np.random.default_rng(seed)
    idx = rng.permutation(n)
    n_tr, n_va = int(0.7 * n), int(0.15 * n)
    return idx[:n_tr], idx[n_tr : n_tr + n_va], idx[n_tr + n_va :]


def dataset_memo(ds, rec, res) -> str:
    n = ds.n_events
    frac = np.bincount(ds.event_class, minlength=len(CLASSES)) / n
    counts = np.bincount(ds.trig_event, minlength=n)
    lines = [
        "## Dataset statistics memo",
        "",
        f"- events: **{n:,}**, triggers: **{len(ds.trig_event):,}** "
        f"(mean {counts.mean():.2f}/event, max {counts.max()})",
        f"- tcoinc emulation: pFound {rec.p_found.mean() * 100:.1f}%, "
        f"eFound {rec.e_found.mean() * 100:.1f}%",
        "",
        "| class | fraction | mean |d_eEng| keV | mean d_eEng keV | mean |d_tof| us |",
        "|---|---|---|---|---|",
    ]
    for i, c in enumerate(CLASSES):
        m = (ds.event_class == i) & rec.e_found
        if m.sum() > 0:
            de = res["d_eEng"][m]
            dt = res["d_tof"][m]
            lines.append(
                f"| {c} | {frac[i] * 100:.2f}% | {np.nanmean(np.abs(de)):.1f} "
                f"| {np.nanmean(de):+.1f} | {np.nanmean(np.abs(dt)):.2f} |"
            )
        else:
            lines.append(f"| {c} | {frac[i] * 100:.2f}% | - | - | - |")
    lines.append("")
    return "\n".join(lines)


def main(n_events: int = 50_000, epochs: int = 40):
    t0 = time.time()
    REPORTS.mkdir(exist_ok=True)
    DATA.mkdir(exist_ok=True)

    print(f"[1/5] generating {n_events:,} toy events ...")
    ds = NabToySimulator(SimConfig(seed=42, n_events=n_events)).generate()
    save_dataset(ds, str(DATA / "toy_v1.npz"))
    rec = run_tcoinc(ds)
    res = residuals(ds, rec)
    memo = dataset_memo(ds, rec, res)

    print("[2/5] engineered features ...")
    X = event_features(ds)
    y = ds.event_class
    itr, iva, ite = split_idx(ds.n_events)

    report = [
        f"# Nab toy experiment — {n_events:,} events",
        "",
        f"date: 2026-07-03 · seed 42 · split 70/15/15",
        "",
        memo,
        "## Model comparison (held-out test split)",
        "",
    ]

    print("[3/5] rule-based + GBDT + MLP baselines ...")
    yp_rule = rule_based_predict(X[ite], FEATURE_NAMES)
    report.append(classification_report_md(y[ite], yp_rule, "Rule-based cuts (zeroth-order)"))

    gbdt = make_gbdt()
    gbdt.fit(X[itr], y[itr])
    yp_gbdt = gbdt.predict(X[ite])
    report.append(classification_report_md(y[ite], yp_gbdt, "HistGradientBoosting (engineered features)"))

    mlp = make_mlp()
    mlp.fit(X[itr], y[itr])
    yp_mlp = mlp.predict(X[ite])
    report.append(classification_report_md(y[ite], yp_mlp, "MLP (engineered features)"))

    print("[4/5] GNN ...")
    import torch

    from nab_ml.models.gnn import NabGNN, dataset_to_tensors
    from nab_ml.train import TrainConfig, predict, train_gnn

    tensors = dataset_to_tensors(ds, res)
    t_tr = {k: v[itr] for k, v in tensors.items()}
    t_va = {k: v[iva] for k, v in tensors.items()}
    t_te = {k: v[ite] for k, v in tensors.items()}

    model = NabGNN(dim=96, n_layers=3)
    cfg = TrainConfig(epochs=epochs, batch_size=256, lr=2e-3)
    model, hist = train_gnn(model, t_tr, t_va, cfg, verbose=True)
    torch.save(model.state_dict(), DATA / "gnn_v1.pt")

    out = predict(model, t_te)
    yp_gnn = out["event_logits"].argmax(dim=-1).numpy()
    report.append(classification_report_md(y[ite], yp_gnn, "NabGNN (multi-decoder, trigger graph)"))
    report.append("#### GNN confusion matrix (test)")
    report.append(confusion_md(y[ite], yp_gnn))

    # node-level accuracy
    node_pred = out["node_logits"].argmax(dim=-1).numpy()
    node_true = t_te["y_node"].numpy()
    m = node_true >= 0
    report.append(
        f"per-trigger label accuracy: **{(node_pred[m] == node_true[m]).mean():.4f}** "
        f"({m.sum():,} triggers)\n"
    )

    # residual regression
    res_pred = out["res_pred"].numpy()
    res_true = t_te["y_res"].numpy()
    rmask = t_te["res_mask"].numpy().astype(bool)
    report.append("### Residual (systematic-error) regression, test split")
    report.append(residual_report(res_pred[:, 0] * 100, res_true[:, 0] * 100, rmask, "d_eEng (keV)"))
    report.append(residual_report(res_pred[:, 1] * 5, res_true[:, 1] * 5, rmask, "d_tof (us)"))

    # summary table
    from nab_ml.eval import per_class_metrics as pcm

    def acc_f1(yt, yp):
        m = pcm(confusion(yt, yp, len(CLASSES)))
        return m["accuracy"], m["macro_f1"]

    rows = [
        ("Rule-based cuts", *acc_f1(y[ite], yp_rule)),
        ("GBDT", *acc_f1(y[ite], yp_gbdt)),
        ("MLP", *acc_f1(y[ite], yp_mlp)),
        ("NabGNN", *acc_f1(y[ite], yp_gnn)),
    ]
    report.insert(6, "\n".join(
        ["| model | accuracy | macro-F1 |", "|---|---|---|"]
        + [f"| {r[0]} | {r[1]:.4f} | {r[2]:.4f} |" for r in rows]
        + [""]
    ))

    report.append(f"\n_total wall time: {time.time() - t0:.0f}s_\n")
    out_path = REPORTS / f"experiment_{n_events}.md"
    out_path.write_text("\n".join(report))
    (REPORTS / "gnn_history.json").write_text(json.dumps(hist, indent=1))
    print(f"[5/5] report -> {out_path}")
    for r in rows:
        print(f"  {r[0]:>18}: acc {r[1]:.4f}  macroF1 {r[2]:.4f}")


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 50_000
    ep = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    main(n, ep)
