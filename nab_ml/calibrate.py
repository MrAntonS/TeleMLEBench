"""Probability calibration for the event classifier.

The veto working point 'keep if P(clean) > thr' is only meaningful if
P(clean) is calibrated. Class-weighted training deliberately skews the
softmax, so we post-hoc calibrate on the validation split with
temperature scaling (single parameter, preserves argmax ranking) plus an
optional per-class bias (vector scaling 'diag' variant).
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn.functional as F


def fit_temperature(
    logits: torch.Tensor, y: torch.Tensor, max_iter: int = 200
) -> float:
    """Fit a single temperature by minimizing NLL on held-out data."""
    log_t = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([log_t], lr=0.1, max_iter=max_iter)

    def closure():
        opt.zero_grad()
        loss = F.cross_entropy(logits / torch.exp(log_t), y)
        loss.backward()
        return loss

    opt.step(closure)
    return float(torch.exp(log_t).detach())


def apply_temperature(logits: torch.Tensor, t: float) -> torch.Tensor:
    return torch.softmax(logits / t, dim=-1)


def reliability_table(
    probs: np.ndarray, correct: np.ndarray, n_bins: int = 10
) -> list[dict]:
    """Reliability of max-prob predictions: rows of {bin, conf, acc, n}."""
    conf = probs.max(axis=1)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf >= lo) & (conf < hi)
        rows.append(
            dict(
                lo=float(lo),
                hi=float(hi),
                n=int(m.sum()),
                conf=float(conf[m].mean()) if m.any() else np.nan,
                acc=float(correct[m].mean()) if m.any() else np.nan,
            )
        )
    return rows


def ece(probs: np.ndarray, correct: np.ndarray, n_bins: int = 10) -> float:
    """Expected calibration error of the argmax confidence."""
    rows = reliability_table(probs, correct, n_bins)
    n = sum(r["n"] for r in rows)
    return float(
        sum(
            r["n"] * abs(r["conf"] - r["acc"])
            for r in rows
            if r["n"] > 0
        )
        / max(n, 1)
    )
