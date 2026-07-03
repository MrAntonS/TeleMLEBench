"""Scale test: does the correction head (now the load-bearing component)
improve with training data?

Trains GNN v3 on a fresh 150k-event set (seed 7), then re-runs the
Δâ gate scan on the independent 200k evaluation sample and compares to
the 50k-trained v2. Also reports classification metrics for reference.

Usage: python experiments/run_scale_test.py [n_train] [epochs]
Writes reports/scale_test.md, saves data/gnn_v3.pt.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nab_ml.calibrate import apply_temperature, fit_temperature
from nab_ml.eval import confusion, per_class_metrics
from nab_ml.extraction import beta_of, cos_theta_from_observables, fit_a_mle
from nab_ml.models.gnn import NabGNN, dataset_to_tensors
from nab_ml.recon import residuals, run_tcoinc
from nab_ml.taxonomy import CLASSES, CLASS_TO_IDX
from nab_ml.toysim import NabToySimulator, SimConfig, load_dataset, save_dataset
from nab_ml.train import TrainConfig, predict, train_gnn

ROOT = Path(__file__).resolve().parents[1]


def main(n_train=150_000, epochs=25):
    t0 = time.time()
    cache = ROOT / "data" / f"toy_train_{n_train}.npz"
    if cache.exists():
        ds = load_dataset(str(cache))
        print(f"loaded cached {ds.n_events:,} training events")
    else:
        print(f"generating {n_train:,} training events (seed 7) ...")
        ds = NabToySimulator(SimConfig(seed=7, n_events=n_train)).generate()
        save_dataset(ds, str(cache))

    rec = run_tcoinc(ds)
    tensors = dataset_to_tensors(ds, residuals(ds, rec))
    rng = np.random.default_rng(0)
    idx = rng.permutation(ds.n_events)
    n_va = 20_000
    iva, itr = idx[:n_va], idx[n_va:]
    t_tr = {k: v[itr] for k, v in tensors.items()}
    t_va = {k: v[iva] for k, v in tensors.items()}

    print("training GNN v3 ...")
    model = NabGNN(dim=96, n_layers=3)
    cfg = TrainConfig(epochs=epochs, batch_size=512, lr=2e-3, patience=6)
    model, hist = train_gnn(model, t_tr, t_va, cfg, verbose=True)
    torch.save(model.state_dict(), ROOT / "data" / "gnn_v3.pt")

    # calibrate on val
    out_va = predict(model, t_va)
    temp = fit_temperature(out_va["event_logits"], t_va["y_event"])

    # evaluate on the independent 200k sample
    print("evaluating on 200k sample ...")
    ds_e = load_dataset(str(ROOT / "data" / "toy_eval_200000.npz"))
    rec_e = run_tcoinc(ds_e)
    res_e = residuals(ds_e, rec_e)
    tens_e = dataset_to_tensors(ds_e, res_e)
    out = predict(model, tens_e)
    p_clean = apply_temperature(out["event_logits"], temp).numpy()[
        :, CLASS_TO_IDX["CLEAN_COINC"]
    ]
    pred_de = out["res_pred"][:, 0].numpy() * 100.0
    pred_dt = out["res_pred"][:, 1].numpy() * 5.0

    e_rec, tof_rec = rec_e.e_eng, rec_e.tof
    sel = rec_e.e_found & np.isfinite(e_rec) & np.isfinite(tof_rec)

    yp = out["event_logits"].argmax(-1).numpy()
    m = per_class_metrics(confusion(ds_e.event_class, yp, len(CLASSES)))
    print(f"classification on 200k: acc {m['accuracy']:.4f} "
          f"mF1 {m['macro_f1']:.4f}")

    def fit(te, tof, mask):
        c = cos_theta_from_observables(te[mask], tof[mask])
        return fit_a_mle(c, beta_of(te[mask]))

    a_ref, _ = fit(ds_e.te_true, ds_e.tof_true, sel)
    lines = [
        f"# Scale test — GNN v3 trained on {n_train:,} events",
        "",
        f"classification on 200k eval: accuracy {m['accuracy']:.4f}, "
        f"macro-F1 {m['macro_f1']:.4f} "
        f"(v2/50k reference: 0.906 / 0.712 on its test split)",
        "",
        "| gate | corrected frac | Δâ | stat err |",
        "|---|---|---|---|",
    ]
    for g in [0.0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.01]:
        gm = p_clean < g
        eg = np.where(gm, e_rec - pred_de, e_rec)
        tg = np.where(gm, tof_rec - pred_dt, tof_rec)
        a, err = fit(eg, tg, sel)
        name = "none" if g == 0 else ("all" if g > 1 else f"{g:.2f}")
        lines.append(
            f"| {name} | {float(gm[sel].mean()) * 100:.1f}% "
            f"| {a - a_ref:+.5f} | {err:.5f} |"
        )
    lines += [
        "",
        "v2 (50k-trained) reference gate scan: none +0.02906, best "
        "gate 0.1 -> +0.00698, all +0.02703.",
        f"\n_wall {time.time() - t0:.0f}s_",
    ]
    (ROOT / "reports" / "scale_test.md").write_text("\n".join(lines))
    print("\n".join(lines[-12:]))


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 150_000
    ep = int(sys.argv[2]) if len(sys.argv) > 2 else 25
    main(n, ep)
