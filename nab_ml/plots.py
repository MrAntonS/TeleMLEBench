"""Report figures (matplotlib, Agg backend)."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from .taxonomy import CLASSES


def fig_class_distribution(event_class: np.ndarray, path: Path):
    frac = np.bincount(event_class, minlength=len(CLASSES)) / len(event_class)
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.barh(range(len(CLASSES)), frac * 100, color="#4477aa")
    ax.set_yticks(range(len(CLASSES)), CLASSES, fontsize=8)
    ax.set_xlabel("fraction of events [%]")
    ax.set_xscale("log")
    ax.invert_yaxis()
    ax.set_title("Event-class abundances (toy)")
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def fig_residuals_by_class(
    event_class: np.ndarray,
    d_eeng: np.ndarray,
    d_tof: np.ndarray,
    selected: np.ndarray,
    path: Path,
):
    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    for i, c in enumerate(CLASSES):
        m = selected & (event_class == i)
        if m.sum() < 20:
            continue
        axes[0].hist(
            np.clip(d_eeng[m], -400, 50), bins=60, histtype="step",
            label=c, density=True,
        )
        axes[1].hist(
            np.clip(d_tof[m], -2, 30), bins=60, histtype="step", density=True,
        )
    axes[0].set_xlabel("d_eEng = recon − truth [keV]")
    axes[0].set_yscale("log")
    axes[1].set_xlabel("d_tof = recon − truth [µs]")
    axes[1].set_yscale("log")
    axes[0].legend(fontsize=6)
    fig.suptitle("Reconstruction residuals by true class (tcoinc emulation)")
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def fig_confusion(cm: np.ndarray, title: str, path: Path):
    n = cm.shape[0]
    norm = cm / np.maximum(cm.sum(axis=1, keepdims=True), 1)
    fig, ax = plt.subplots(figsize=(7, 6))
    im = ax.imshow(norm, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(n), [c[:9] for c in CLASSES], rotation=45, ha="right", fontsize=7)
    ax.set_yticks(range(n), [c[:9] for c in CLASSES], fontsize=7)
    for i in range(n):
        for j in range(n):
            if norm[i, j] > 0.005:
                ax.text(j, i, f"{norm[i, j]:.2f}", ha="center", va="center",
                        fontsize=6, color="white" if norm[i, j] > 0.5 else "black")
    ax.set_xlabel("predicted")
    ax.set_ylabel("true")
    ax.set_title(title)
    fig.colorbar(im, shrink=0.8)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def fig_veto_scan(veto: list[dict], path: Path):
    thr = [v["thr"] for v in veto]
    fig, ax1 = plt.subplots(figsize=(7, 4))
    ax1.plot(thr, [abs(v["bias_de"]) for v in veto], "o-", color="#cc3311",
             label="|bias d_eEng| [keV]")
    ax1.set_xlabel("P(clean) veto threshold")
    ax1.set_ylabel("|bias d_eEng| [keV]", color="#cc3311")
    ax2 = ax1.twinx()
    ax2.plot(thr, [v["efficiency"] for v in veto], "s-", color="#4477aa",
             label="clean efficiency")
    ax2.plot(thr, [v["purity"] for v in veto], "^-", color="#228833",
             label="purity")
    ax2.set_ylabel("efficiency / purity")
    ax2.legend(loc="center left", fontsize=8)
    ax1.set_title("ML-veto working-point scan")
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
