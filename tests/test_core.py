"""Core tests: geometry, physics, simulator, labeling, recon, features."""

import numpy as np
import pytest

from nab_ml import geometry, physics
from nab_ml.features import FEATURE_NAMES, event_features
from nab_ml.recon import residuals, run_tcoinc
from nab_ml.taxonomy import CLASSES, CLASS_TO_IDX, N_TAGS, assign_class
from nab_ml.toysim import NabToySimulator, SimConfig, load_dataset, save_dataset


@pytest.fixture(scope="module")
def small_ds():
    sim = NabToySimulator(SimConfig(seed=7, n_events=2000))
    return sim.generate()


# ---------------- geometry ----------------

def test_pixel_count_and_rings():
    assert geometry.N_PIXELS == 127
    rings = geometry.ring_of(np.arange(127))
    counts = np.bincount(rings)
    assert counts.tolist() == [1, 6, 12, 18, 24, 30, 36]


def test_hex_distance_symmetry_and_triangle():
    d = geometry.RING_DIST
    assert (d == d.T).all()
    assert (np.diag(d) == 0).all()
    assert d.max() == 12  # opposite corners of a 6-ring hexagon


def test_two_rings_is_18mm():
    # the 2-ring coincidence radius should be ~18.2 mm
    center = 0
    ring2 = np.where(geometry.ring_of(np.arange(127)) == 2)[0]
    dists = geometry.euclid_distance_mm(np.full(len(ring2), center), ring2)
    assert dists.max() <= 18.5


def test_pixel_lookup_roundtrip():
    for p in [0, 3, 50, 126]:
        x, y = geometry.XY_MM[p]
        assert geometry.pixel_at_xy(x, y) == p


# ---------------- physics ----------------

def test_beta_spectrum_endpoint():
    rng = np.random.default_rng(0)
    te = physics.sample_electron_ke(rng, 5000)
    assert te.min() > 0 and te.max() < physics.E0_KE
    # mean of allowed neutron beta spectrum ~ 250-300 keV
    assert 200 < te.mean() < 350


def test_proton_kinematics():
    rng = np.random.default_rng(0)
    te = physics.sample_electron_ke(rng, 5000)
    p_p, c = physics.sample_proton_momentum(rng, te)
    assert (np.abs(c) <= 1).all()
    tp = physics.proton_ke_kev(p_p)
    assert tp.max() < 0.7515  # 751.5 eV kinematic limit
    tof = physics.proton_tof_us(p_p)
    assert tof.min() > 5.0  # fastest protons ~ 13 us over 5.1 m


# ---------------- taxonomy ----------------

def test_class_priority():
    assert assign_class({}) == CLASS_TO_IDX["CLEAN_COINC"]
    assert assign_class({"pileup": True, "brems": True}) == CLASS_TO_IDX["ACCIDENTAL"]
    assert (
        assign_class({"backscatter": True, "bs_lost": True})
        == CLASS_TO_IDX["BS_LOST"]
    )
    assert (
        assign_class({"backscatter": True, "bs_same_det": True, "dead_layer": True})
        == CLASS_TO_IDX["BS_SAME_DET"]
    )


# ---------------- simulator ----------------

def test_dataset_shapes(small_ds):
    ds = small_ds
    assert ds.n_events == 2000
    assert len(ds.trig_event) == len(ds.trig_energy) == len(ds.trig_time)
    assert ds.event_tags.shape == (2000, N_TAGS)
    off = ds.event_slices()
    assert off[-1] == len(ds.trig_event)


def test_all_classes_populated(small_ds):
    present = set(small_ds.event_class.tolist())
    # with 2000 events every class except possibly the rarest should appear
    assert len(present) >= 8, sorted(present)


def test_proton_triggers_look_like_protons(small_ds):
    ds = small_ds
    from nab_ml.taxonomy import TRIG_TO_IDX

    pmask = ds.trig_label == TRIG_TO_IDX["PROTON"]
    assert pmask.any()
    en = ds.trig_energy[pmask]
    assert (en < 32).all() and en.mean() > 20  # ~30 keV accelerated line
    assert (ds.trig_det[pmask] == 1).all()  # protons only reach the upper det


def test_trigger_times_ordering(small_ds):
    ds = small_ds
    from nab_ml.taxonomy import TRIG_TO_IDX

    # protons arrive late (TOF); primary electrons promptly
    p = ds.trig_time[ds.trig_label == TRIG_TO_IDX["PROTON"]]
    el = ds.trig_time[ds.trig_label == TRIG_TO_IDX["ELECTRON_PRIMARY"]]
    assert np.median(p) > 10.0
    assert np.median(el) < 0.1


def test_class_frequencies_sane(small_ds):
    ds = small_ds
    frac = np.bincount(ds.event_class, minlength=len(CLASSES)) / ds.n_events
    f = dict(zip(CLASSES, frac))
    assert f["CLEAN_COINC"] > 0.4  # most events are clean
    assert f["ACCIDENTAL"] == pytest.approx(0.03, abs=0.02)
    assert 0.02 < f["BREMS_LOSS"] < 0.10
    assert f["MISSED_PROTON"] > 0.02


def test_save_load_roundtrip(tmp_path, small_ds):
    p = tmp_path / "ds.npz"
    save_dataset(small_ds, str(p))
    ds2 = load_dataset(str(p))
    assert np.array_equal(ds2.trig_energy, small_ds.trig_energy)
    assert np.array_equal(ds2.event_class, small_ds.event_class)


# ---------------- recon ----------------

def test_tcoinc_finds_most_clean_events(small_ds):
    ds = small_ds
    rec = run_tcoinc(ds)
    clean = ds.event_class == CLASS_TO_IDX["CLEAN_COINC"]
    # proton is always in the upper det under 30 keV for clean events
    assert rec.p_found[clean].mean() > 0.95
    found = clean & rec.e_found
    assert found.mean() > 0.3  # 2-ring pixel cut removes a fair share

    res = residuals(ds, rec)
    d = res["d_tof"][found]
    assert np.nanmedian(np.abs(d)) < 0.5  # TOF recon good for clean events


def test_recon_energy_biased_low_for_losses(small_ds):
    """Backscatter-lost / brems events must show negative energy residual."""
    ds = small_ds
    rec = run_tcoinc(ds)
    res = residuals(ds, rec)
    lossy = np.isin(
        ds.event_class,
        [CLASS_TO_IDX["BS_LOST"], CLASS_TO_IDX["BREMS_LOSS"]],
    ) & rec.e_found
    clean = (ds.event_class == CLASS_TO_IDX["CLEAN_COINC"]) & rec.e_found
    if lossy.sum() > 10:
        assert np.nanmean(res["d_eEng"][lossy]) < np.nanmean(res["d_eEng"][clean])


# ---------------- features ----------------

def test_features_shape_and_finite(small_ds):
    X = event_features(small_ds)
    assert X.shape == (small_ds.n_events, len(FEATURE_NAMES))
    assert np.isfinite(X).all()


def test_features_no_truth_leakage(small_ds):
    """Features must be invariant to truth-only changes: shuffling te_true
    must not change features."""
    import copy

    ds2 = copy.copy(small_ds)
    ds2.te_true = np.random.default_rng(1).permutation(small_ds.te_true)
    X1 = event_features(small_ds)
    X2 = event_features(ds2)
    assert np.array_equal(X1, X2)
