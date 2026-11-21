# MISSING_PARAMETERS.md

Every choice not specified in arXiv:2304.00445v1, with value chosen, reasoning, and expected impact.
Tag in FROZEN_CONFIG: `paper` = from paper; `inferred` = below.

## M1. Split seed and exact stratification — `inferred`
- Paper: 6:2:2 "randomly selected from each modulation format in different SNRs" (Sec 3.2).
  No seed, no statement whether stratification is per (mod,SNR) key or per (mod) pooled over SNR.
- Choice: stratified per (modulation, SNR) key: for each of 220 keys, seeded shuffle of the
  1000 indices, first 600 train / next 200 val / last 200 test. Seed 0 (numpy RandomState(0)),
  indices stored with sha256 in RESULTS.json.
- Why: matches "from each modulation format in different SNRs" most literally and is the
  community standard for RML splits; guarantees balanced SNR/mod coverage in all splits.
- Impact: medium. Different seeds shift OA by ~±0.5–1pp; unstratified splits would add SNR-mix
  noise. Single seed used (paper reports single numbers, no mean±std).

## M2. Batch size — `inferred`
- Paper: not stated.
- Choice: 256.
- Why: standard for RML2016.10a on a single GPU; fits <10GB with L=128; fast (~500 iters/epoch).
- Impact: low–medium. Batch 64–512 typically moves final OA by <1pp; affects BN statistics mildly.

## M3. Max epochs / min-delta for early stopping — `inferred`
- Paper: stop "when the validation loss does not decrease in 10 epochs" (patience 10); no max
  epochs, no min-delta, no LR schedule.
- Choice: max 100 epochs, min-delta 0.0 (any strict decrease resets counter), monitor val
  cross-entropy loss, restore best-val-loss checkpoint.
- Why: 100 epochs is ample (RML models usually converge in 30–60); patience-10 then stops it.
- Impact: low. Longer max only matters if model still improving at epoch 100 (unlikely).

## M4. Adam learning rate — DEVIATION (`inferred`, see RESEARCH_LOG 2026-10-27)
- Paper: "trained by Adam optimizer with learning rate 1e-3" (Sec 3.2).
- Finding: with the faithful implementation (norm-free backbone, bare attention, batch 256),
  lr=1e-3 is unstable: three full runs (temporal FFM, literal-channel FFM, no-ACM) all show
  smooth train loss but wildly oscillating val loss (1.2<->4.0) and val acc (0.26<->0.56),
  early stopping at ep ~14 on noise. Init grad norms healthy (~2.5): edge-of-stability
  optimization issue, not a bug.
- Choice: lr = 3e-4 (stable: val_loss 1.40->1.11, val_acc 0.47->0.59, no spikes).
  LR 5e-4 tested: slightly worse (best val_acc 0.5858) and starting to wobble.
- Why: smallest change yielding stable training; everything else kept paper-faithful.
- Impact: HIGH for the reproducibility claim — the paper's headline number was obtained with
  a config that does not train stably here (may depend on unstated batch size, seeds, or
  PyTorch 1.8.1 behavior).
- Betas/eps/weight-decay/schedule: PyTorch defaults (0.9, 0.999, 1e-8, 0), fixed LR, as stated.

## M4b. Gradient clipping — `inferred`
- Paper: none.
- Choice: clip_grad_norm_ max_norm=1.0 (used in the frozen 3e-4 run).
- Why: harmless stabilizer; at 3e-4 it rarely binds. Recorded for exactness.
- Impact: negligible at this LR.

## M5. Xavier init variant — `inferred`
- Paper: "Xavier initialized for all layers."
- Choice: `torch.nn.init.xavier_uniform_` for Conv/Linear weights, zeros for biases,
  BN weight=1/bias=0. Applied once at construction (seeded).
- Why: PyTorch default Xavier is uniform; paper gives no gain/slope detail.
- Impact: low (init noise ~±0.3pp).

## M6. ACM MLP exact layout — `inferred`
- Paper: "two fully connected layers of 128, 48, 128 nodes, activated by ReLU" (Sec 3.2).
  Three numbers for "two layers" is ambiguous.
- Choice: Linear(128→48) + ReLU + Linear(48→128) (no ReLU after final; tanh applied outside
  per Eq.2). Two independent copies (Re and Im branches).
- Why: only reading where input/output dim = L = 128 and hidden = 48 with two weight matrices.
- Impact: low. Extra 128→128 layer would add ~16k params (~3% of model) and negligible accuracy.

## M7. ACM FFT normalization and skip form — `inferred`
- Paper: Eq.1 forward has no 1/L, Eq.3 inverse has 1/L (standard unnormalized DFT pair);
  "skip-connection ... associating xhat and x" without operator.
- Choice: `torch.fft.fft` (norm="backward", i.e. unnormalized forward) and
  `torch.fft.ifft` (1/N inverse); complex IFFT output split to I/Q; final `out = x + ifft_part`
  (element-wise addition, Fig.1 "Add").
- Why: exactly reproduces Eq.1/3 scaling; Add is what Fig.1 draws.
- Impact: low. Concat instead of add would change channel count and break downstream MSM.

## M8. MSM/backbone padding and stride — `inferred`
- Paper: kernel sizes only; no padding/stride/pooling.
- Choice: stride 1, no pooling, "same" padding (Conv2d padding (0,k//2) in MSM;
  Conv1d padding=1 in backbone) so L=128 preserved through MSM→backbone→FFM.
- Why: only way Concat of 2×3/2×5/2×7 branches aligns in time, and FFM/GAP expect full length;
  any downsampling would have been stated.
- Impact: medium. Downsampling would change temporal resolution and FFM cost, but padding
  itself is the neutral default.

## M9. Backbone normalization — `inferred`
- Paper: MSM has BN (Eq.4); backbone "followed by ReLU activation" with no BN mentioned.
- Choice: backbone = Conv1d + ReLU only (no BN, no dropout).
- Why: follow text literally.
- Impact: low–medium. Adding BN would likely help slightly (+0–0.5pp) but contradicts text.

## M10. FFM key/query/value dim dk — `inferred`
- Paper: 2 heads, no dk.
- Choice: dk = 64 per head (so MultiHead output channels = h*dk = 128).
- Why: keeps model near reported 0.47M params (see IMPLEMENTATION_NOTES for count math);
  dk=128 (keep 256 ch) overshoots to ~0.62M, dk=32 undershoots to ~0.40M. dk=64 gives ~0.47M.
- Impact: medium. dk controls attention capacity; 32–128 range expected within ~±1pp.

## M11. FFM attention orientation (temporal vs channel) — `inferred`
- Paper: Eq.5 `softmax(QK^T/sqrt(dk))V` with `Q,K,V in R^{dk×L}` literally gives a dk×dk
  (channel-mixing) map, but text ("integration across the entire sequence", "temporal
  channel", "long-range dependence") and Fig.1 (Q·Kᵀ → L×L implied) indicate standard
  temporal attention (L×L).
- Choice: temporal attention: scores `S = Q^T K / sqrt(dk)` (L×L), `A = softmax(S, dim=-1)`,
  `head_out = V @ A^T` (dk×L); heads concatenated → (h·dk)×L.
- Why: matches stated intent; literal dk×dk reading would be channel attention and contradict
  the "long-distance dependence" claim.
- Impact: medium. Channel-attention variant would be a different model; temporal is standard.

## M12. FFM extras (projection/residual/norm/FFN/dropout) — `inferred`
- Paper: Eq.7 is bare Concat, no output projection, residual, LayerNorm, FFN, or dropout.
- Choice: none of them; FFM = per-head linear QKV → temporal attention → concat.
- Why: implement exactly what is described; anything else would add params beyond 0.47M.
- Impact: medium. A full Transformer encoder block (residual+FFN) would add ~0.2M params and
  likely +0.5–1pp, but is not in the paper.

## M13. Classifier activations/dropout — `inferred`
- Paper: "two fully connected layers of 512, 256, 11/10 nodes" (three numbers = 2 hidden +
  output); no activations/dropout.
- Choice: Linear(C→512)+ReLU → Linear(512→256)+ReLU → Linear(256→11); no dropout; GAP (mean
  over L) before first FC.
- Why: ReLU is the paper's default nonlinearity; dropout would have been stated.
- Impact: low. Dropout 0.5 would cost ~0.5pp on this data size.

## M14. Data scaling / normalization — `inferred`
- Paper: none.
- Choice: raw float32 I/Q as stored, no normalization, no augmentation.
- Why: paper describes ACM as the denoiser; no other preprocessing mentioned.
- Impact: low. Per-example normalization is known to matter little on RML2016.10a.

## M15. Class order / label encoding — `inferred`
- Paper: none.
- Choice: alphabetical modulation order
  [8PSK, AM-DSB, AM-SSB, BPSK, CPFSK, GFSK, PAM4, QAM16, QAM64, QPSK, WBFM].
- Impact: none on OA/F1/Kappa (permutation-invariant).

## M16. Single run vs mean over runs — `inferred`
- Paper: single OA/F1/Kappa numbers, no std, no seed count.
- Choice: single run (seed 0 for split, seed 0 for init/shuffling); n_runs_or_seeds=1.
- Why: reproduces the reported single-number protocol.
- Impact: run-to-run std on RML2016.10a is ~0.3–0.6pp; paper's 62.51% is one draw.

## M17. Inference-time protocol — not reproduced
- Paper Table 2: ms/batch without batch size/hardware normalization (2080Ti vs our 4090).
- Choice: report params exactly; report rough inference latency separately with stated batch
  size (256) on RTX 4090 for information only, not as a reproduction claim.
- Impact: none on accuracy reproduction.
