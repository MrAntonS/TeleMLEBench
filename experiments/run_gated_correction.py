"""Gated ML correction: apply the residual correction ONLY to events the
classifier flags as non-clean (P(clean) < gate).

Motivation (correction_quality.md): the ungated correction fixes lossy
topologies but *smears clean events* (RMS 1.4 -> 6.4 keV). Gating should
keep the clean sample pristine while retaining most of the bias removal.

Scans the gate threshold; reports overall bias/RMS and clean-event RMS.
Writes reports/gated_correction.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nab_ml.calibrate import apply_temperature, fit_temperature
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


def main():
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

    de = res["d_eEng"][ite]
    dt = res["d_tof"][ite]
    sel = rec.e_found[ite] & np.isfinite(de) & np.isfinite(dt)
    clean = ds.event_class[ite] == CLASS_TO_IDX["CLEAN_COINC"]

    lines = [
        "# Gated ML correction (apply only if P(clean) < gate)",
        "",
        f"calibration T = {temp:.3f}; test split, {int(sel.sum())} selected events",
        "",
        "| gate | corrected frac | bias d_eEng | RMS | clean-evt RMS | bias d_tof | RMS |",
        "|---|---|---|---|---|---|---|",
    ]
    for gate in [0.0, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 1.01]:
        apply_m = p_clean < gate
        de_c = np.where(apply_m, de - pred_de, de)
        dt_c = np.where(apply_m, dt - pred_dt, dt)
        s = sel
        name = "none" if gate == 0.0 else ("all" if gate > 1.0 else f"{gate:.2f}")
        lines.append(
            f"| {name} | {float(apply_m[s].mean()) * 100:.1f}% "
            f"| {np.nanmean(de_c[s]):+.2f} | {np.sqrt(np.nanmean(de_c[s]**2)):.1f} "
            f"| {np.sqrt(np.nanmean(de_c[s & clean]**2)):.2f} "
            f"| {np.nanmean(dt_c[s]):+.4f} | {np.sqrt(np.nanmean(dt_c[s]**2)):.2f} |"
        )
    lines.append("")
    md = "\n".join(lines)
    (ROOT / "reports" / "gated_correction.md").write_text(md)
    print(md)


if __name__ == "__main__":
    main()
