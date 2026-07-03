# nab-ml — ML-assisted systematic-error framework for the Nab experiment

Event-topology classification and reconstruction-bias quantification for
Nab neutron-beta-decay data, from **trigger-level information only**
(the `ttrigs` schema: pixel, detector, energy, time).

The goal is not ML for its own sake: Nab's λ and Fierz-term measurements
require percent-level understanding of how misclassified topologies
(backscatter, bremsstrahlung, dead-layer loss, accidentals, missed
protons) bias the proton-TOF and electron-energy reconstruction. This
package builds that error budget with a multi-decoder GNN, benchmarked
against interpretable baselines.

## Layout

```
nab_ml/
  geometry.py        127-pixel hexagonal detector geometry, ring distances
  physics.py         beta-decay kinematics (allowed spectrum, p_p, TOF)
  toysim.py          toy generator emulating ttrigs-level data + truth labels
  taxonomy.py        ~10 event classes, per-trigger labels, physics tags
  recon.py           emulation of the current tcoinc reconstruction scheme
  features.py        engineered per-event features (leakage boundary!)
  models/baseline.py rule-based cuts, HistGradientBoosting, MLP
  models/gnn.py      multi-decoder message-passing GNN (pure PyTorch)
  train.py, eval.py  training loop, metrics, report helpers
  loaders/root_loader.py  uproot skeleton for the real 3-file layout
tests/               pytest suite (geometry/physics/labeling/GNN sanity)
experiments/         end-to-end experiment runners
reports/             generated markdown reports
```

## Quick start

```bash
pip install numpy scipy scikit-learn torch pytest
python -m pytest tests/ -q
python experiments/run_experiment.py 50000 40   # events, GNN epochs
```

## Design decisions

* **Toy simulator, not Geant4.** This environment has no access to the
  cluster ROOT files, so the pipeline is developed against a
  physics-motivated toy that reproduces the *structure* of the problem
  (trigger multiplicities, 30 keV proton line, 8–40 µs TOF window,
  backscatter/brems/dead-layer/accidental topologies, the a-coefficient
  p_p–E_e correlation). `loaders/root_loader.py` is the drop-in for real
  files — units (pE0 in eV!) and string quirks already handled.
* **Leakage boundary.** Model inputs are derivable from `ttrigs` only.
  Truth kinematics, g4track trees, and dead-layer info exist solely as
  labels/targets. A regression test enforces this.
* **Pure PyTorch GNN.** Events carry O(10) triggers, so dense padded
  batches with masking beat sparse PyG batching in simplicity and are
  trivially supportable; NVIDIA's own stack standardizes on
  PyTorch (Geometric) anyway, so nothing blocks a later port.
* **Multi-decoder (NuGraph2-style).** One message-passing engine, four
  heads: event class, per-trigger label, physics-tag multi-hot, and
  recon-residual regression (Δe-energy, ΔTOF) — the last one is the
  systematic-error hook.
