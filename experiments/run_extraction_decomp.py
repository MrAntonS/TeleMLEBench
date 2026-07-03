"""Decompose the spectrum-level systematic Δâ into its sources.

Scenarios on the cached 200k sample:
  truth               : truth quantities, tcoinc selection  (reference)
  clean-only recon    : recon values on TRULY clean events -> the
                        energy-scale/resolution component alone
  oracle veto         : recon values, all truly non-clean removed ->
                        contamination ceiling for any veto
  recon raw           : everything (= contamination + scale)
  ML veto (0.55)      : calibrated classifier veto
  gated corr (0.30)   : correction only when P(clean) < 0.30
  gated corr + veto   : both, veto first
Writes reports/extraction_decomp.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nab_ml.calibrate import apply_temperature, fit_temperature
from nab_ml.extraction import (
    beta_of,
    cos_theta_from_observables,
    fit_a_mle,
)
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


def fit(te, tof, mask):
    c = cos_theta_from_observables(te[mask], tof[mask])
    b = beta_of(te[mask])
    a, err = fit_a_mle(c, b)
    return a, err, int(mask.sum())


def main():
    ds = load_dataset(str(ROOT / "data" / "toy_eval_200000.npz"))
    rec = run_tcoinc(ds)
    res = residuals(ds, rec)
    tensors = dataset_to_tensors(ds, res)

    model = NabGNN(dim=96, n_layers=3)
    model.load_state_dict(torch.load(ROOT / "data" / "gnn_v2.pt", weights_only=True))

    ds50 = load_dataset(str(ROOT / "data" / "toy_v1.npz"))
    rec50 = run_tcoinc(ds50)
    t50 = dataset_to_tensors(ds50, residuals(ds50, rec50))
    _, iva, _ = split_idx(ds50.n_events)
    out_va = predict(model, {k: v[iva] for k, v in t50.items()})
    temp = fit_temperature(out_va["event_logits"], t50["y_event"][iva])

    out = predict(model, tensors)
    p_clean = apply_temperature(out["event_logits"], temp).numpy()[
        :, CLASS_TO_IDX["CLEAN_COINC"]
    ]
    pred_de = out["res_pred"][:, 0].numpy() * 100.0
    pred_dt = out["res_pred"][:, 1].numpy() * 5.0

    e_rec, tof_rec = rec.e_eng, rec.tof
    sel = rec.e_found & np.isfinite(e_rec) & np.isfinite(tof_rec)
    truly_clean = ds.event_class == CLASS_TO_IDX["CLEAN_COINC"]

    gate = p_clean < 0.30
    e_gated = np.where(gate, e_rec - pred_de, e_rec)
    tof_gated = np.where(gate, tof_rec - pred_dt, tof_rec)

    rows = []

    def add(name, te, tof, mask):
        a, err, n = fit(te, tof, mask)
        rows.append((name, a, err, n))

    # simulation-derived clean-sample scale offsets, estimated from the
    # TRAINING dataset (50k) -- what the real analysis would take from MC
    sel50 = rec50.e_found & np.isfinite(rec50.e_eng) & np.isfinite(rec50.tof)
    clean50 = ds50.event_class == CLASS_TO_IDX["CLEAN_COINC"]
    de_scale = float(np.nanmean((rec50.e_eng - ds50.te_true)[sel50 & clean50]))
    dt_scale = float(np.nanmean((rec50.tof - ds50.tof_true)[sel50 & clean50]))
    print(f"MC-derived clean-sample scale: dE = {de_scale:+.3f} keV, "
          f"dT = {dt_scale:+.5f} us")

    add("truth", ds.te_true, ds.tof_true, sel)
    add("clean-only recon (scale component)", e_rec, tof_rec, sel & truly_clean)
    add("oracle veto", e_rec, tof_rec, sel & truly_clean)
    add("recon raw", e_rec, tof_rec, sel)
    add("ML veto 0.55", e_rec, tof_rec, sel & (p_clean > 0.55))
    add("gated corr 0.30", e_gated, tof_gated, sel)
    add("gated corr + ML veto", e_gated, tof_gated, sel & (p_clean > 0.55))
    add("gated corr + MC scale calib",
        e_gated - de_scale, tof_gated - dt_scale, sel)

    ref = rows[0][1]
    lines = [
        "# Δâ decomposition (200k events)",
        "",
        f"reference (truth quantities, same selection): â = {ref:.5f}",
        "",
        "| scenario | â | stat err | Δâ |",
        "|---|---|---|---|",
    ] + [
        f"| {n} | {a:.5f} | {e:.5f} | {a - ref:+.5f} |"
        for n, a, e, _ in rows
    ]
    # clean-only uses truly-clean recon: same events as oracle veto ->
    # identical rows; keep one label for clarity
    lines.append("")
    lines.append(
        "clean-only recon == oracle veto here (same event set); the Δâ of "
        "that row is the energy-scale/resolution floor that NO veto can "
        "beat — only an energy calibration or unfolding can."
    )
    # ---- gate-threshold scan, scored directly on Δâ ------------------
    lines += [
        "",
        "## Gate-threshold scan (scored on Δâ itself)",
        "",
        "| gate | corrected frac | Δâ | stat err |",
        "|---|---|---|---|",
    ]
    for g in [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 0.9, 1.01]:
        gm = p_clean < g
        eg = np.where(gm, e_rec - pred_de, e_rec)
        tg = np.where(gm, tof_rec - pred_dt, tof_rec)
        a, err, _ = fit(eg, tg, sel)
        name = "none" if g == 0 else ("all" if g > 1 else f"{g:.1f}")
        lines.append(
            f"| {name} | {float(gm[sel].mean()) * 100:.1f}% "
            f"| {a - ref:+.5f} | {err:.5f} |"
        )
    lines.append("")

    md = "\n".join(lines)
    (ROOT / "reports" / "extraction_decomp.md").write_text(md)
    print(md)


if __name__ == "__main__":
    main()
