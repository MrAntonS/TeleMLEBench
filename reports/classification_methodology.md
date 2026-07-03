# Nab event-classification methodology (draft for working session)

Purpose: a deterministic rulebook mapping simulation output (three-file
layout, joined on `eventID`) to (a) one event class per decay, (b) one
label per trigger, (c) regression targets. This is the labeling pipeline
the ML supervision comes from; the model itself never sees anything
beyond `ttrigs`.

## Inputs per event (after eventID join)

| source | tree | used for |
|---|---|---|
| trigCoincs.root | ttrigs | **model input** (pixel, energy, time, DetID) |
| trigCoincs.root | tcoinc | recon quantities + truth (x0..z0, eE0, **pE0 in eV → keV!**, cosθ) |
| g4track.root | creationEnergyTree | index 9 = eBrem → brems tag |
| g4track.root | exitsTree (+hits) | backscatter / escape tags |
| g4track.root | eDepTree, dynamicTree | dead-layer loss, bounces, GammaEscape |
| g4track.root | killedEve | lost-particle flags |
| hits.root | hits | per-trigger label attribution (parent lineage) |

Do **not** use tofTree (may not exist in production sets).

## Event classes (priority-ordered; first match wins)

```
def classify(event):
    if overlaps_other_decay(event):            return ACCIDENTAL
    if not electron_triggered(event):          return MISSED_ELECTRON
    if not proton_triggered(event):            return MISSED_PROTON
    if backscattered(event):
        if bs_energy_escaped(event):           return BS_LOST
        if reentry_detector != first_detector: return BS_OTHER_DET
        else:                                  return BS_SAME_DET
    if brems_escape_kev(event) > 10:           return BREMS_LOSS
    if dead_layer_loss_kev(event) > 5:         return DEAD_LAYER_LOSS
    if has_noise_trigger(event):               return NOISE_CONTAM
    return CLEAN_COINC
```

Predicate implementations on real files:

* `electron_triggered`: any ttrigs entry whose hit lineage traces to the
  decay electron with energy ≥ threshold.
* `proton_triggered`: ttrigs entry from the proton (≈30 keV accelerated
  line, upper detector).
* `backscattered`: exitsTree has the primary electron leaving a detector
  volume after depositing energy in it (pair exit records with hits);
  `bs_energy_escaped` if it never re-enters (cross-check killedEve).
* `brems_escape_kev`: creationEnergyTree energies[9] (eBrem) minus any
  brems energy re-absorbed in active Si (from hits by photon descendants);
  dynamicTree GammaEscape/GammaLoss is the cross-check.
* `dead_layer_loss_kev`: eDepTree dead-layer sums (DetID ±11) /
  dynamicTree DLLoss.
* `overlaps_other_decay`: only from overlay augmentation (or measured
  pile-up) — in single-decay simulation this tag comes from the mixing
  procedure itself.

Priority = "most distorting first": pile-up > missing particle >
backscatter > brems > dead layer > noise. An event keeps ALL tags as a
multi-hot vector for auxiliary supervision; the single class is for the
headline confusion matrix.

## Per-trigger labels

ELECTRON_PRIMARY, ELECTRON_BS (re-entry deposit), PROTON, PILEUP_OTHER
(trigger from the other decay in a mixed event), NOISE. Assigned by hit
lineage: trace each ttrigs entry's constituent hits to the original decay
product (hits.root parentID/trackID chain, as Jin's merging already does).

## Regression targets (systematic-error hook)

For events where the tcoinc scheme finds a coincidence:

* `d_eEng = eEng_recon − eE0` (keV)
* `d_tof  = TOF_recon − TOF_true` (µs)

These are exactly the per-event biases of the current reconstruction;
the model head that predicts them from trigger patterns is what turns
classification into an error-budget instrument.

## Sanity checks on labeled frequencies

* CLEAN_COINC should dominate (tens of %); ~1% eBrem above tag threshold;
  backscatter tags of order 10%; accidentals set by the mixing rate.
* Class frequencies vs. electron energy: backscatter probability falls
  with energy; missed-proton is ~flat; brems rises with energy.
* Residual distributions: lossy classes (BS_LOST, BREMS_LOSS,
  DEAD_LAYER_LOSS) must show negative d_eEng tails; ACCIDENTAL shows a
  flat d_tof background.

## Leakage audit

Inference-time features: ttrigs columns only (pixel, DetID sign, energy,
time). Forbidden at inference: anything from g4track/hits/tcoinc-truth,
DetID ±11 rows, thresholds re-derived from truth. Enforced by a
regression test that permutes truth columns and asserts model inputs are
unchanged.
