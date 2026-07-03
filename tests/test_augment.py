import numpy as np
import pytest

from nab_ml.augment import inject_noise, overlay_accidentals, vary_threshold
from nab_ml.taxonomy import CLASS_TO_IDX, TRIG_TO_IDX
from nab_ml.toysim import NabToySimulator, SimConfig


@pytest.fixture(scope="module")
def ds():
    return NabToySimulator(SimConfig(seed=3, n_events=800)).generate()


def test_threshold_variation_drops_triggers(ds):
    out = vary_threshold(ds, 25.0)
    assert len(out.trig_event) < len(ds.trig_event)
    assert (out.trig_energy >= 25.0).all()
    # 25 keV kills nothing proton-like (~27 keV) but a higher cut does
    out2 = vary_threshold(ds, 35.0)
    assert (out2.event_class == CLASS_TO_IDX["MISSED_PROTON"]).sum() > (
        ds.event_class == CLASS_TO_IDX["MISSED_PROTON"]
    ).sum()


def test_noise_injection(ds):
    out = inject_noise(ds, rate_per_event=1.0, seed=1)
    added = len(out.trig_event) - len(ds.trig_event)
    assert added > 500  # ~1 per event
    # events keep contiguous grouping after lexsort
    assert (np.diff(out.trig_event) >= 0).all()
    noisy_clean = (ds.event_class == CLASS_TO_IDX["CLEAN_COINC"]) & (
        out.event_class == CLASS_TO_IDX["NOISE_CONTAM"]
    )
    assert noisy_clean.sum() > 100


def test_overlay_accidentals(ds):
    out = overlay_accidentals(ds, frac=0.2, seed=2)
    n_acc = (out.event_class == CLASS_TO_IDX["ACCIDENTAL"]).sum()
    assert n_acc >= int(0.2 * ds.n_events) * 0.9
    pu = out.trig_label == TRIG_TO_IDX["PILEUP_OTHER"]
    assert pu.sum() > len(ds.trig_event) * 0.1
    # truth of the host event unchanged
    assert np.array_equal(out.te_true, ds.te_true)
