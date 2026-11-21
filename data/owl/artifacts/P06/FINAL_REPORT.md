# FINAL_REPORT.md — Independent reproduction of MCCFN on RadioML2016.10a

## Result
- Reproduced overall test accuracy: **62.02%** (macro-F1 0.6433, kappa 0.5822, n=22,000).
- Paper reported (Table 1, p.236; Abstract 63.415%): **63.41%**, F1 **0.6569**.
- Difference: **−1.39 pp accuracy / −0.0136 F1**. Close but not exact; paper's number
  not reconstructed within run-to-run noise.
- High-SNR (0..18 dB) mean: 91.06% vs paper's 92.37% (−1.31 pp); peak per-SNR 92.55%
  at 14 dB vs paper's 93.66%. Per-SNR curve shape matches paper Fig.2 (chance at
  −20 dB, steep rise −10..0 dB, plateau ~91-92% above 4 dB).

## How it was obtained (all from the paper + documented inferences)
- Architecture: multi-scale complex Conv1d (k7/5/3, 12 ch each, concat 36) + 4 stacked
  complex blocks (48/64/128/256, k3) + 2-head self-attention + GAP + FC(256,512) +
  dynamic dropout + FC(512,11). Complex conv = Eq.10 cross-terms via paired real convs.
  Params 273k vs reported 250k (+9%; dk/dv=64 inferred).
- Split: stratified per-(mod,SNR) 700/200/100, seed 42 (paper: "7:2:1", no detail).
- Training: Adam 0.001, batch 128, cross-entropy, 50 epochs, best checkpoint by min val
  loss (epoch 16: val loss 1.0441, val acc 62.26%; best val acc 62.37% epoch 26).
  Dual-trigger LR + dynamic dropout implemented literally per Algorithms 1-2 (per-epoch).
- Test set locked until freeze; evaluated once via src/final_evaluate.py (hash-verified).

## Why the gap (honest assessment)
1. Underspecified details (attention dk/dv, dropout placement, epochs, split seed/
   stratification) force guesses worth ±1-2 pp combined.
2. The paper's own LR schedule is very aggressive: train−val gap exceeds 0.01 almost
   always, and val-loss noise triggers Ces decay, collapsing lr 1e-3 -> ~1e-10 by epoch
   50 and pinning dropout at max 0.6 early. Training stalls after ~epoch 20; a milder
   schedule or longer high-lr phase would likely recover ~1 pp.
3. Single run (paper gives no seeds/error bars); run variance ~±0.5 pp.
4. Possible split mismatch (paper's 7:2:1 construction unknown).

## Verdict
Method is reproducible in structure and behavior (learning dynamics, SNR curves,
ablation directions plausible, complexity matched), but the exact 63.41% figure could
not be reconstructed from the publication alone; our faithful implementation lands
1.4 pp lower. The paper's reporting omits load-bearing details (attention dims, epochs,
split procedure) needed for exact replication.

## Artifacts
- FROZEN_CONFIG.json (frozen hyperparams + source hashes), TRAINING_HISTORY.csv,
  RESULTS.json, results/test_predictions.npz, logs/full.log, checkpoints/mccfn_best.pt.
