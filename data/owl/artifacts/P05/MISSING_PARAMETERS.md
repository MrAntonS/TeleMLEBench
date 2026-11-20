# Missing / ambiguous parameters and choices

All choices below are the reproducer's, not the paper's. Expected impact noted.

1. **Split seed.** Paper says "randomly selected" with no seed. Chose seed 12345, independent
   permutation per (modulation, SNR) cell, 800/100/100. Any seed gives statistically identical
   expectations (22k test, std of OA ~0.3%); impact negligible.
2. **Channel widths / block internals.** Fig. 3 gives only partial labels (8, 16, 32, 64, 128, 256);
   exact per-layer in/out counts, shortcut kernel sizes, and the CDSC-block interior are read from the
   small figure (see PAPER_SPECIFICATION.md). Chose stem CC 1->8 -> CC 8->16, stages to 32/64,
   7 identical 64-channel CDSC blocks (CReLU + 2x(CDSC+CBN+CReLU) + CDSC+CBN + add + CReLU),
   head 64->128, CDSC 128->256, CAP, CFC 256->11. Total 0.335M params vs paper's 0.33M (Table I),
   supporting the reading. Impact: medium — a different width/depth reading would shift OA by ~1pp.
3. **Pooling sizes/strides.** Paper says CMP is the only downsampling but gives no kernel/stride.
   Chose CMP k=2 s=2 at three stages (128->64->32->16) plus global CAP at the end; shortcut paths use
   average-pool k=2 for length matching. Impact: low-medium (length-16 pre-CAP embedding is standard).
4. **Shortcut form.** "Projection shortcut" (Sec. II-F.2) with no kernel given. Chose 1x1 complex conv +
   CBN (+ avg-pool when downsampling). Impact: low.
5. **CBN details.** Momentum 0.1, eps 1e-5 (PyTorch defaults); per-complex-channel whitening exactly as
   Eqs.(3)-(6). Paper gives no momentum/eps. Impact: low.
6. **Weight init.** Not specified. PyTorch defaults for conv/linear (uniform), CBN gamma/beta as in
   paper. Impact: low (~run-to-run noise).
7. **Cosine schedule form.** "Dynamically adjusted with the cosine annealing schedule... cyclically
   altered every ten epochs" — chose CosineAnnealingWarmRestarts(T_0=10), i.e. cosine decay from 0.001
   restarting every 10 epochs. Impact: low-medium.
8. **Batch size.** Paper says 128; used 1024 for the full run (shared-GPU throughput; pilot used
   512). Larger batches add gradient noise reduction; with Adam+cosine the effect on final OA is
   expected <0.5pp. Recorded as budget compromise.
9. **Number of runs.** Paper averages 10 independent experiments. Ran 1 seed (seed 0) for the frozen
   result (plus short pilots) due to the 60-minute wall-clock budget; spread across seeds is
   reported from literature as ~±0.3pp. RESULTS.json records n_runs_or_seeds=1.
10. **Precision/recall definition.** Paper does not define averaging. Reported macro-averaged precision
    (≈71.9% in paper) and recall (=OA for balanced test, by construction). Used sklearn
    macro precision/recall; verified identical code path on toy inputs.
11. **No preprocessing/normalization.** Used raw float32 I/Q exactly as stored. Impact: none (as specified).
12. **Cross-dataset (10b) experiment.** Out of scope: only the RML2016.10a intra-dataset result is
    reproduced (per AGENTS.md, one paper = RML2016.10a result).
