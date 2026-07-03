"""Toy Nab event generator emulating ttrigs-level data with truth labels.

Produces, per decay event, the list of *triggers* (pixel, detector,
energy, time) that the experiment would see -- the same schema as the
`ttrigs` tree in trigCoincs.root -- together with the generator truth
needed for labels and regression targets.

Physics knobs are set to plausible magnitudes (Si backscatter ~10%,
brems ~ few %, dead-layer grazing losses ~ few %, ~30 keV accelerated
proton line, 10 keV thresholds).  They are configurable so studies can
scan them; none of the ML pipeline depends on their exact values.

Units: keV, microseconds, mm.  Decay happens at t = 0.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import geometry, physics
from .taxonomy import CLASS_TO_IDX, TRIG_TO_IDX, assign_class

DET_UPPER = 1
DET_LOWER = -1


@dataclass
class SimConfig:
    seed: int = 2026
    n_events: int = 10_000

    # thresholds / readout
    e_threshold_kev: float = 10.0
    trig_window_us: float = 1.0        # per-pixel re-summing window (ttrigs)
    time_jitter_us: float = 0.005
    readout_window_us: float = 60.0

    # beam / geometry
    beam_sigma_mm: float = 9.0
    electron_spread_mm: float = 6.0
    proton_spread_mm: float = 5.0

    # electron interaction probabilities
    p_backscatter: float = 0.10
    bs_frac_alpha: float = 1.6         # Beta params: fraction deposited pre-BS
    bs_frac_beta: float = 2.4
    p_bs_same_det: float = 0.45        # given a backscatter: re-enter same det
    p_bs_other_det: float = 0.25       # ... re-enter opposite det
    p_brems: float = 0.05
    brems_min_kev: float = 10.0        # tag threshold for escaped photon
    p_deadlayer_big: float = 0.04
    dl_big_lo_kev: float = 6.0
    dl_big_hi_kev: float = 30.0
    dl_small_kev: float = 1.0          # typical thin-DL loss for electrons

    # proton
    proton_dl_loss_kev: float = 3.0
    proton_dl_sigma_kev: float = 1.0
    p_proton_missed: float = 0.04      # inter-pixel gap / edge losses

    # backgrounds
    noise_rate_per_event: float = 0.08
    noise_scale_kev: float = 6.0
    p_pileup: float = 0.03


@dataclass
class ToyDataset:
    """Flat (CSR-style) trigger arrays + per-event records."""

    # per-trigger
    trig_event: np.ndarray    # event index of each trigger
    trig_pixel: np.ndarray    # 0..126
    trig_det: np.ndarray      # +1 upper / -1 lower
    trig_energy: np.ndarray   # keV
    trig_time: np.ndarray     # us since decay
    trig_label: np.ndarray    # index into TRIGGER_LABELS

    # per-event
    event_class: np.ndarray   # index into CLASSES
    event_tags: np.ndarray    # (n, N_TAGS) multi-hot
    te_true: np.ndarray       # keV
    tof_true: np.ndarray      # us
    e_detected: np.ndarray    # keV actually deposited in active Si
    config: SimConfig = field(repr=False, default=None)

    @property
    def n_events(self) -> int:
        return len(self.event_class)

    def event_slices(self) -> np.ndarray:
        """Offsets such that triggers of event i are [off[i]:off[i+1]]."""
        counts = np.bincount(self.trig_event, minlength=self.n_events)
        off = np.zeros(self.n_events + 1, dtype=np.int64)
        np.cumsum(counts, out=off[1:])
        return off


def _mirror_pixel(rng: np.random.Generator, pixel: int, spread_mm: float) -> int:
    """Pixel on the *other* detector reached by a backscattered electron:
    roughly magnetically mirrored, with transverse diffusion."""
    x, y = geometry.XY_MM[pixel]
    return geometry.pixel_at_xy(
        x + rng.normal(0, spread_mm), y + rng.normal(0, spread_mm)
    )


def _nearby_pixel(rng: np.random.Generator, pixel: int, max_ring: int = 3) -> int:
    """A different pixel within `max_ring` rings (backscatter re-entry)."""
    cand = geometry.neighbors(pixel, max_ring=max_ring)
    return int(rng.choice(cand))


class NabToySimulator:
    def __init__(self, config: SimConfig | None = None):
        self.cfg = config or SimConfig()
        self.rng = np.random.default_rng(self.cfg.seed)

    # ------------------------------------------------------------------
    def _electron_deposits(self, te: float):
        """Follow one electron; return (deposits, tags) where deposits is a
        list of (pixel, det, energy, time_us, label_idx)."""
        cfg, rng = self.cfg, self.rng
        tags = {}
        deposits = []

        det = DET_UPPER if rng.random() < 0.5 else DET_LOWER
        x = rng.normal(0.0, cfg.beam_sigma_mm) + rng.normal(0, cfg.electron_spread_mm)
        y = rng.normal(0.0, cfg.beam_sigma_mm) + rng.normal(0, cfg.electron_spread_mm)
        pixel = geometry.pixel_at_xy(x, y)

        e_rem = te

        # Bremsstrahlung in the detector: photon escapes carrying E_gamma.
        if rng.random() < cfg.p_brems and e_rem > 2 * cfg.brems_min_kev:
            frac = rng.beta(0.8, 3.0)
            e_gamma = frac * e_rem
            if e_gamma > cfg.brems_min_kev:
                tags["brems"] = True
                e_rem -= e_gamma

        # Dead-layer loss on entry.
        dl = rng.exponential(cfg.dl_small_kev)
        if rng.random() < cfg.p_deadlayer_big:
            dl = rng.uniform(cfg.dl_big_lo_kev, cfg.dl_big_hi_kev)
            tags["dead_layer"] = True
        e_rem = max(e_rem - dl, 0.0)

        t0 = abs(rng.normal(0.0, cfg.time_jitter_us))

        if rng.random() < cfg.p_backscatter and e_rem > cfg.e_threshold_kev:
            tags["backscatter"] = True
            f1 = rng.beta(cfg.bs_frac_alpha, cfg.bs_frac_beta)
            e_first = f1 * e_rem
            e_out = e_rem - e_first
            deposits.append((pixel, det, e_first, t0, TRIG_TO_IDX["ELECTRON_PRIMARY"]))

            u = rng.random()
            if u < cfg.p_bs_same_det:
                # magnetically reflected back to the same detector
                pix2 = _nearby_pixel(rng, pixel, max_ring=3)
                dt = rng.uniform(0.005, 0.8)  # reflection time, sub-window
                dl2 = rng.exponential(cfg.dl_small_kev) * 2
                e2 = max(e_out - dl2, 0.0)
                deposits.append(
                    (pix2, det, e2, t0 + dt, TRIG_TO_IDX["ELECTRON_BS"])
                )
                tags["bs_same_det"] = True
            elif u < cfg.p_bs_same_det + cfg.p_bs_other_det:
                pix2 = _mirror_pixel(rng, pixel, cfg.electron_spread_mm * 2)
                dt = rng.uniform(0.02, 0.1)  # ~5 m flight at ~0.8c plus spiral
                dl2 = rng.exponential(cfg.dl_small_kev) * 2
                e2 = max(e_out - dl2, 0.0)
                deposits.append(
                    (pix2, -det, e2, t0 + dt, TRIG_TO_IDX["ELECTRON_BS"])
                )
                tags["bs_other_det"] = True
            else:
                tags["bs_lost"] = True  # escaped the spectrometer
        else:
            deposits.append((pixel, det, e_rem, t0, TRIG_TO_IDX["ELECTRON_PRIMARY"]))

        return deposits, tags

    # ------------------------------------------------------------------
    def _proton_deposit(self, t_p_ke_kev: float, tof_us: float):
        cfg, rng = self.cfg, self.rng
        x = rng.normal(0.0, cfg.beam_sigma_mm) + rng.normal(0, cfg.proton_spread_mm)
        y = rng.normal(0.0, cfg.beam_sigma_mm) + rng.normal(0, cfg.proton_spread_mm)
        pixel = geometry.pixel_at_xy(x, y)
        e_det = (
            physics.PROTON_ACCEL_KEV
            + t_p_ke_kev
            - max(rng.normal(cfg.proton_dl_loss_kev, cfg.proton_dl_sigma_kev), 0.0)
        )
        t = tof_us + rng.normal(0.0, cfg.time_jitter_us)
        missed = (rng.random() < cfg.p_proton_missed) or (e_det < cfg.e_threshold_kev)
        return (pixel, DET_UPPER, e_det, t, TRIG_TO_IDX["PROTON"]), missed

    # ------------------------------------------------------------------
    def _one_decay(self, te: float, p_p: float, tof: float):
        """Deposits + tags + e_detected for one decay (no pile-up/noise)."""
        cfg = self.cfg
        deposits, tags = self._electron_deposits(te)
        p_dep, p_missed = self._proton_deposit(physics.proton_ke_kev(p_p), tof)
        if p_missed:
            tags["missed_proton"] = True
        else:
            deposits.append(p_dep)

        # apply threshold; drop sub-threshold deposits
        kept = [d for d in deposits if d[2] >= cfg.e_threshold_kev]
        e_labels = (TRIG_TO_IDX["ELECTRON_PRIMARY"], TRIG_TO_IDX["ELECTRON_BS"])
        if not any(d[4] in e_labels for d in kept):
            tags["missed_electron"] = True
        e_detected = sum(d[2] for d in deposits if d[4] in e_labels)
        return kept, tags, e_detected

    # ------------------------------------------------------------------
    def generate(self) -> ToyDataset:
        cfg, rng = self.cfg, self.rng
        n = cfg.n_events

        te = physics.sample_electron_ke(rng, n)
        p_p, _ = physics.sample_proton_momentum(rng, te)
        tof = physics.proton_tof_us(p_p, rng)

        # pre-sample the overlay decays for pile-up
        pileup_mask = rng.random(n) < cfg.p_pileup
        n_pu = int(pileup_mask.sum())
        te_pu = physics.sample_electron_ke(rng, max(n_pu, 1))
        p_p_pu, _ = physics.sample_proton_momentum(rng, te_pu)
        tof_pu = physics.proton_tof_us(p_p_pu, rng)

        from .taxonomy import N_TAGS, TAG_TO_IDX

        t_ev, t_pix, t_det, t_en, t_tm, t_lb = [], [], [], [], [], []
        ev_class = np.empty(n, dtype=np.int64)
        ev_tags = np.zeros((n, N_TAGS), dtype=np.int8)
        e_detected = np.empty(n)

        pu_idx = 0
        for i in range(n):
            kept, tags, e_det = self._one_decay(te[i], p_p[i], tof[i])

            # pile-up overlay: a second decay shifted by a random offset
            if pileup_mask[i]:
                tags["pileup"] = True
                off = rng.uniform(0.0, cfg.readout_window_us * 0.6)
                kept2, _, _ = self._one_decay(
                    te_pu[pu_idx % len(te_pu)],
                    p_p_pu[pu_idx % len(te_pu)],
                    tof_pu[pu_idx % len(te_pu)],
                )
                pu_idx += 1
                kept += [
                    (p, d, e, t + off, TRIG_TO_IDX["PILEUP_OTHER"])
                    for (p, d, e, t, _) in kept2
                ]

            # noise triggers
            n_noise = rng.poisson(cfg.noise_rate_per_event)
            for _ in range(n_noise):
                kept.append(
                    (
                        int(rng.integers(0, geometry.N_PIXELS)),
                        DET_UPPER if rng.random() < 0.5 else DET_LOWER,
                        cfg.e_threshold_kev + rng.exponential(cfg.noise_scale_kev),
                        rng.uniform(0.0, cfg.readout_window_us),
                        TRIG_TO_IDX["NOISE"],
                    )
                )
            if n_noise > 0:
                tags["noise"] = True

            # ttrigs emulation: merge same-pixel, same-det deposits within 1 us
            kept.sort(key=lambda d: d[3])
            merged: list[list] = []
            for p, d, e, t, lb in kept:
                hit = False
                for m in merged:
                    if (
                        m[0] == p
                        and m[1] == d
                        and abs(t - m[3]) < cfg.trig_window_us
                    ):
                        m[2] += e
                        hit = True
                        break
                if not hit:
                    merged.append([p, d, e, t, lb])

            for p, d, e, t, lb in merged:
                t_ev.append(i)
                t_pix.append(p)
                t_det.append(d)
                t_en.append(e)
                t_tm.append(t)
                t_lb.append(lb)

            ev_class[i] = assign_class(tags)
            for tag, flag in tags.items():
                if flag and tag in TAG_TO_IDX:
                    ev_tags[i, TAG_TO_IDX[tag]] = 1
            e_detected[i] = e_det

        return ToyDataset(
            trig_event=np.array(t_ev, dtype=np.int64),
            trig_pixel=np.array(t_pix, dtype=np.int64),
            trig_det=np.array(t_det, dtype=np.int64),
            trig_energy=np.array(t_en, dtype=np.float64),
            trig_time=np.array(t_tm, dtype=np.float64),
            trig_label=np.array(t_lb, dtype=np.int64),
            event_class=ev_class,
            event_tags=ev_tags,
            te_true=te,
            tof_true=tof,
            e_detected=e_detected,
            config=cfg,
        )


def save_dataset(ds: ToyDataset, path: str) -> None:
    np.savez_compressed(
        path,
        trig_event=ds.trig_event,
        trig_pixel=ds.trig_pixel,
        trig_det=ds.trig_det,
        trig_energy=ds.trig_energy,
        trig_time=ds.trig_time,
        trig_label=ds.trig_label,
        event_class=ds.event_class,
        event_tags=ds.event_tags,
        te_true=ds.te_true,
        tof_true=ds.tof_true,
        e_detected=ds.e_detected,
    )


def load_dataset(path: str) -> ToyDataset:
    z = np.load(path)
    return ToyDataset(**{k: z[k] for k in z.files}, config=None)
