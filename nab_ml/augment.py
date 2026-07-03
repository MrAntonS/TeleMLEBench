"""Training-time augmentation for trigger-level data.

Three knobs, per the plan:
  * accidental-coincidence overlay: mix triggers of two events with a
    random time offset (relabels the event ACCIDENTAL, marks the guest
    triggers PILEUP_OTHER);
  * noise injection: extra near-threshold triggers at random pixels/times;
  * threshold variation: re-apply a shifted energy threshold, dropping
    triggers that fall below it (emulates gain/threshold drift).

All operate on the flat ToyDataset arrays and return a NEW ToyDataset, so
they compose. They are also exactly the transformations we will apply to
real ttrigs data, where truth labels come along for the ride.
"""

from __future__ import annotations

import numpy as np

from . import geometry
from .taxonomy import CLASS_TO_IDX, TAG_TO_IDX, TRIG_TO_IDX
from .toysim import DET_UPPER, ToyDataset


def _rebuild(ds: ToyDataset, keep: np.ndarray) -> ToyDataset:
    """Dataset with a per-trigger boolean filter applied."""
    return ToyDataset(
        trig_event=ds.trig_event[keep],
        trig_pixel=ds.trig_pixel[keep],
        trig_det=ds.trig_det[keep],
        trig_energy=ds.trig_energy[keep],
        trig_time=ds.trig_time[keep],
        trig_label=ds.trig_label[keep],
        event_class=ds.event_class.copy(),
        event_tags=ds.event_tags.copy(),
        te_true=ds.te_true.copy(),
        tof_true=ds.tof_true.copy(),
        e_detected=ds.e_detected.copy(),
        config=ds.config,
    )


def vary_threshold(ds: ToyDataset, new_threshold_kev: float) -> ToyDataset:
    """Drop triggers below a (higher) threshold. Classes whose electron or
    proton disappears get relabeled MISSED_*."""
    keep = ds.trig_energy >= new_threshold_kev
    out = _rebuild(ds, keep)

    e_lbls = (TRIG_TO_IDX["ELECTRON_PRIMARY"], TRIG_TO_IDX["ELECTRON_BS"])
    for i in range(out.n_events):
        m = out.trig_event == i
        lbls = set(out.trig_label[m].tolist())
        if TRIG_TO_IDX["PROTON"] not in lbls and not any(l in lbls for l in e_lbls):
            continue  # leave class; empty events stay whatever they were
        if not any(l in lbls for l in e_lbls):
            out.event_class[i] = CLASS_TO_IDX["MISSED_ELECTRON"]
            out.event_tags[i, TAG_TO_IDX["missed_electron"]] = 1
        elif TRIG_TO_IDX["PROTON"] not in lbls:
            out.event_class[i] = CLASS_TO_IDX["MISSED_PROTON"]
            out.event_tags[i, TAG_TO_IDX["missed_proton"]] = 1
    return out


def inject_noise(
    ds: ToyDataset,
    rate_per_event: float,
    seed: int = 0,
    threshold_kev: float = 10.0,
    scale_kev: float = 6.0,
    window_us: float = 60.0,
) -> ToyDataset:
    """Add Poisson noise triggers; tags/classes updated for affected events."""
    rng = np.random.default_rng(seed)
    n_new = rng.poisson(rate_per_event, ds.n_events)
    total = int(n_new.sum())
    if total == 0:
        return ds

    ev = np.repeat(np.arange(ds.n_events), n_new)
    add = dict(
        trig_event=ev,
        trig_pixel=rng.integers(0, geometry.N_PIXELS, total),
        trig_det=rng.choice([DET_UPPER, -DET_UPPER], total),
        trig_energy=threshold_kev + rng.exponential(scale_kev, total),
        trig_time=rng.uniform(0.0, window_us, total),
        trig_label=np.full(total, TRIG_TO_IDX["NOISE"], dtype=np.int64),
    )

    out = ToyDataset(
        **{
            k: np.concatenate([getattr(ds, k), add[k]])
            for k in add
        },
        event_class=ds.event_class.copy(),
        event_tags=ds.event_tags.copy(),
        te_true=ds.te_true.copy(),
        tof_true=ds.tof_true.copy(),
        e_detected=ds.e_detected.copy(),
        config=ds.config,
    )
    # keep triggers sorted by (event, time) for downstream consumers
    order = np.lexsort((out.trig_time, out.trig_event))
    for k in add:
        setattr(out, k, getattr(out, k)[order])

    affected = np.unique(ev)
    out.event_tags[affected, TAG_TO_IDX["noise"]] = 1
    clean = out.event_class[affected] == CLASS_TO_IDX["CLEAN_COINC"]
    out.event_class[affected[clean]] = CLASS_TO_IDX["NOISE_CONTAM"]
    return out


def overlay_accidentals(
    ds: ToyDataset, frac: float, seed: int = 0, max_offset_us: float = 36.0
) -> ToyDataset:
    """Albert's recipe: pick `frac` of events, overlay each with the
    triggers of another random event shifted by a random offset."""
    rng = np.random.default_rng(seed)
    n = ds.n_events
    hosts = rng.choice(n, int(frac * n), replace=False)
    guests = rng.integers(0, n, len(hosts))
    off = ds.event_slices()

    add = {k: [] for k in (
        "trig_event", "trig_pixel", "trig_det", "trig_energy", "trig_time",
        "trig_label",
    )}
    for h, g in zip(hosts, guests):
        s, e = off[g], off[g + 1]
        if e == s:
            continue
        shift = rng.uniform(0.0, max_offset_us)
        k = e - s
        add["trig_event"].append(np.full(k, h))
        add["trig_pixel"].append(ds.trig_pixel[s:e])
        add["trig_det"].append(ds.trig_det[s:e])
        add["trig_energy"].append(ds.trig_energy[s:e])
        add["trig_time"].append(ds.trig_time[s:e] + shift)
        add["trig_label"].append(
            np.full(k, TRIG_TO_IDX["PILEUP_OTHER"], dtype=np.int64)
        )

    if not add["trig_event"]:
        return ds
    cat = {k: np.concatenate([getattr(ds, k)] + v) for k, v in add.items()}
    out = ToyDataset(
        **cat,
        event_class=ds.event_class.copy(),
        event_tags=ds.event_tags.copy(),
        te_true=ds.te_true.copy(),
        tof_true=ds.tof_true.copy(),
        e_detected=ds.e_detected.copy(),
        config=ds.config,
    )
    order = np.lexsort((out.trig_time, out.trig_event))
    for k in cat:
        setattr(out, k, getattr(out, k)[order])

    out.event_class[hosts] = CLASS_TO_IDX["ACCIDENTAL"]
    out.event_tags[hosts, TAG_TO_IDX["pileup"]] = 1
    return out
