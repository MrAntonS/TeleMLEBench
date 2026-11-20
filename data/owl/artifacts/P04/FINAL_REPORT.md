# FINAL_REPORT — Independent reproduction of MCDformer (IJCNN 2024) on RML2016.10a

## Result
- Reproduction overall test accuracy: **63.01%** (44,000 test samples, stratified 60/20/20 split, seed 0).
- Paper reported (Table I, p.6): **63.35%**. Difference: **−0.34pp**.
- macro-F1: 65.76% vs 65.62% (+0.14pp). Kappa: 59.31% vs 59.69% (−0.38pp).
- Intervals — −20∼−8dB: 15.82% (paper 17.72); −6∼8dB: 85.53% (paper 83.72, +1.8pp); 10∼18dB: 93.05% (paper 92.82, +0.2pp).
- Verdict: **reproduced** — overall within 0.5pp; mid/high-SNR accuracy meets or exceeds reported values. Low-SNR (<−8dB) is ~2pp lower, consistent with split/seed noise in the near-chance regime.

## What was built (all from paper Sec III–IV)
FDDM (shared 32-unit MLP gate on FFT magnitude + IFFT residual, Eq.2–3) → 4-layer CNN backbone (36/64/128/256 ch, kernels (1,3),(2,3),(1,3),(1,3)) → DTM (2 pre-norm Transformer blocks h=2, dk=dv=L/h, Conv1d distillation 256→256 + MaxPool stride 2 halving 128→64, Eq.5–8) → MLP head (256 hidden) on last time-step. Adam, lr 0.0005, batch 32. 660,867 params. Train loss 1.31→0.98 (≪ln11=2.40); tiny-subset overfit 100%; metric code parity-checked vs sklearn.

## Honesty notes
- Split is inferred (paper: only "same split as AMC-Net/AWN", no ratio/seed): stratified-by-(mod,SNR) 60/20/20, seed 0 (SHA fe6db4b0…). Different ratios/seeds plausibly explain the ±2pp low-SNR gap.
- Other inferences (sigmoid magnitude gate, padding (0,1) to match stated 256×L shape, Conv→BN→ReLU, FFN 4L, last-step pooling, 14-epoch budget stop on best-val): see MISSING_PARAMETERS.md. No test data was used for any decision; checkpoint (ep14, val 63.18%) chosen on validation only.
- Frozen pipeline crashed twice (config accessor; tuple unpack) before writing results; both fixed with re-freeze, no test-based tuning. Hashes verified at eval.
- Budget: training stopped after ep14 (~25 min, val plateaued 63.0–63.2) instead of full convergence; longer training might close the small low-SNR gap.
