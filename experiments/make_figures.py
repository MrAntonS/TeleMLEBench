"""Generate report figures from the saved toy dataset."""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nab_ml.plots import fig_class_distribution, fig_residuals_by_class
from nab_ml.recon import residuals, run_tcoinc
from nab_ml.toysim import load_dataset

ROOT = Path(__file__).resolve().parents[1]
FIGS = ROOT / "reports" / "figures"
FIGS.mkdir(exist_ok=True)

ds = load_dataset(str(ROOT / "data" / "toy_v1.npz"))
rec = run_tcoinc(ds)
res = residuals(ds, rec)
sel = rec.e_found & ~np.isnan(res["d_eEng"])

fig_class_distribution(ds.event_class, FIGS / "class_distribution.png")
fig_residuals_by_class(
    ds.event_class, res["d_eEng"], res["d_tof"], sel,
    FIGS / "residuals_by_class.png",
)
print(f"figures -> {FIGS}")
