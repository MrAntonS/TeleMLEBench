"""Mock a-coefficient extraction: the spectrum-level systematic test.

Nab infers a (and thence lambda) from the correlation between electron
energy and proton momentum.  In the toy the generator samples
cos(theta_e_nu) from pdf (1 + a*beta*c)/2 with a = -0.105, so we can run
the full inverse analysis on reconstructed quantities:

  1. invert kinematics per event:  p_p^2 = p_e^2 + p_nu^2 + 2 p_e p_nu c
     with p_p from the measured TOF, p_e/p_nu from the measured electron
     energy  ->  c_recon;
  2. maximum-likelihood fit of a on the c_recon sample;
  3. compare a_hat across scenarios: truth quantities, raw tcoinc recon,
     recon + calibrated ML veto, recon + ML residual correction.

Delta-a between a scenario and the truth-quantities reference is THE
spectrum-level systematic of that reconstruction scheme in the toy.
"""

from __future__ import annotations

import numpy as np

from . import physics

A_TRUE = -0.105  # generator value (physics.sample_proton_momentum)


def proton_momentum_from_tof(tof_us: np.ndarray) -> np.ndarray:
    """Invert the toy TOF model: p_p [keV/c] from t [us]."""
    v_over_c = physics.TOF_LENGTH_M / (np.asarray(tof_us) * physics.C_M_PER_US)
    return v_over_c * physics.M_P


def cos_theta_from_observables(
    e_eng_kev: np.ndarray, tof_us: np.ndarray
) -> np.ndarray:
    """Reconstructed cos(theta_e_nu) from measured (E_e, TOF)."""
    te = np.asarray(e_eng_kev, dtype=np.float64)
    p_e = physics.electron_momentum(np.clip(te, 1e-3, physics.E0_KE - 1e-3))
    p_nu = np.maximum(physics.E0_KE - te, 1e-3)
    p_p = proton_momentum_from_tof(tof_us)
    c = (p_p**2 - p_e**2 - p_nu**2) / (2.0 * p_e * p_nu)
    return c


def beta_of(te_kev: np.ndarray) -> np.ndarray:
    te = np.clip(np.asarray(te_kev, dtype=np.float64), 1e-3, None)
    etot = te + physics.M_E
    return physics.electron_momentum(te) / etot


def fit_a_mle(
    cos_theta: np.ndarray,
    beta: np.ndarray,
    clip: float = 1.0,
    tol: float = 1e-10,
    max_iter: int = 100,
) -> tuple[float, float]:
    """MLE of a for pdf (1 + a*beta*c)/2 on c in [-1,1].

    Events with |c_recon| > clip (unphysical, from mis-reconstruction)
    are dropped -- exactly what the real analysis would do.
    Returns (a_hat, stat_error).
    """
    c = np.asarray(cos_theta, dtype=np.float64)
    b = np.asarray(beta, dtype=np.float64)
    m = np.isfinite(c) & (np.abs(c) <= clip) & np.isfinite(b)
    x = b[m] * c[m]
    if len(x) < 100:
        return np.nan, np.nan

    a = A_TRUE  # start near expectation; likelihood is concave in a
    for _ in range(max_iter):
        denom = 1.0 + a * x
        # keep the pdf positive
        denom = np.clip(denom, 1e-6, None)
        g = np.sum(x / denom)          # dL/da
        h = -np.sum((x / denom) ** 2)  # d2L/da2 < 0
        step = g / h
        a_new = a - step
        a_new = float(np.clip(a_new, -0.99, 0.99))
        if abs(a_new - a) < tol:
            a = a_new
            break
        a = a_new
    err = float(1.0 / np.sqrt(-h)) if h < 0 else np.nan
    return float(a), err


def extract_scenarios(
    te_true: np.ndarray,
    tof_true: np.ndarray,
    e_recon: np.ndarray,
    tof_recon: np.ndarray,
    selected: np.ndarray,
    veto_mask: np.ndarray | None = None,
    e_corr: np.ndarray | None = None,
    tof_corr: np.ndarray | None = None,
) -> dict[str, dict]:
    """Run the a-extraction under the standard scenario set.

    e_corr/tof_corr are the ML-corrected observables (recon - predicted
    residual). All arrays are per-event over the same sample; `selected`
    marks events where the tcoinc recon produced a coincidence.
    """
    out = {}

    def run(name, te, tof, mask):
        c = cos_theta_from_observables(te[mask], tof[mask])
        b = beta_of(te[mask])
        a, err = fit_a_mle(c, b)
        out[name] = dict(
            a=a, err=err, n=int(mask.sum()),
            frac_unphys=float(np.mean(np.abs(c) > 1)) if mask.any() else np.nan,
        )

    run("truth", te_true, tof_true, selected)
    run("recon raw", e_recon, tof_recon, selected)
    if veto_mask is not None:
        run("recon + veto", e_recon, tof_recon, selected & veto_mask)
    if e_corr is not None and tof_corr is not None:
        run("recon + correction", e_corr, tof_corr, selected)
        if veto_mask is not None:
            run("recon + veto + corr", e_corr, tof_corr, selected & veto_mask)
    return out


def extraction_report_md(res: dict[str, dict]) -> str:
    ref = res.get("truth", {}).get("a", np.nan)
    lines = [
        "## Mock a-coefficient extraction",
        "",
        f"generator a = **{A_TRUE}**; truth-quantities reference "
        f"â = {ref:.5f} (toy-model floor)",
        "",
        "| scenario | â | stat err | Δâ vs truth-ref | n events | unphysical c |",
        "|---|---|---|---|---|---|",
    ]
    for name, r in res.items():
        d = r["a"] - ref
        lines.append(
            f"| {name} | {r['a']:.5f} | {r['err']:.5f} | {d:+.5f} | "
            f"{r['n']:,} | {r['frac_unphys'] * 100:.1f}% |"
        )
    lines.append("")
    return "\n".join(lines)
