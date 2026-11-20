# MISSING_PARAMETERS.md

Every item below is NOT in the paper; value chosen by us with reasoning and expected impact.

1. Split construction (paper: only "7:2:1"). Chose: stratified per-(modulation,SNR) key,
   700/200/100 samples with seed 42 (train 154k/val 44k/test 22k), global shuffle.
   Why: guarantees uniform SNR/mod coverage; the only split consistent with "average accuracy
   over all SNRs" and standard RML practice. Impact: medium — different random splits shift
   overall accuracy by ~±0.5 pp; non-stratified splits could bias per-SNR curves.
2. Preprocessing/normalization: none (raw I/Q as stored float32). Paper mentions none.
   Impact: low; RML data is already roughly normalized.
3. Complex-conv channel semantics: paper gives output maps 12/48/64/128/256 (Fig.1) while
   describing complex ops. Chose: those numbers are REAL channel counts; each complex conv
   uses Cout/2 complex filters (two real Conv1d Kr,Ki), output = concat(real,imag).
   First layer Cin 2 real = 1 complex (I/Q). BN1d+ReLU on concatenated reals.
   Why: the only reading matching Fig.1 shapes (e.g. 3×12=36). A "true" complex BN
   (covariance-based) is not described; standard BN used. Impact: low-medium; preserves
   Eq.10 cross-terms while matching shapes/params.
4. Kernel sizes of the four stacked blocks: paper text omits; Fig.1 shows "(·,1×3)" for all
   four. Chose k=3, pad=1 for all. Impact: medium; larger kernels would raise params/FLOPs.
5. Attention dims dk, dv: not specified. Chose dk=dv=64, heads h=2, tokens=channels
   (Q,K,V = Linear(128->dk/dv) per head; W^O = Linear(2dv=128 -> 128)).
   Why: matches Eq.5 shapes (Q ∈ R^{C×dk}) and Fig.1 output shape, and yields 273k params
   ≈ reported 0.25M (9% over). Alternatives (dk=128) would overshoot params; time-wise
   attention (tokens=L) would need different shapes contradicting Eq.5. Impact: medium.
6. Dropout placement/rates: paper shows dropout after attention (Eq.6) and "Dynamic Dropout"
   between FCs (Eq.7/Fig.1); only the latter's schedule is specified (init 0.5).
   Chose: single shared rate p (init 0.5) applied to BOTH dropout layers, updated by Alg.2.
   Other (non-dynamic) fixed rates unspecified — sharing is simplest faithful reading.
   Impact: low-medium (regularization strength).
7. Epochs / early stopping / weight decay: unspecified. Chose: max 50 epochs, best checkpoint
   by min val loss; no weight decay; no hard early stop (LR schedule provides decay).
   Budget-driven: 50 epochs ≈ 15-25 min on RTX 4090 shared. Impact: medium; fewer epochs may
   underfit by ~1 pp vs a longer run.
8. DataLoader shuffling/seed: seed 42 everywhere; train shuffle on. Impact: negligible.
9. Optimizer reset semantics (Alg.1 line 17): re-create Adam with current lr (moments cleared).
   Impact: low.
10. Schedule granularity: Algorithms written per-iteration; applied per-epoch (standard for
    RML papers; per-batch would decay lr within one epoch). Impact: medium — per-batch would
    collapse lr far too fast.
11. GAP: AdaptiveAvgPool1d over time (128->1). Impact: none (forced by shapes).
12. Bias in complex convs: none (BN follows). Impact: negligible.
13. FLOPs/inference-time matching: not optimized; only params checked (~0.27M vs 0.25M).
    Impact on accuracy: none.
14. Single run (no mean over seeds): paper reports single numbers (no error bars, no seed count).
    Chose n=1 run. Impact: run-to-run variance ~±0.3-0.6 pp.
