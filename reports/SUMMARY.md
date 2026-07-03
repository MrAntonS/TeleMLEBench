# Nab ML research summary (toy-data phase)

_2026-07-03 · all results on the physics-motivated toy simulator
(50k events unless noted); pipeline is drop-in ready for the real
three-file simulation output via `loaders/root_loader.py`._

## What was built

End-to-end framework: toy generator emulating `ttrigs`-level data
(127-pixel hex geometry, allowed beta spectrum with the a = −0.105
p_p–E_e correlation, 30 keV proton line, backscatter / brems /
dead-layer / pile-up / noise topologies) → 10-class taxonomy with
priority rules → tcoinc reconstruction emulation → engineered features →
baselines (rule-based, GBDT, MLP) → multi-decoder GNN (event class +
per-trigger labels + physics tags + recon-residual regression) →
calibration → systematic-impact study. 30 tests enforce, among other
things, the ttrigs-only leakage boundary and padding invariance.

## Headline numbers

| model | accuracy | macro-F1 |
|---|---|---|
| rule-based cuts | 0.751 | 0.393 |
| MLP (no class weights) | 0.904 | 0.676 |
| GBDT (sqrt weights) | 0.906 | 0.711 |
| **NabGNN v2** (sqrt weights, macro-F1 selection) | **0.906** | **0.712** |
| GBDT + true-lost-energy cheat (ceiling) | 0.972 | 0.909 |

- Per-trigger label accuracy (GNN): **98.2%**.
- Residual regression: explains **43%** of d_eEng variance, **39%** of
  d_tof (corr ≈ 0.62–0.63).
- Calibration: temperature 0.55, test ECE **0.185 → 0.028**.

## Findings

1. **The hard confusion is physical, not architectural.**
   CLEAN ↔ {BS_LOST, BREMS, DEAD_LAYER} all present the same
   one-electron-trigger + one-proton-trigger pattern; they differ only by
   *invisible* lost energy. The cheat ceiling (+20 macro-F1 from the true
   lost energy) quantifies exactly how much information is absent at
   trigger level. Chasing argmax accuracy on these classes is the wrong
   objective — the veto/correction framing is the right one.
2. **Class-weighting is an operating-point choice, not a detail.** Full
   inverse-frequency weights collapsed clean-event recall to 0.43 (GNN
   v1 accuracy 0.53); sqrt weights + macro-F1 model selection fixed it
   (0.91) with no macro-F1 cost.
3. **GNN ≈ GBDT on the toy.** Expected: events are small and the
   engineered features nearly sufficient. The GNN's upside is on real
   data (richer structure, per-trigger outputs, joint residual head, and
   direct portability to waveform-level inputs later). The honest
   recommendation to the group stands: baseline first, GNN second.
4. **tcoinc's own windows create recoverable bias.** BS_SAME_DET is
   *detectable* (extra trigger) yet is the single largest energy-bias
   contributor (−7.6 of −20.1 keV) because the 200 ns / 2-ring sum
   misses re-entry deposits. A wider deterministic sum window would
   recover much of this without ML; the ML veto/correction recovers it
   too.
5. **Accidentals dominate TOF bias** (−0.048 of −0.102 µs) and are
   almost fully removable: at calibrated P(clean) > 0.05 the TOF bias
   drops 99% with 100% clean-event efficiency.
6. **Error-budget deliverables work.**
   - *Veto*: two regimes — detectable contamination vanishes at any
     threshold (bias −20 → −9 keV at zero cost); the invisible-loss
     plateau then requires the correction head.
   - *Correction*: subtracting the predicted per-event residual takes
     the energy bias **−20.1 → −3.3 keV (84% removed)** and TOF bias
     −0.102 → +0.051 µs, with RMS reductions 73 → 53 keV and 2.9 → 2.1 µs.
7. **Ablations (20k events):** multi-task auxiliary heads and edge
   features are neutral on the toy for classification; the residual head
   is kept for its physics output, not as a booster. Domain shift is the
   real threat: a +5 keV threshold shift costs 5 macro-F1 points →
   augmentation-in-training is the next experiment.

8. **Augmented training helps, mildly but uniformly** (30k events):
   the augmented model wins on all four test suites — nominal
   0.706→0.709 mF1, +5 keV threshold 0.659→0.666, noise ×5
   0.676→**0.696**, accidentals ×2 0.706→0.708. No nominal-performance
   cost. Next iteration should *randomize* the augmentation strengths
   (threshold ~U(10,16) keV) instead of a fixed 12.5 keV copy.
9. **Spectrum-level extraction is wired up** (mock a-coefficient MLE on
   kinematically-inverted cos θ_eν). Two lessons from the first 4k-event
   pass: the 8–40 µs tcoinc window itself is a dominant *acceptance*
   distortion (must be modeled in any real fit — Δâ vs a same-selection
   truth reference isolates the reconstruction part), and resolving the
   scheme differences needs ≥100k events (stat err ~0.005 at 200k) —
   a 200k independent-sample run is in progress.

10. **Per-class correction quality** (test split): the residual head
    near-fully repairs BS_SAME_DET (−153 → +2.6 keV bias, RMS 200 → 75 —
    the re-entry trigger makes the loss computable) and helps
    BREMS/DEAD_LAYER means, but BS_LOST stays irreducible (−184 → −156)
    — consistent with the cheat ceiling. Crucially, the ungated
    correction *smears clean events* (RMS 1.4 → 6.4 keV).
11. **Gated correction is the right scheme**: apply the correction only
    when calibrated P(clean) < gate. At gate 0.30, 20% of events get
    corrected, 59% of the energy bias is removed (−20.1 → −8.2 keV), TOF
    bias drops −0.102 → +0.046 µs, and clean-event RMS stays at 2.0 keV
    (vs 6.4 ungated). The gate is the knob trading bias removal against
    clean-spectrum smearing — the working point should be chosen by its
    effect on the physics fit, which the mock a-extraction can now test.

## Next queue

- 200k-event extraction study (running): Δâ for raw / veto / corrected /
  gated-corrected.
- Randomized-strength augmentation; report as the Milestone-5 recipe.
- Scale test at 500k–1M events; GPU port is trivial (plain PyTorch).
- First contact with real files: run `root_loader.py` against
  `100M_DecaySet1`, validate branch names/units, re-run the pipeline.
