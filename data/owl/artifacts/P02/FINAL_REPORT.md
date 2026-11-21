# FINAL_REPORT.md — Independent reproduction of Zhang et al. AWN on RML2016.10a

## Result
- Reproduction test OA = **0.5945** (44,000 test examples) vs paper Table I **0.6244** → **−2.99pp**. Macro-F1 0.6212 vs 0.6446 (−2.34pp); Kappa 0.5540 vs 0.5863 (−3.23pp).
- Per-SNR: curve shape matches Fig.3a (chance at ≤−14 dB, steep rise −10…0 dB, plateau ~0.89–0.90 above 0 dB). High-SNR (>0 dB) average 0.8916 vs paper 0.9149 (−2.3pp); max 0.9032 (8 dB) vs 0.9305 (12 dB).
- Verdict: **substantially reproduced but not exact** — all headline metrics land 2–3pp below the paper, with the same qualitative behavior. The method's claim (adaptive wavelet + attention beats flatten/GAP baselines at low extra cost, 0.11M params) is supported in structure though absolute numbers were not fully recovered.

## Why the gap (honest assessment)
1. Underspecified details had to be inferred (attention bottleneck C/4; depthwise 2nd conv in P/U; BN placement; padding; Adam defaults; split seed). Each is small but they compound.
2. Early-stopping deviation: paper's "verification loss ... within 5 epochs" applied to the regularized total loss stops training at epoch 8 (val acc ~51%); the reported numbers plausibly used more training and/or CE-based stopping. I used val-CE with patience 10 (documented in MISSING_PARAMETERS.md) — still possibly shorter or longer than the authors' run.
3. Single seed (paper states no seeds/runs); run-to-run noise is ~±0.5pp, not enough to explain 3pp.
4. Framework/hardware drift (torch 2.4 vs 1.7, RTX 4090 vs GTX 2080Ti) may shift results slightly.

## Fidelity checklist
- Architecture: initial convs (2×7/1×5/1×3, 64ch, BN+ReLU), T=1 lifting with reflection-pad P/U (dense+depthwise 1×3, Tanh), GAP+concat(128), SENet attention, FC(128→320→11). Param count 112,619 = paper's 0.11M. ✔
- Split 6:2:2 stratified per (mod,SNR) (132k/44k/44k). ✔ Test set locked until freeze; evaluated once. ✔
- Loss CE + 0.01·mean|H| + 0.01·|mean(L)−mean(F)| per Alg.1. ✔
- Pre-freeze verification: train loss 1.33→0.99 (≪2.40), val acc ~59% (≫9.1%), 256-sample overfit 2.38→0.70, shapes/param-count and sklearn metric checks passed. ✔

## Artifacts
FROZEN_CONFIG.json (hashes), TRAINING_HISTORY.csv, RESULTS.json, results/test_predictions.npz, logs/train.log, checkpoints/awn.pt.
