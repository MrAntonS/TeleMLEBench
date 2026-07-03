"""Spectrum-level systematic study: mock a-extraction under
truth / raw recon / ML-veto / ML-correction scenarios, using the
trained GNN v2 on the saved 50k dataset (test split only).

Writes reports/extraction_study.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nab_ml.calibrate import apply_temperature, fit_temperature
from nab_ml.extraction import extract_scenarios, extraction_report_md
from nab_ml.models.gnn import NabGNN, dataset_to_tensors
from nab_ml.recon import residuals, run_tcoinc
from nab_ml.taxonomy import CLASS_TO_IDX
from nab_ml.toysim import load_dataset
from nab_ml.train import predict

ROOT = Path(__file__).resolve().parents[1]


def split_idx(n, seed=0):
    rng = np.random.default_rng(seed)
    idx = rng.permutation(n)
    n_tr, n_va = int(0.7 * n), int(0.15 * n)
    return idx[:n_tr], idx[n_tr : n_tr + n_va], idx[n_tr + n_va :]


def main(veto_thr: float = 0.55):
    ds = load_dataset(str(ROOT / "data" / "toy_v1.npz"))
    rec = run_tcoinc(ds)
    res = residuals(ds, rec)
    tensors = dataset_to_tensors(ds, res)
    _, iva, ite = split_idx(ds.n_events)

    model = NabGNN(dim=96, n_layers=3)
    model.load_state_dict(torch.load(ROOT / "data" / "gnn_v2.pt", weights_only=True))

    out_va = predict(model, {k: v[iva] for k, v in tensors.items()})
    temp = fit_temperature(out_va["event_logits"], tensors["y_event"][iva])
    out = predict(model, {k: v[ite] for k, v in tensors.items()})
    probs = apply_temperature(out["event_logits"], temp).numpy()
    p_clean = probs[:, CLASS_TO_IDX["CLEAN_COINC"]]

    pred_de = out["res_pred"][:, 0].numpy() * 100.0
    pred_dt = out["res_pred"][:, 1].numpy() * 5.0

    te_true = ds.te_true[ite]
    tof_true = ds.tof_true[ite]
    e_rec = rec.e_eng[ite]
    tof_rec = rec.tof[ite]
    selected = rec.e_found[ite] & np.isfinite(e_rec) & np.isfinite(tof_rec)

    scen = extract_scenarios(
        te_true=te_true,
        tof_true=tof_true,
        e_recon=e_rec,
        tof_recon=tof_rec,
        selected=selected,
        veto_mask=p_clean > veto_thr,
        e_corr=e_rec - pred_de,
        tof_corr=tof_rec - pred_dt,
    )

    md = (
        "# Spectrum-level systematic study (toy)\n\n"
        f"GNN v2, calibrated (T={temp:.3f}); veto threshold "
        f"P(clean) > {veto_thr}. Test split of the 50k set.\n\n"
        + extraction_report_md(scen)
        + "\nΔâ is the spectrum-level systematic of each scheme; the "
        "stat err column shows what sample-size penalty a veto incurs.\n"
    )
    (ROOT / "reports" / "extraction_study.md").write_text(md)
    print(md)


if __name__ == "__main__":
    main(float(sys.argv[1]) if len(sys.argv) > 1 else 0.55)
