# MISSING_PARAMETERS.md — inferences where the paper is silent/ambiguous

1. **Stratified split RNG/seed.** Paper: stratified per (mod,SNR) 6:2:2, no seed. Chose seed=0, `RandomState(0)` permutation per cell (600/200/600→tr/va/te), train order reshuffled, val/test sorted. Expected impact: ±0.3pp OA across seeds.
2. **Input normalization.** None mentioned → raw I/Q float32 used as-is. Impact: small; data scale is O(1).
3. **Conv padding.** Needed to hold (N,64,L=128) (paper states this shape). Chose Conv2d(2×7) padding (0,3); Conv1d-5 pad 2; Conv1d-3 pad 1. Required by stated shape; negligible effect otherwise.
4. **BN usage.** Text omits BN; Fig.2a shows BN+ReLU after each initial conv → implemented as shown. Impact: moderate (+stability).
5. **Initial conv kernels.** Text says 1×5 then 1×3; figure labels both 1×3. Followed text (5 then 3). Impact: small.
6. **P/U second conv "decoupled channels".** Interpreted as depthwise Conv1d (groups=C). First conv is dense. This exactly reproduces the reported 0.11M params (112,619). Impact: validated against paper's param count.
7. **Attention MLP hidden size.** Not stated. Chose bottleneck C/4 (=32 for T=1) — standard SENet-style; together with (6) reproduces 0.11M. Impact: small.
8. **Classifier.** FC(128→320)→ReLU→FC(320→11) per Fig.2a. Dropout: none mentioned → none. Impact: small.
9. **Regularization loss form.** Eq.24 uses |mean(H)| and consecutive-L differences; Alg.1 uses mean(|H|) and |mean(Li)−mean(F)|. Implemented Alg.1 (executable, per-level). For T=1 the Eq.24 L-term is empty while Alg.1 keeps one term — used Alg.1. λ1=λ2=0.01 per paper. Impact: small (terms ~1e-3).
10. **Early-stopping signal.** Paper: "verification loss" (p.556) without saying total vs CE. Pilot: total-loss stopping fired at epoch 8 (val acc ~51%) because detail/mean regularizers make total loss noisy; CE kept improving. Chose validation **cross-entropy** as the verification loss (the prediction error of Sec II-B), patience still 5→relaxed to 10 (see 11). Recorded as deviation.
11. **Patience / max epochs.** Paper: patience 5, no max epochs. Pilot with patience 5 on total loss stopped at 8 epochs, clearly undertrained (train loss still falling). Final: patience 10 on val-CE, max 50 epochs. Budget-driven; expected +5–10pp vs premature stop.
12. **Optimizer details.** Adam defaults (β=(0.9,0.999), ε=1e-8, weight decay 0) — paper gives only lr=0.001. No scheduler (none mentioned).
13. **Single run vs mean.** Paper does not state seeds/runs for Table I → single run (seed 0) reported as n_runs=1.
14. **Metrics definitions.** OA = micro accuracy over all test examples; MF1 = sklearn macro F1; Kappa = sklearn cohen_kappa_score. Per-SNR accuracy = accuracy within each SNR over all modulations.
15. **Hardware/framework.** Paper: PyTorch 1.7 / GTX 2080Ti. Ours: torch 2.4.1 / RTX 4090 (environment-provided). No code change implied.
