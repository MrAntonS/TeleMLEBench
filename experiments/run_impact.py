"""Systematic-impact study using the trained GNN from run_experiment.py.

Loads data/toy_v1.npz + data/gnn_v2.pt, evaluates on the test split, and
writes reports/impact_study.md with:
  * per-class bias contributions,
  * ML-veto working-point scan,
  * ML-correction (residual subtraction) scenario.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nab_ml.impact import (
    impact_report_md,
    ml_correction_scenario,
    ml_veto_scenario,
    per_class_bias_table,
)
from nab_ml.models.gnn import NabGNN, dataset_to_tensors
from nab_ml.recon import residuals, run_tcoinc
from nab_ml.taxonomy import CLASS_TO_IDX
from nab_ml.toysim import load_dataset
from nab_ml.train import predict

ROOT = Path(__file__).resolve().parents[1]


def split_idx(n: int, seed: int = 0):
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
    t_te = {k: v[ite] for k, v in tensors.items()}

    model = NabGNN(dim=96, n_layers=3)
    model.load_state_dict(torch.load(ROOT / "data" / "gnn_v2.pt", weights_only=True))
    out = predict(model, t_te)

    probs = torch.softmax(out["event_logits"], dim=-1).numpy()
    p_clean = probs[:, CLASS_TO_IDX["CLEAN_COINC"]]
    pred_de = out["res_pred"][:, 0].numpy() * 100.0  # unscale keV
    pred_dt = out["res_pred"][:, 1].numpy() * 5.0    # unscale us

    cls_true = ds.event_class[ite]
    d_eeng = res["d_eEng"][ite]
    d_tof = res["d_tof"][ite]
    selected = rec.e_found[ite] & ~np.isnan(d_eeng) & ~np.isnan(d_tof)

    rows = per_class_bias_table(cls_true, d_eeng, d_tof, selected)
    veto = ml_veto_scenario(cls_true, p_clean, d_eeng, d_tof, selected)
    corr = ml_correction_scenario(d_eeng, d_tof, pred_de, pred_dt, selected)

    md = "# Nab toy systematic-impact study\n\n" + impact_report_md(rows, veto, corr)
    out_path = ROOT / "reports" / "impact_study.md"
    out_path.write_text(md)
    print(f"wrote {out_path}")
    b, a = corr["before"], corr["after"]
    print(f"bias d_eEng {b['bias_de']:+.3f} -> {a['bias_de']:+.3f} keV")
    print(f"bias d_tof  {b['bias_dt']:+.4f} -> {a['bias_dt']:+.4f} us")


if __name__ == "__main__":
    main()
