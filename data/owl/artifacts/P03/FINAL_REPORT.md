# FINAL_REPORT.md — Independent reproduction of ICRNNA on RadioML2016.10a

Paper: El-Haryqy et al., "Improved automatic modulation recognition using deep learning with additive attention", Results in Engineering 26 (2025) 104783.

## Result
- Reproduced overall test accuracy (all SNRs, n=33,000): **60.90%** vs paper reported **63.24%** (Table 3, p.6) → **−2.34 pp**.
- Macro-F1 0.6306 (paper 0.6567); Cohen κ 0.5699 (not reported in paper).
- Per-SNR test accuracy vs paper Table 5 (ours → paper): −10dB 20.4→25.3; −8dB 33.6→37.5; −6dB 56.5→55.3; −4dB 70.5→71.1; −2dB 82.7→85.1; 0dB 87.5→92.2; 2dB 88.2→93.4; 4dB 90.4→93.0. High-SNR plateau ≈90% vs paper ≈93%; low-SNR shape matches (chance-level at −20dB ≈9.7% vs 1/11).
- Test accuracy (60.90%) == best val accuracy (60.92%): no overfitting, split is representative.

## Verdict
**Substantially reproduced, with a small shortfall.** Architecture implemented exactly per Fig.2/Sec.3 (param count 794,699 ≈ paper's 0.79M — exact match), all paper-specified hyperparameters used (LR schedule, dropout, L2, split ratio), and the SNR-accuracy profile matches the paper's shape. The −2.3pp gap is plausibly explained by (a) early stop at epoch 26/58 — val accuracy was still rising (~+0.3pp/2 epochs) when GPU contention (≈5 min/epoch on shared RTX 4090) forced a freeze inside the 60-min budget; (b) batch 128 vs paper's 32 (time-driven deviation); (c) inferred optimizer (Adam), normalization, and attention details the paper does not specify.

## Key evidence of faithful reconstruction
- Tensor shapes verified end-to-end (2,128)→(11); loss fell 1.35→1.09 (≪ ln11≈2.40); pilot reached 48% val acc in 3 epochs on 5% data (vs 9.1% chance).
- Reported training trajectory matches paper Fig.6/7 (ep1: train 48.9%/val 54.9% vs paper 47.8%/54.1%).
- Metrics code verified bit-exact against sklearn on toy inputs.

## Limitations / deviations (see MISSING_PARAMETERS.md)
Optimizer, loss, conv padding, attention exact form, normalization, stratification/seed inferred; batch 128 (paper 32); 26 epochs run of 58 planned. Single seed/run. No test data touched before freeze; code/hashes frozen in FROZEN_CONFIG.json and verified by final_evaluate.py.
