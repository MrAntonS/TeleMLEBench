"""Engineered per-event features for the baseline classifiers.

Everything here is computable from ttrigs-level information ONLY
(pixel, detector, energy, time) -- this is the leakage boundary.
Truth quantities never enter; they are labels/targets.
"""

from __future__ import annotations

import numpy as np

from . import geometry
from .toysim import DET_UPPER, ToyDataset

FEATURE_NAMES = [
    "n_trig",
    "n_upper",
    "n_lower",
    "e_sum",
    "e_sum_upper",
    "e_sum_lower",
    "e_max",
    "e_min",
    "e_second",              # second-highest trigger energy
    "n_sub30_upper",         # proton-like candidates
    "min_sub30_upper_e",     # lowest sub-30 upper energy
    "t_span",
    "t_min",
    "dt_min",                # smallest inter-trigger gap
    "dt_pe_best",            # best proton-electron gap in [8, 40] us (else -1)
    "ring_spread",           # max pairwise ring distance
    "ring_pe",               # ring distance between proton cand and 1st trig
    "mean_ring",             # mean ring index (radial position)
    "n_in_esum_window",      # triggers within 200 ns of the earliest trigger
    "frac_e_in_first",       # energy fraction of the earliest trigger
]


def event_features(ds: ToyDataset) -> np.ndarray:
    """Return (n_events, n_features) float array."""
    n = ds.n_events
    off = ds.event_slices()
    out = np.zeros((n, len(FEATURE_NAMES)), dtype=np.float64)

    for i in range(n):
        s, e = off[i], off[i + 1]
        if e == s:
            out[i, :] = 0.0
            continue
        pix = ds.trig_pixel[s:e]
        det = ds.trig_det[s:e]
        en = ds.trig_energy[s:e]
        tm = ds.trig_time[s:e]
        k = e - s

        upper = det == DET_UPPER
        e_sorted = np.sort(en)[::-1]
        sub30_up = upper & (en < 30.0)

        # proton candidate: earliest sub-30 upper trigger
        dt_pe_best = -1.0
        ring_pe = -1.0
        if sub30_up.any():
            pi = np.where(sub30_up)[0][np.argmin(tm[sub30_up])]
            dts = tm[pi] - tm
            ok = (dts >= 8.0) & (dts <= 40.0)
            if ok.any():
                dt_pe_best = dts[ok].min()
            first = int(np.argmin(tm))
            ring_pe = float(geometry.RING_DIST[pix[pi], pix[first]])

        rings = geometry.ring_of(pix)
        ring_spread = (
            float(geometry.RING_DIST[pix[:, None], pix[None, :]].max())
            if k > 1
            else 0.0
        )
        dts_sorted = np.diff(np.sort(tm))
        first = int(np.argmin(tm))
        in_win = np.abs(tm - tm[first]) <= 0.2

        out[i] = [
            k,
            upper.sum(),
            (~upper).sum(),
            en.sum(),
            en[upper].sum(),
            en[~upper].sum(),
            e_sorted[0],
            e_sorted[-1],
            e_sorted[1] if k > 1 else 0.0,
            sub30_up.sum(),
            en[sub30_up].min() if sub30_up.any() else 0.0,
            tm.max() - tm.min(),
            tm.min(),
            dts_sorted.min() if k > 1 else 0.0,
            dt_pe_best,
            ring_spread,
            ring_pe,
            float(rings.mean()),
            float(in_win.sum()),
            float(en[first] / max(en.sum(), 1e-9)),
        ]
    return out
