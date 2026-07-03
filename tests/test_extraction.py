import numpy as np
import pytest

from nab_ml import physics
from nab_ml.extraction import (
    A_TRUE,
    beta_of,
    cos_theta_from_observables,
    fit_a_mle,
    proton_momentum_from_tof,
)


def test_tof_inversion_roundtrip():
    rng = np.random.default_rng(0)
    te = physics.sample_electron_ke(rng, 2000)
    p_p, _ = physics.sample_proton_momentum(rng, te)
    tof = physics.proton_tof_us(p_p)  # no jitter
    p_back = proton_momentum_from_tof(tof)
    assert np.allclose(p_back, p_p, rtol=1e-9)


def test_cos_theta_roundtrip():
    rng = np.random.default_rng(1)
    te = physics.sample_electron_ke(rng, 5000)
    p_p, c_true = physics.sample_proton_momentum(rng, te)
    tof = physics.proton_tof_us(p_p)
    c_rec = cos_theta_from_observables(te, tof)
    assert np.nanmax(np.abs(c_rec - c_true)) < 1e-6


def test_mle_recovers_a_on_truth():
    rng = np.random.default_rng(2)
    te = physics.sample_electron_ke(rng, 200_000)
    p_p, c = physics.sample_proton_momentum(rng, te)
    a_hat, err = fit_a_mle(c, beta_of(te))
    assert err < 0.02
    assert abs(a_hat - A_TRUE) < 3 * err + 0.005, (a_hat, err)


def test_mle_sensitive_to_energy_bias():
    """A -30 keV shift in measured electron energy must bias a_hat."""
    rng = np.random.default_rng(3)
    te = physics.sample_electron_ke(rng, 100_000)
    p_p, _ = physics.sample_proton_momentum(rng, te)
    tof = physics.proton_tof_us(p_p)
    c_biased = cos_theta_from_observables(te - 30.0, tof)
    a_hat, err = fit_a_mle(c_biased, beta_of(te - 30.0))
    assert abs(a_hat - A_TRUE) > 5 * err  # clearly biased
