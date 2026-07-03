"""Emulation of the current Nab coincidence reconstruction (tcoinc).

Rules per Jin's document:
  * any Upper-detector trigger under 30 keV is declared a proton;
  * preceding triggers within two pixel rings (18.2 mm) of the proton and
    inside the 8--40 us window are searched for the electron;
  * all triggers within two rings of the electron and within 200 ns are
    summed as the electron energy (agnostic to whether they are truly
    backscatter).

This gives the recon quantities (pFound, eFound, eEng, TOF, radDiff)
whose *residuals against truth* are the regression targets of the ML
model -- i.e. the per-event systematic error of the current scheme.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import geometry
from .toysim import DET_UPPER, ToyDataset

PROTON_MAX_KEV = 30.0
E_SEARCH_LO_US = 8.0
E_SEARCH_HI_US = 40.0
SEARCH_RINGS = 2
E_SUM_WINDOW_US = 0.2


@dataclass
class ReconResult:
    p_found: np.ndarray      # bool
    e_found: np.ndarray      # bool
    e_eng: np.ndarray        # summed electron energy (keV), nan if not found
    tof: np.ndarray          # t_proton - t_electron (us), nan if not found
    rad_diff: np.ndarray     # e-p pixel distance (rings), nan if not found


def run_tcoinc(ds: ToyDataset) -> ReconResult:
    n = ds.n_events
    off = ds.event_slices()

    p_found = np.zeros(n, dtype=bool)
    e_found = np.zeros(n, dtype=bool)
    e_eng = np.full(n, np.nan)
    tof = np.full(n, np.nan)
    rad_diff = np.full(n, np.nan)

    for i in range(n):
        s, e = off[i], off[i + 1]
        pix = ds.trig_pixel[s:e]
        det = ds.trig_det[s:e]
        en = ds.trig_energy[s:e]
        tm = ds.trig_time[s:e]

        # proton candidates: upper det, < 30 keV; scheme takes them in time
        # order and keeps the first that yields an electron partner.
        p_cand = np.where((det == DET_UPPER) & (en < PROTON_MAX_KEV))[0]
        if len(p_cand) == 0:
            continue
        p_cand = p_cand[np.argsort(tm[p_cand])]

        for pi in p_cand:
            p_found[i] = True
            dt = tm[pi] - tm  # positive: trigger precedes the proton
            near = geometry.RING_DIST[pix[pi], pix] <= SEARCH_RINGS
            e_cand = np.where(
                (dt >= E_SEARCH_LO_US) & (dt <= E_SEARCH_HI_US) & near
            )[0]
            if len(e_cand) == 0:
                continue
            # electron = earliest candidate in the window
            ei = e_cand[np.argmin(tm[e_cand])]
            # sum everything within 2 rings of the electron and 200 ns
            summable = (
                (np.abs(tm - tm[ei]) <= E_SUM_WINDOW_US)
                & (geometry.RING_DIST[pix[ei], pix] <= SEARCH_RINGS)
            )
            summable[pi] = False
            e_found[i] = True
            e_eng[i] = en[summable].sum()
            tof[i] = tm[pi] - tm[ei]
            rad_diff[i] = geometry.RING_DIST[pix[pi], pix[ei]]
            break

    return ReconResult(p_found, e_found, e_eng, tof, rad_diff)


def residuals(ds: ToyDataset, rec: ReconResult) -> dict[str, np.ndarray]:
    """Per-event recon-minus-truth residuals (nan where recon failed)."""
    return {
        "d_eEng": rec.e_eng - ds.te_true,     # energy residual (keV)
        "d_tof": rec.tof - ds.tof_true,       # TOF residual (us)
    }
