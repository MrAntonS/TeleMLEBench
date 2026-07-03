"""Evaluation utilities: confusion matrices, per-class metrics, residuals."""

from __future__ import annotations

import numpy as np

from .taxonomy import CLASSES


def confusion(y_true: np.ndarray, y_pred: np.ndarray, n: int) -> np.ndarray:
    cm = np.zeros((n, n), dtype=np.int64)
    np.add.at(cm, (y_true, y_pred), 1)
    return cm


def per_class_metrics(cm: np.ndarray) -> dict:
    tp = np.diag(cm).astype(float)
    prec = tp / np.maximum(cm.sum(axis=0), 1)
    rec = tp / np.maximum(cm.sum(axis=1), 1)
    f1 = np.where(prec + rec > 0, 2 * prec * rec / np.maximum(prec + rec, 1e-12), 0.0)
    support = cm.sum(axis=1)
    return {
        "precision": prec,
        "recall": rec,
        "f1": f1,
        "support": support,
        "accuracy": tp.sum() / max(cm.sum(), 1),
        "macro_f1": f1[support > 0].mean() if (support > 0).any() else 0.0,
    }


def classification_report_md(
    y_true: np.ndarray, y_pred: np.ndarray, title: str
) -> str:
    cm = confusion(y_true, y_pred, len(CLASSES))
    m = per_class_metrics(cm)
    lines = [
        f"### {title}",
        "",
        f"accuracy **{m['accuracy']:.4f}**, macro-F1 **{m['macro_f1']:.4f}**",
        "",
        "| class | precision | recall | F1 | support |",
        "|---|---|---|---|---|",
    ]
    for i, c in enumerate(CLASSES):
        lines.append(
            f"| {c} | {m['precision'][i]:.3f} | {m['recall'][i]:.3f} "
            f"| {m['f1'][i]:.3f} | {m['support'][i]} |"
        )
    lines.append("")
    return "\n".join(lines)


def confusion_md(y_true: np.ndarray, y_pred: np.ndarray) -> str:
    cm = confusion(y_true, y_pred, len(CLASSES))
    short = [c[:9] for c in CLASSES]
    lines = ["| true \\ pred | " + " | ".join(short) + " |"]
    lines.append("|" + "---|" * (len(CLASSES) + 1))
    for i, c in enumerate(short):
        lines.append(f"| **{c}** | " + " | ".join(str(v) for v in cm[i]) + " |")
    lines.append("")
    return "\n".join(lines)


def residual_report(
    d_pred: np.ndarray, d_true: np.ndarray, mask: np.ndarray, name: str
) -> str:
    """How well does the model predict the recon residual (systematic error)?"""
    p, t = d_pred[mask], d_true[mask]
    if len(t) == 0:
        return f"{name}: no valid events\n"
    rmse_model = float(np.sqrt(np.mean((p - t) ** 2)))
    rmse_null = float(np.sqrt(np.mean(t**2)))  # predicting 0 residual
    corr = float(np.corrcoef(p, t)[0, 1]) if len(t) > 2 else float("nan")
    return (
        f"- **{name}**: RMSE(model) = {rmse_model:.4g}, RMSE(null=0) = "
        f"{rmse_null:.4g}, corr = {corr:.3f}, "
        f"explained = {(1 - (rmse_model / max(rmse_null, 1e-12)) ** 2) * 100:.1f}%\n"
    )
