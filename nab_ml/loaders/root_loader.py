"""Loader skeleton for the real Nab simulation files (uproot + awkward).

Reads the three-file layout described in Jin's 2026-06-08 document and
emits one record per decay, joined on eventID:

  hits.root       : hits            (not needed for the first ML pass)
  trigCoincs.root : ttrigs, tcoinc  (model input + current-scheme recon)
  g4track.root    : eDepTree, exitsTree, killedEve, creationEnergyTree,
                    dynamicTree     (label-side ONLY -- leakage boundary)

Unit rules baked in here so nobody downstream has to remember them:
  * pE0 is in eV -> converted to keV at load time (the doc shouts about it).
  * everything else keV / us / mm.
  * `process` / `particle` are fixed 275-char arrays -> stripped to str.
  * do NOT depend on tofTree; it may not exist in production sets.

This module is import-safe without uproot installed; it raises only when
actually used.  It is untested against real files (no cluster access from
this environment) and is expected to need branch-name touch-ups on first
contact -- every branch name is a single constant below for that reason.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

EV_TO_KEV = 1e-3

# Branch names, centralized for painless fix-up on first real-file contact.
TTRIGS = dict(tree="ttrigs", event="eventID", pixel="pixel", energy="energy",
              time="time", det="DetID")
TCOINC = dict(tree="tcoinc", event="eventID", p_found="pFound", e_found="eFound",
              e_eng="eEng", tof="TOF", rad_diff="radDiff",
              x0="x0", y0="y0", z0="z0", pE0="pE0", eE0="eE0")
CREATION = dict(tree="creationEnergyTree", event="eventID",
                counts="createdCounts", energies="createdEnergies",
                idx_ebrem=9)  # index 9 = eBrem, per the doc
DYNAMIC = dict(tree="dynamicTree", event="eventID", bounces_e="bouncesE",
               bounces_p="bouncesP", dl_loss="DLLoss",
               gamma_escape="GammaEscape")


@dataclass
class DecayRecord:
    event_id: int
    # ttrigs-level (model input; the leakage boundary)
    pixel: np.ndarray
    det: np.ndarray
    energy_kev: np.ndarray
    time_us: np.ndarray
    # tcoinc recon + truth (labels/targets)
    p_found: bool
    e_found: bool
    recon_e_eng: float
    recon_tof: float
    te_true_kev: float     # eE0
    tp_true_kev: float     # pE0, CONVERTED from eV
    # g4track tags (labels)
    brems_kev: float
    dl_loss_kev: float
    bounces_e: int
    gamma_escape_kev: float


def _clean_str(raw) -> str:
    """Fixed 275-char arrays -> stripped python str."""
    if isinstance(raw, bytes):
        raw = raw.decode(errors="ignore")
    return str(raw).strip().strip("\x00").strip()


def load_decays(trig_path: str, g4_path: str, entry_stop: int | None = None):
    """Yield DecayRecord per decay, joined on eventID across files."""
    import uproot  # deferred import

    ftrig = uproot.open(trig_path)
    fg4 = uproot.open(g4_path)

    tt = ftrig[TTRIGS["tree"]].arrays(library="np", entry_stop=entry_stop)
    tc = ftrig[TCOINC["tree"]].arrays(library="np", entry_stop=entry_stop)
    cr = fg4[CREATION["tree"]].arrays(library="np", entry_stop=entry_stop)
    dy = fg4[DYNAMIC["tree"]].arrays(library="np", entry_stop=entry_stop)

    # ttrigs is a per-trigger list -> group by eventID
    order = np.argsort(tt[TTRIGS["event"]], kind="stable")
    ev = tt[TTRIGS["event"]][order]
    bounds = np.searchsorted(ev, np.unique(ev), side="left")
    bounds = np.append(bounds, len(ev))
    uniq = np.unique(ev)

    tc_index = {int(e): i for i, e in enumerate(tc[TCOINC["event"]])}
    cr_index = {int(e): i for i, e in enumerate(cr[CREATION["event"]])}
    dy_index = {int(e): i for i, e in enumerate(dy[DYNAMIC["event"]])}

    for u, s, e in zip(uniq, bounds[:-1], bounds[1:]):
        u = int(u)
        i_tc, i_cr, i_dy = tc_index.get(u), cr_index.get(u), dy_index.get(u)
        sel = order[s:e]
        brems = 0.0
        if i_cr is not None:
            brems = float(
                cr[CREATION["energies"]][i_cr][CREATION["idx_ebrem"]]
            )
        yield DecayRecord(
            event_id=u,
            pixel=tt[TTRIGS["pixel"]][sel],
            det=tt[TTRIGS["det"]][sel],
            energy_kev=tt[TTRIGS["energy"]][sel],
            time_us=tt[TTRIGS["time"]][sel],
            p_found=bool(tc[TCOINC["p_found"]][i_tc]) if i_tc is not None else False,
            e_found=bool(tc[TCOINC["e_found"]][i_tc]) if i_tc is not None else False,
            recon_e_eng=float(tc[TCOINC["e_eng"]][i_tc]) if i_tc is not None else np.nan,
            recon_tof=float(tc[TCOINC["tof"]][i_tc]) if i_tc is not None else np.nan,
            te_true_kev=float(tc[TCOINC["eE0"]][i_tc]) if i_tc is not None else np.nan,
            tp_true_kev=(
                float(tc[TCOINC["pE0"]][i_tc]) * EV_TO_KEV  # eV -> keV !!
                if i_tc is not None
                else np.nan
            ),
            brems_kev=brems,
            dl_loss_kev=float(dy[DYNAMIC["dl_loss"]][i_dy]) if i_dy is not None else 0.0,
            bounces_e=int(dy[DYNAMIC["bounces_e"]][i_dy]) if i_dy is not None else 0,
            gamma_escape_kev=(
                float(dy[DYNAMIC["gamma_escape"]][i_dy]) if i_dy is not None else 0.0
            ),
        )
