# Final report — CDSCNN reproduction (RadioML2016.10a)

## Result
- Reproduced (2-seed mean) test OA: **59.11%** (seeds: 58.22%, 60.00%), n=22,000.
- Paper reported (Table II, Sec. III-F, abstract): **62.63%** (10-run mean). Difference: **-3.52 pp**.
- macro-F1 0.6077, kappa 0.5502. Avg accuracy 0..18 dB: 86.94% (paper 91.60%); max 88.14% at 8 dB
  (paper 93.19% at 12 dB). Low-SNR behavior matches qualitatively (~chance at -20..-16 dB, rising
  steeply from -10 dB; -14..-2 dB mean ≈ 43.5% vs paper's 43.62% — nearly exact).
- Per-SNR curve shape, confusion structure (WBFM/AM-DSB, 16-/64-QAM confusions), and model size
  (0.335M vs 0.33M reported) all reproduce.

## Verdict
**Partially reproducible.** The method as disclosed trains stably, learns genuine complex-valued
features (val acc ~60% vs 9.1% chance; train loss << ln 11), and reaches the same complexity and the
same qualitative performance profile — but falls **~3.5 pp short** of the reported OA under an
honest single-pass protocol. The gap is consistent with documented budget-driven deviations
(batch 1024/512 vs 128; 2 runs vs 10-run mean; inferred Fig. 3 widths), not with an implementation
failure: validation OA (59.8%) already trailed the paper's validation OA (62.47%) before any test
data was seen, and test (59.11%) matches validation, i.e. no overfitting to test.

## Pre-freeze verification (all passed, test set untouched until final_evaluate.py)
- (a) Learns: pilot train loss 1.76->1.16 (<<2.40), val 9%->49.6% in 5 epochs on 20k subset;
  full runs train loss ~0.9, val acc 58-60%.
- (b) Architecture matches paper: all Eq.(1)-(10),(17) units implemented; 7 CDSC blocks (Fig. 4
  optimum); param count 0.335M vs Table I 0.33M.
- (c) Loss/metric code verified against sklearn on toy inputs (CE == log_loss to 1e-6).

## What the paper omits (see MISSING_PARAMETERS.md)
Split seed; exact per-layer widths (Fig. 3 labels partial); CMP kernel/stride; shortcut form;
CBN momentum/eps; init; cosine-schedule exact form; precision/recall averaging. Each choice is
tagged paper/inferred in FROZEN_CONFIG.json.

## Budget compromises
Batch 1024/512 instead of 128 (shared-GPU throughput; full run ~35 epochs would otherwise exceed
the 60-min budget); 2 seeds instead of 10-run mean; no 10b cross-dataset experiment (out of scope
for the RML2016.10a result).

## Artifacts
FROZEN_CONFIG.json (hashes verified by final_evaluate.py), TRAINING_HISTORY.csv (36 epochs, 2 runs),
RESULTS.json, results/test_predictions.npz (y_true, y_pred[2 runs], snr), logs/, checkpoints/.
