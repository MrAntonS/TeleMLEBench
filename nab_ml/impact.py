"""Systematic-impact analysis: how much does each event class bias the
physics reconstruction, and how much of that bias can the model remove?

The Nab observables are built from the proton-TOF spectrum (lambda, via
1/t_p^2) and the electron-energy spectrum (Fierz b).  Event topologies
that survive the tcoinc selection with a wrong eEng or TOF pull those
spectra.  This module produces:

  1. the per-class bias table: mean/width of d_eEng and d_tof per class,
     weighted by class abundance -> contribution to the total bias;
  2. the "ML veto" scenario: bias before vs after removing events the
     model flags as non-clean (at a chosen efficiency working point);
  3. the "ML correction" scenario: subtract the model's predicted
     per-event residual and quantify the leftover bias.

This is the piece that turns a classifier into an error-budget
instrument, and it is deliberately model-agnostic: pass any per-event
class prediction / residual prediction arrays.
"""

from __future__ import annotations

import numpy as np

from .taxonomy import CLASSES, CLASS_TO_IDX


def per_class_bias_table(
    event_class: np.ndarray,
    d_eeng: np.ndarray,
    d_tof: np.ndarray,
    selected: np.ndarray,
) -> list[dict]:
    """Rows of {class, abundance, mean/std of both residuals, weighted
    contribution to the total selected-sample bias}."""
    rows = []
    n_sel = max(int(selected.sum()), 1)
    for i, c in enumerate(CLASSES):
        m = selected & (event_class == i)
        k = int(m.sum())
        if k == 0:
            rows.append(dict(cls=c, n=0))
            continue
        de, dt = d_eeng[m], d_tof[m]
        rows.append(
            dict(
                cls=c,
                n=k,
                frac=k / n_sel,
                mean_de=float(np.nanmean(de)),
                std_de=float(np.nanstd(de)),
                mean_dt=float(np.nanmean(dt)),
                std_dt=float(np.nanstd(dt)),
                # contribution of this class to the overall sample bias
                contrib_de=float(np.nansum(de) / n_sel),
                contrib_dt=float(np.nansum(dt) / n_sel),
            )
        )
    return rows


def bias_summary(
    d_eeng: np.ndarray, d_tof: np.ndarray, selected: np.ndarray
) -> dict:
    de, dt = d_eeng[selected], d_tof[selected]
    return dict(
        n=int(selected.sum()),
        bias_de=float(np.nanmean(de)) if selected.any() else np.nan,
        bias_dt=float(np.nanmean(dt)) if selected.any() else np.nan,
        rms_de=float(np.sqrt(np.nanmean(de**2))) if selected.any() else np.nan,
        rms_dt=float(np.sqrt(np.nanmean(dt**2))) if selected.any() else np.nan,
    )


def ml_veto_scenario(
    event_class_true: np.ndarray,
    clean_prob: np.ndarray,
    d_eeng: np.ndarray,
    d_tof: np.ndarray,
    selected: np.ndarray,
    thresholds: np.ndarray | None = None,
) -> list[dict]:
    """Scan the 'keep if P(clean) > thr' working points.

    Reports, per threshold: retained fraction of truly-clean events
    (efficiency), residual bias of the kept sample, and the bias-removal
    factor vs no veto.  clean_prob comes from the classifier's
    CLEAN_COINC softmax output.
    """
    thresholds = (
        np.linspace(0.0, 0.95, 20) if thresholds is None else thresholds
    )
    base = bias_summary(d_eeng, d_tof, selected)
    clean_idx = CLASS_TO_IDX["CLEAN_COINC"]
    truly_clean = event_class_true == clean_idx
    out = []
    for thr in thresholds:
        keep = selected & (clean_prob > thr)
        s = bias_summary(d_eeng, d_tof, keep)
        denom_eff = max(int((selected & truly_clean).sum()), 1)
        out.append(
            dict(
                thr=float(thr),
                kept=int(keep.sum()),
                efficiency=float((keep & truly_clean).sum() / denom_eff),
                purity=float((keep & truly_clean).sum() / max(int(keep.sum()), 1)),
                bias_de=s["bias_de"],
                bias_dt=s["bias_dt"],
                bias_de_reduction=(
                    1.0 - abs(s["bias_de"]) / max(abs(base["bias_de"]), 1e-12)
                ),
                bias_dt_reduction=(
                    1.0 - abs(s["bias_dt"]) / max(abs(base["bias_dt"]), 1e-12)
                ),
            )
        )
    return out


def ml_correction_scenario(
    d_eeng: np.ndarray,
    d_tof: np.ndarray,
    pred_d_eeng: np.ndarray,
    pred_d_tof: np.ndarray,
    selected: np.ndarray,
) -> dict:
    """Subtract predicted residuals event-by-event; report leftover bias."""
    before = bias_summary(d_eeng, d_tof, selected)
    after = bias_summary(d_eeng - pred_d_eeng, d_tof - pred_d_tof, selected)
    return dict(before=before, after=after)


def impact_report_md(rows: list[dict], veto: list[dict], corr: dict) -> str:
    lines = [
        "## Systematic-impact study",
        "",
        "### Per-class contribution to reconstruction bias (selected events)",
        "",
        "| class | frac | ⟨d_eEng⟩ keV | σ | ⟨d_tof⟩ µs | σ | contrib d_eEng | contrib d_tof |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        if r.get("n", 0) == 0:
            lines.append(f"| {r['cls']} | – | – | – | – | – | – | – |")
        else:
            lines.append(
                f"| {r['cls']} | {r['frac']*100:.2f}% | {r['mean_de']:+.2f} | "
                f"{r['std_de']:.2f} | {r['mean_dt']:+.3f} | {r['std_dt']:.3f} | "
                f"{r['contrib_de']:+.3f} | {r['contrib_dt']:+.4f} |"
            )
    lines += [
        "",
        "### ML-veto working points (keep if P(clean) > thr)",
        "",
        "| thr | kept | eff(clean) | purity | bias d_eEng keV | bias d_tof µs | ΔeEng bias removed | Δtof bias removed |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for v in veto:
        lines.append(
            f"| {v['thr']:.2f} | {v['kept']} | {v['efficiency']:.3f} | "
            f"{v['purity']:.3f} | {v['bias_de']:+.3f} | {v['bias_dt']:+.4f} | "
            f"{v['bias_de_reduction']*100:.1f}% | {v['bias_dt_reduction']*100:.1f}% |"
        )
    b, a = corr["before"], corr["after"]
    lines += [
        "",
        "### ML-correction scenario (subtract predicted residual)",
        "",
        f"- bias d_eEng: {b['bias_de']:+.3f} → **{a['bias_de']:+.3f}** keV; "
        f"RMS {b['rms_de']:.2f} → **{a['rms_de']:.2f}**",
        f"- bias d_tof: {b['bias_dt']:+.4f} → **{a['bias_dt']:+.4f}** µs; "
        f"RMS {b['rms_dt']:.3f} → **{a['rms_dt']:.3f}**",
        "",
    ]
    return "\n".join(lines)
