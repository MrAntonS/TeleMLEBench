"""Per-class quality of the ML residual correction.

For each true class: mean and RMS of d_eEng and d_tof before and after
subtracting the GNN's predicted residual (50k set, test split). Shows
whether the correction head fixes specific topologies or merely shifts
the global mean.

Writes reports/correction_quality.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nab_ml.models.gnn import NabGNN, dataset_to_tensors
from nab_ml.recon import residuals, run_tcoinc
from nab_ml.taxonomy import CLASSES
from nab_ml.toysim import load_dataset
from nab_ml.train import predict

ROOT = Path(__file__).resolve().parents[1]


def split_idx(n, seed=0):
    rng = np.random.default_rng(seed)
    idx = rng.permutation(n)
    n_tr, n_va = int(0.7 * n), int(0.15 * n)
    return idx[:n_tr], idx[n_tr : n_tr + n_va], idx[n_tr + n_va :]


def main():
    ds = load_dataset(str(ROOT / "data" / "toy_v1.npz"))
    rec = run_tcoinc(ds)
    res = residuals(ds, rec)
    tensors = dataset_to_tensors(ds, res)
    _, _, ite = split_idx(ds.n_events)

    model = NabGNN(dim=96, n_layers=3)
    model.load_state_dict(torch.load(ROOT / "data" / "gnn_v2.pt", weights_only=True))
    out = predict(model, {k: v[ite] for k, v in tensors.items()})
    pred_de = out["res_pred"][:, 0].numpy() * 100.0
    pred_dt = out["res_pred"][:, 1].numpy() * 5.0

    de = res["d_eEng"][ite]
    dt = res["d_tof"][ite]
    sel = rec.e_found[ite] & np.isfinite(de) & np.isfinite(dt)
    cls = ds.event_class[ite]

    lines = [
        "# Per-class residual-correction quality (test split)",
        "",
        "| class | n | ⟨d_eEng⟩ | → after | RMS | → after | ⟨d_tof⟩ | → after | RMS | → after |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for i, c in enumerate(CLASSES):
        m = sel & (cls == i)
        if m.sum() < 5:
            continue
        de_b, de_a = de[m], de[m] - pred_de[m]
        dt_b, dt_a = dt[m], dt[m] - pred_dt[m]
        lines.append(
            f"| {c} | {m.sum()} "
            f"| {de_b.mean():+.1f} | **{de_a.mean():+.1f}** "
            f"| {np.sqrt((de_b**2).mean()):.1f} | **{np.sqrt((de_a**2).mean()):.1f}** "
            f"| {dt_b.mean():+.3f} | **{dt_a.mean():+.3f}** "
            f"| {np.sqrt((dt_b**2).mean()):.2f} | **{np.sqrt((dt_a**2).mean()):.2f}** |"
        )
    lines.append("")
    md = "\n".join(lines)
    (ROOT / "reports" / "correction_quality.md").write_text(md)
    print(md)


if __name__ == "__main__":
    main()
