"""Does augmentation-in-training buy domain-shift robustness?

Train two GNNs on the same 30k events:
  * baseline: nominal data only;
  * augmented: 50/50 mix of nominal and augmented copies (threshold
    jitter 10->12.5 keV, extra noise x3, 5% extra overlay accidentals).

Evaluate both on: nominal test, threshold +5 keV test, noise x5 test,
double-accidentals test.

Usage: python experiments/run_augmented_training.py [n_events] [epochs]
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nab_ml.augment import inject_noise, overlay_accidentals, vary_threshold
from nab_ml.eval import confusion, per_class_metrics
from nab_ml.models.gnn import NabGNN, dataset_to_tensors
from nab_ml.recon import residuals, run_tcoinc
from nab_ml.taxonomy import CLASSES
from nab_ml.toysim import NabToySimulator, SimConfig
from nab_ml.train import TrainConfig, predict, train_gnn

ROOT = Path(__file__).resolve().parents[1]


def tensors_of(ds):
    rec = run_tcoinc(ds)
    return dataset_to_tensors(ds, residuals(ds, rec))


def split_idx(n, seed=0):
    rng = np.random.default_rng(seed)
    idx = rng.permutation(n)
    n_tr, n_va = int(0.7 * n), int(0.15 * n)
    return idx[:n_tr], idx[n_tr : n_tr + n_va], idx[n_tr + n_va :]


def acc_f1(y_true, y_pred):
    m = per_class_metrics(confusion(y_true, y_pred, len(CLASSES)))
    return m["accuracy"], m["macro_f1"]


def eval_on(model, tensors, idx):
    t = {k: v[idx] for k, v in tensors.items()}
    out = predict(model, t)
    return acc_f1(t["y_event"].numpy(),
                  out["event_logits"].argmax(-1).numpy())


def main(n_events=30_000, epochs=20):
    print(f"generating {n_events:,} events ...")
    ds = NabToySimulator(SimConfig(seed=77, n_events=n_events)).generate()
    itr, iva, ite = split_idx(ds.n_events)
    tensors = tensors_of(ds)

    # augmented view of the SAME events (labels updated by the transforms)
    print("building augmented view ...")
    ds_aug = overlay_accidentals(
        inject_noise(vary_threshold(ds, 12.5), 0.25, seed=5), 0.05, seed=6
    )
    tensors_aug = tensors_of(ds_aug)

    def subset(t, idx):
        return {k: v[idx] for k, v in t.items()}

    t_va = subset(tensors, iva)

    def train_variant(name, t_tr):
        torch.manual_seed(0)
        model = NabGNN(dim=64, n_layers=3)
        cfg = TrainConfig(epochs=epochs, batch_size=256, lr=2e-3, patience=8)
        model, _ = train_gnn(model, t_tr, t_va, cfg, verbose=False)
        print(f"  trained {name}")
        return model

    print("training baseline ...")
    m_base = train_variant("baseline", subset(tensors, itr))

    print("training augmented (nominal + augmented mix) ...")
    mix = {
        k: torch.cat([tensors[k][itr], tensors_aug[k][itr]])
        for k in tensors
    }
    m_aug = train_variant("augmented", mix)

    # test suites
    suites = {"nominal": tensors}
    suites["thr +5 keV"] = tensors_of(vary_threshold(ds, 15.0))
    suites["noise x5"] = tensors_of(inject_noise(ds, 0.4, seed=9))
    suites["acc x2"] = tensors_of(overlay_accidentals(ds, 0.06, seed=10))

    rows = []
    for sname, t in suites.items():
        for mname, m in [("baseline", m_base), ("augmented", m_aug)]:
            a, f = eval_on(m, t, ite)
            rows.append((sname, mname, a, f))
            print(f"  {sname:>12} | {mname:>9}: acc {a:.4f}  mF1 {f:.4f}")

    md = [
        f"# Augmented-training study ({n_events:,} events, {epochs} epochs)",
        "",
        "Augmented trainer sees a 50/50 mix of nominal and transformed",
        "copies (threshold 12.5 keV, noise +0.25/event, +5% overlay).",
        "",
        "| test set | model | accuracy | macro-F1 |",
        "|---|---|---|---|",
    ] + [f"| {s} | {m} | {a:.4f} | {f:.4f} |" for s, m, a, f in rows] + [""]
    (ROOT / "reports" / "augmented_training.md").write_text("\n".join(md))
    print("wrote reports/augmented_training.md")


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 30_000
    ep = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    main(n, ep)
