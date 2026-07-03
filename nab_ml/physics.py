"""Neutron beta-decay kinematics for the Nab toy simulation.

All energies are in keV unless a name says otherwise (the real files mix
eV and keV -- pE0 is in eV! -- so this package standardizes on keV at
the loader boundary).

The toy model is not a Geant4 replacement; it exists so that the ML
pipeline (labeling -> features -> baseline -> GNN -> systematic-impact
study) can be built and validated end-to-end with physically sensible
correlations, then pointed at the real simulation files.
"""

from __future__ import annotations

import numpy as np

M_E = 510.99895  # electron mass, keV
M_P = 938272.088  # proton mass, keV
E0_KE = 782.347  # beta-decay electron kinetic-energy endpoint, keV
PROTON_ACCEL_KEV = 30.0  # -30 kV post-acceleration onto the upper detector
TOF_LENGTH_M = 5.1  # effective proton flight path (decay volume -> upper det)

C_M_PER_US = 299.792458  # speed of light in m/us


def beta_spectrum_pdf(te: np.ndarray) -> np.ndarray:
    """Allowed-shape beta spectrum dN/dT (unnormalized), Fermi function ~ 1."""
    te = np.asarray(te, dtype=np.float64)
    etot = te + M_E
    p = np.sqrt(np.maximum(etot**2 - M_E**2, 0.0))
    out = p * etot * (E0_KE - te) ** 2
    out[(te <= 0) | (te >= E0_KE)] = 0.0
    return out


def sample_electron_ke(rng: np.random.Generator, n: int) -> np.ndarray:
    """Sample electron kinetic energies from the allowed beta spectrum
    (rejection sampling)."""
    out = np.empty(n)
    # max of pdf: scan once
    grid = np.linspace(1.0, E0_KE - 1.0, 2000)
    fmax = beta_spectrum_pdf(grid).max() * 1.05
    filled = 0
    while filled < n:
        m = (n - filled) * 2 + 16
        te = rng.uniform(0.0, E0_KE, m)
        u = rng.uniform(0.0, fmax, m)
        acc = te[u < beta_spectrum_pdf(te)]
        k = min(len(acc), n - filled)
        out[filled : filled + k] = acc[:k]
        filled += k
    return out


def electron_momentum(te: np.ndarray) -> np.ndarray:
    """Relativistic momentum (keV/c) from kinetic energy (keV)."""
    etot = np.asarray(te) + M_E
    return np.sqrt(np.maximum(etot**2 - M_E**2, 0.0))


def sample_proton_momentum(
    rng: np.random.Generator, te: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Sample proton momentum given electron KE via 3-body kinematics.

    Neglecting the ~0.75 keV recoil energy in the energy balance, the
    neutrino carries E_nu ~ (E0 - Te) and momentum p_nu = E_nu.  Momentum
    conservation gives p_p^2 = p_e^2 + p_nu^2 + 2 p_e p_nu cos(theta_e_nu).
    We sample cos(theta_e_nu) with the `a`-dependent correlation
    dW ~ 1 + a * beta * cos(theta),  a = -0.105 (the very parameter Nab
    measures), which imprints the physical p_p--E_e correlation onto the
    proton TOF that the residual-regression head must learn about.

    Returns (p_p [keV/c], cos_theta_e_nu).
    """
    te = np.asarray(te, dtype=np.float64)
    a_coeff = -0.105
    p_e = electron_momentum(te)
    e_tot = te + M_E
    beta = np.where(e_tot > 0, p_e / e_tot, 0.0)
    p_nu = np.maximum(E0_KE - te, 0.0)

    # Sample cos(theta) from pdf ~ (1 + a*beta*c)/2 on [-1, 1] via inverse CDF.
    u = rng.uniform(0.0, 1.0, te.shape)
    ab = a_coeff * beta
    # CDF(c) = (c + 1)/2 + ab*(c^2 - 1)/4 ; solve quadratic, fall back to
    # uniform when ab ~ 0.
    with np.errstate(divide="ignore", invalid="ignore"):
        disc = (1.0 + ab) ** 2 - 4.0 * (ab / 2.0) * (1.0 - ab / 2.0 - 2.0 * u)
        c = np.where(
            np.abs(ab) < 1e-9,
            2.0 * u - 1.0,
            (-(1.0 + ab) + np.sqrt(np.maximum(disc, 0.0))) / ab,
        )
    c = np.clip(c, -1.0, 1.0)
    p_p2 = p_e**2 + p_nu**2 + 2.0 * p_e * p_nu * c
    return np.sqrt(np.maximum(p_p2, 1e-12)), c


def proton_ke_kev(p_p: np.ndarray) -> np.ndarray:
    """Proton kinetic energy in keV (non-relativistic is fine: <1 keV)."""
    return np.asarray(p_p) ** 2 / (2.0 * M_P)


def proton_tof_us(p_p: np.ndarray, rng: np.random.Generator | None = None) -> np.ndarray:
    """Proton time of flight in microseconds.

    Nab reconstructs 1/t_p^2 ~ p_p^2; the toy uses straight-line flight
    over TOF_LENGTH_M at the initial velocity plus a small transit-time
    spread standing in for the field expansion / acceleration region.
    """
    p_p = np.asarray(p_p, dtype=np.float64)
    v_over_c = p_p / M_P  # non-relativistic
    t = TOF_LENGTH_M / (np.maximum(v_over_c, 1e-9) * C_M_PER_US)
    if rng is not None:
        t = t * rng.normal(1.0, 0.01, t.shape)  # ~1% transit-time spread
    return t
