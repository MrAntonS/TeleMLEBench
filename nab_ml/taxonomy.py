"""Event-topology taxonomy for Nab decay events.

This is the ~10-class scheme from the classification-methodology plan.
For toy data the labels come from generator truth; for the real files the
same classes are assigned by the labeling pipeline via eventID joins
(creationEnergyTree[eBrem] -> BREMS, exitsTree+hits -> backscatter,
dynamicTree DLLoss -> DEAD_LAYER, killedEve -> lost particles, ...).

Priority matters: an event can be both backscattered and Brems-affected;
we assign the class highest in `CLASS_PRIORITY` (the one that most
distorts reconstruction), and keep the full multi-hot tag vector as
auxiliary supervision (the NuGraph2-style multi-decoder consumes both).
"""

from __future__ import annotations

from dataclasses import dataclass

# --- Event classes (graph-level target) -----------------------------------

CLASSES = [
    "CLEAN_COINC",        # 0: 1 electron trigger + 1 proton trigger, faithful
    "BS_SAME_DET",        # 1: electron backscatter, re-detected same detector
    "BS_OTHER_DET",       # 2: electron backscatter, re-detected other detector
    "BS_LOST",            # 3: electron backscatter escapes -> energy lost
    "BREMS_LOSS",         # 4: bremsstrahlung photon escapes -> energy lost
    "DEAD_LAYER_LOSS",    # 5: large dead-layer energy loss (invisible)
    "MISSED_PROTON",      # 6: electron seen, proton never triggers
    "MISSED_ELECTRON",    # 7: proton seen, electron never triggers
    "ACCIDENTAL",         # 8: pile-up of two decays within readout window
    "NOISE_CONTAM",       # 9: noise trigger contaminates a real event
]
CLASS_TO_IDX = {c: i for i, c in enumerate(CLASSES)}
N_CLASSES = len(CLASSES)

# Assignment priority when several tags apply (most-distorting first).
CLASS_PRIORITY = [
    "ACCIDENTAL",
    "MISSED_ELECTRON",
    "MISSED_PROTON",
    "BS_LOST",
    "BS_OTHER_DET",
    "BS_SAME_DET",
    "BREMS_LOSS",
    "DEAD_LAYER_LOSS",
    "NOISE_CONTAM",
    "CLEAN_COINC",
]
assert sorted(CLASS_PRIORITY) == sorted(CLASSES)

# --- Per-trigger labels (node-level target) --------------------------------

TRIGGER_LABELS = [
    "ELECTRON_PRIMARY",   # 0: first/main electron energy deposit
    "ELECTRON_BS",        # 1: backscatter re-entry deposit
    "PROTON",             # 2: proton trigger (~30 keV accelerated)
    "PILEUP_OTHER",       # 3: trigger belonging to the *other* decay in pile-up
    "NOISE",              # 4: electronic noise trigger
]
TRIG_TO_IDX = {t: i for i, t in enumerate(TRIGGER_LABELS)}
N_TRIGGER_LABELS = len(TRIGGER_LABELS)

# --- Physics tags (multi-hot auxiliary supervision) ------------------------

TAGS = [
    "backscatter",
    "bs_lost",
    "brems",
    "dead_layer",
    "missed_proton",
    "missed_electron",
    "pileup",
    "noise",
]
TAG_TO_IDX = {t: i for i, t in enumerate(TAGS)}
N_TAGS = len(TAGS)


@dataclass
class EventTruth:
    """Generator/g4track truth needed for labels + regression targets."""

    te_true: float          # true electron KE (keV)
    tof_true: float         # true proton TOF (us)
    e_detected: float       # total electron energy actually deposited in active Si
    tags: dict[str, bool]   # physics tags


def assign_class(tags: dict[str, bool]) -> int:
    """Map a tag dict to the single event class via priority."""
    tag_to_class = {
        "pileup": "ACCIDENTAL",
        "missed_electron": "MISSED_ELECTRON",
        "missed_proton": "MISSED_PROTON",
        "bs_lost": "BS_LOST",
        "bs_other_det": "BS_OTHER_DET",
        "bs_same_det": "BS_SAME_DET",
        "brems": "BREMS_LOSS",
        "dead_layer": "DEAD_LAYER_LOSS",
        "noise": "NOISE_CONTAM",
    }
    for cls in CLASS_PRIORITY:
        if cls == "CLEAN_COINC":
            continue
        for tag, mapped in tag_to_class.items():
            if mapped == cls and tags.get(tag, False):
                return CLASS_TO_IDX[cls]
    return CLASS_TO_IDX["CLEAN_COINC"]
