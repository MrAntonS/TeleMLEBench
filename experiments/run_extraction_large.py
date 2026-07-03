"""Large-sample spectrum-level study: 200k independent events (fresh
seed) evaluated with the 50k-trained GNN v2, so the Δâ systematics are
resolved above the statistical error (~0.005 at this size).

Usage: python experiments/run_extraction_large.py [n_events] [veto_thr]
Writes reports/extraction_large.md; caches the dataset in data/.
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
from nab_ml.toysim import NabToySimulator, SimConfig, load_dataset, save_dataset
from nab_ml.train import predict

ROOT = Path(__file__).resolve().parents[1]


def split_idx(n, seed=0):
    rng = np.random.default_rng(seed)
    idx = rng.permutation(n)
    n_tr, n_va = int(0.7 * n), int(0.15 * n)
    return idx[:n_tr], idx[n_tr : n_tr + n_va], idx[n_tr + n_va :]


def main(n_events=200_000, veto_thr=0.55):
    cache = ROOT / "data" / f"toy_eval_{n_events}.npz"
    if cache.exists():
        ds = load_dataset(str(cache))
        print(f"loaded cached {ds.n_events:,} events")
    else:
        print(f"generating {n_events:,} independent events (seed 99) ...")
        ds = NabToySimulator(SimConfig(seed=99, n_events=n_events)).generate()
        save_dataset(ds, str(cache))

    print("tcoinc emulation ...")
    rec = run_tcoinc(ds)
    res = residuals(ds, rec)
    print("tensorizing + GNN inference ...")
    tensors = dataset_to_tensors(ds, res)

    model = NabGNN(dim=96, n_layers=3)
    model.load_state_dict(torch.load(ROOT / "data" / "gnn_v2.pt", weights_only=True))

    # temperature from the ORIGINAL training run's validation split
    ds50 = load_dataset(str(ROOT / "data" / "toy_v1.npz"))
    rec50 = run_tcoinc(ds50)
    t50 = dataset_to_tensors(ds50, residuals(ds50, rec50))
    _, iva, _ = split_idx(ds50.n_events)
    out_va = predict(model, {k: v[iva] for k, v in t50.items()})
    temp = fit_temperature(out_va["event_logits"], t50["y_event"][iva])
    print(f"temperature {temp:.3f}")

    out = predict(model, tensors)
    probs = apply_temperature(out["event_logits"], temp).numpy()
    p_clean = probs[:, CLASS_TO_IDX["CLEAN_COINC"]]
    pred_de = out["res_pred"][:, 0].numpy() * 100.0
    pred_dt = out["res_pred"][:, 1].numpy() * 5.0

    e_rec = rec.e_eng
    tof_rec = rec.tof
    selected = rec.e_found & np.isfinite(e_rec) & np.isfinite(tof_rec)

    scen = extract_scenarios(
        te_true=ds.te_true,
        tof_true=ds.tof_true,
        e_recon=e_rec,
        tof_recon=tof_rec,
        selected=selected,
        veto_mask=p_clean > veto_thr,
        e_corr=e_rec - pred_de,
        tof_corr=tof_rec - pred_dt,
    )

    md = (
        f"# Spectrum-level systematic study — {n_events:,} independent events\n\n"
        f"GNN v2 (trained on the 50k set), calibrated T={temp:.3f}, veto "
        f"P(clean) > {veto_thr}.\n\n"
        + extraction_report_md(scen)
        + "\nNote: the truth-reference â differs from the generator a "
        "because the tcoinc selection (8–40 µs window, 2-ring cut) has "
        "strong acceptance effects; Δâ vs that reference isolates the "
        "*reconstruction-quality* systematic, which is what the ML "
        "schemes act on.\n"
    )
    (ROOT / "reports" / "extraction_large.md").write_text(md)
    print(md)


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 200_000
    thr = float(sys.argv[2]) if len(sys.argv) > 2 else 0.55
    main(n, thr)
