# FINAL_REPORT.md — Independent reproduction of AMC-Net on RML2016.10a

Paper: "AMC-NET: AN EFFECTIVE NETWORK FOR AUTOMATIC MODULATION CLASSIFICATION"
(Zhang et al., arXiv:2304.00445v1). All implementation from the paper text only.

## Result

| Metric (RML2016.10a test, n=44,000) | Reproduced | Paper (Table 1, p.4) | Gap |
|---|---|---|---|
| Overall accuracy | **59.47%** | 62.51% | **−3.04 pp** |
| Macro F1 | 0.6114 | 0.6483 | −0.0369 |
| Kappa | 0.5541 | 0.5885 | −0.0344 |

Per-SNR test accuracy (dB → acc): −20: 0.094, −18: 0.097, −16: 0.101, −14: 0.140,
−12: 0.172, −10: 0.256, −8: 0.375, −6: 0.533, −4: 0.663, −2: 0.772, 0: 0.829,
2: 0.862, 4: 0.868, 6: 0.868, 8: 0.879, 10: 0.878, 12: 0.872, 14: 0.876, 16: 0.876,
18: 0.883. Shape matches the paper's Fig.2(a) curve (chance at −20 dB, plateau ~0.88
at high SNR vs ~0.9 in the figure).

## Verdict

**Partial reproduction.** The method as described is implementable and learns:
train loss 1.66→0.99 (ln 11 ≈ 2.40), high-SNR subset overfit to 76%, val acc 59.1%,
test acc 59.5% — far above chance (9.1%), with the expected SNR response and a
parameter count matching the paper (454,527 vs reported 0.47M, −3.3%). But the
headline number (62.51%) was **not reached (−3.04 pp)**, and reaching even 59.5%
required deviating from the paper's stated optimizer setting (see below).

## Key findings (all decided on train/val only; test evaluated once after freezing)

1. **The stated lr=1e-3 does not train stably.** Three full faithful runs (temporal FFM,
   literal channel-orientation FFM, and no-ACM ablation) with Adam 1e-3 / batch 256 all
   show smooth train loss but violently oscillating val loss (1.2↔4.0) and val acc
   (0.26↔0.56), early-stopping on noise at ep ~14 (best val acc ~0.54–0.56). Init
   gradient norms are healthy (~2.5), and neither the FFM orientation nor the ACM is the
   cause — it is an edge-of-stability issue of the norm-free backbone + bare attention
   stack. LR 3e-4 (+ grad clip 1.0) trains smoothly (val 0.47→0.59); 5e-4 is worse.
   The paper's 62.51% may depend on unstated batch size/seed/framework behavior
   (their PyTorch 1.8.1 vs our 2.4.1) or unstated stabilizers.
2. **FFM orientation ambiguity does not matter empirically.** Literal Eq.5 (dk×dk channel
   map) vs. the text-implied temporal (L×L) attention give identical val acc (59.3% vs
   59.1%). Frozen model uses temporal (M11).
3. **ACM contributes little here.** No-ACM ablation at 1e-3 reached best val 0.5575 vs
   0.5438 with ACM (both unstable regime); the paper reports −2.13 pp without ACM.
   Not re-tested at 3e-4 (budget); recorded as open.
4. Remaining gap plausibly from: the forced LR change, unknown batch size/seed (single
   run, no mean±std reported), and ambiguous FFM details (no dk, no norm/FFN described).

## Protocol compliance

- Split exactly as paper describes (6:2:2 stratified per modulation×SNR, seed 0 recorded);
  test split (44,000) touched exactly once, by `src/final_evaluate.py` after freezing.
- `FROZEN_CONFIG.json` tags every setting paper/inferred, with src hashes verified before
  eval; `TRAINING_HISTORY.csv`, `RESULTS.json`, `results/test_predictions.npz` written.
- Artifacts: PAPER_SPECIFICATION.md, MISSING_PARAMETERS.md (M1–M17 + M4/M4b deviation),
  IMPLEMENTATION_NOTES.md, RESEARCH_LOG.md.
