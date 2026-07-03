"""Ablations on the NabGNN, run on a smaller set for CPU turnaround.

Questions:
  A1  do the auxiliary decoders (node labels, tags, residuals) help the
      event classification, as multi-task GNN literature claims?
  A2  do edge features (dt, ring distance, same-det) matter vs a plain
      set-transformer-ish fully-connected model with zeroed edges?
  A3  robustness: apply a +5 keV threshold shift / extra noise to the
      TEST set only (domain shift) -- how much does accuracy degrade?

Usage: python experiments/run_ablations.py [n_events] [epochs]
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nab_ml.augment import inject_noise, vary_threshold
from nab_ml.eval import confusion, per_class_metrics
from nab_ml.models.gnn import NabGNN, dataset_to_tensors
from nab_ml.recon import residuals, run_tcoinc
from nab_ml.taxonomy import CLASSES
from nab_ml.toysim import NabToySimulator, SimConfig
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


def eval_model(model, tensors, idx):
    t = {k: v[idx] for k, v in tensors.items()}
    out = predict(model, t)
    yp = out["event_logits"].argmax(-1).numpy()
    return acc_f1(t["y_event"].numpy(), yp)


def main(n_events=20_000, epochs=25):
    print(f"generating {n_events:,} events ...")
    ds = NabToySimulator(SimConfig(seed=123, n_events=n_events)).generate()
    rec = run_tcoinc(ds)
    res = residuals(ds, rec)
    tensors = dataset_to_tensors(ds, res)
    itr, iva, ite = split_idx(ds.n_events)
    t_tr = {k: v[itr] for k, v in tensors.items()}
    t_va = {k: v[iva] for k, v in tensors.items()}

    rows = []

    def run(name, cfg_kw=None, model_kw=None, edge_zero=False):
        torch.manual_seed(0)
        model = NabGNN(dim=64, n_layers=3, **(model_kw or {}))
        cfg = TrainConfig(epochs=epochs, batch_size=256, lr=2e-3,
                          **(cfg_kw or {}))
        tr, va = dict(t_tr), dict(t_va)
        if edge_zero:
            tr["edge_attr"] = torch.zeros_like(tr["edge_attr"])
            va["edge_attr"] = torch.zeros_like(va["edge_attr"])
        model, _ = train_gnn(model, tr, va, cfg, verbose=False)
        te = {k: v[ite] for k, v in tensors.items()}
        if edge_zero:
            te = dict(te)
            te["edge_attr"] = torch.zeros_like(te["edge_attr"])
        out = predict(model, te)
        yp = out["event_logits"].argmax(-1).numpy()
        a, f = acc_f1(te["y_event"].numpy(), yp)
        rows.append((name, a, f))
        print(f"  {name:>28}: acc {a:.4f}  macroF1 {f:.4f}")
        return model

    print("A1: full multi-task ...")
    full_model = run("full multi-task")
    print("A1: event head only ...")
    run("event-head only", cfg_kw=dict(w_node=0.0, w_tags=0.0, w_res=0.0))
    print("A2: zeroed edge features ...")
    run("zeroed edge features", edge_zero=True)

    # A3: domain shift on the test set only, evaluated with the full model
    print("A3: domain shifts ...")
    for name, shifted in [
        ("test threshold +5 keV", vary_threshold(ds, 15.0)),
        ("test noise x5", inject_noise(ds, 0.4, seed=9)),
    ]:
        rec_s = run_tcoinc(shifted)
        res_s = residuals(shifted, rec_s)
        tens_s = dataset_to_tensors(shifted, res_s)
        a, f = eval_model(full_model, tens_s, ite)
        rows.append((name, a, f))
        print(f"  {name:>28}: acc {a:.4f}  macroF1 {f:.4f}")

    md = [
        f"# GNN ablations ({n_events:,} events, {epochs} epochs, dim 64)",
        "",
        "| variant | accuracy | macro-F1 |",
        "|---|---|---|",
    ] + [f"| {n} | {a:.4f} | {f:.4f} |" for n, a, f in rows] + [""]
    out = ROOT / "reports" / "ablations.md"
    out.write_text("\n".join(md))
    print(f"wrote {out}")


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 20_000
    ep = int(sys.argv[2]) if len(sys.argv) > 2 else 25
    main(n, ep)
