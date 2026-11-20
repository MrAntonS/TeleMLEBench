# MISSING_PARAMETERS.md

| # | Item | Paper status | Choice | Reason | Expected impact |
|---|------|--------------|--------|--------|-----------------|
| 1 | Optimizer | Not stated | Adam (lr 1e-3, weight_decay 1e-4) | De-facto default for AMR + Table 2 LR schedule phrased like Keras ReduceLROnPlateau w/ Adam; also matches reported smooth convergence | Medium — SGD would converge slower/lower; Adam needed to hit ~63% |
| 2 | Loss | Not stated (one-hot + softmax implies it) | Categorical cross-entropy (nn.CrossEntropyLoss) | Only sensible choice for one-hot multi-class | Negligible |
| 3 | Conv padding/stride/dims | Only "64/128 filters, kernel 3", "pool size 2" | Conv1d, stride 1, same padding; MaxPool1d(2) stride 2 | Preserves length (128→128→64); Conv2d over (2,128) would be odd; Conv1d standard for IQ | Low-medium |
| 4 | Conv channel order | Input (2,128) | Conv1d in_channels=2, seq_len=128 | Direct reading of Fig.2 | Low |
| 5 | LSTM return-sequences | Not stated | Both BiLSTMs return full sequences (64×256) into attention | Attention over sequence requires it; else attention degenerates | High if wrong |
| 6 | Attention exact form | Eqs 4-6 + "dense layers for Q,K, scaling, dropout 0.1, LayerNorm" | Per-timestep additive self-attention: e_t=v·tanh(Wq h_t+Wk h_t)·(1/√d), softmax, weighted sum, dropout(0.1) on weights, LayerNorm on context; attn_dim=128 | Faithful to text; pairwise QK variant underdetermined — chosen simplest consistent form | Medium |
| 7 | BN placement after LSTM/dense | "BN applied after each LSTM/dense" | BN on feature dim after each LSTM (both), after each dense; ReLU ordering Conv→ReLU per Fig.2 text | Matches text | Low |
| 8 | Normalization | "Normalization" only | Global standardization with train mean/std (≈−0.00027/0.00604) | Raw values ~0.006 magnitude need rescaling; per-sample norm would destroy amplitude info that distinguishes e.g. PAM4/QAM | Medium |
| 9 | Split method/seed/stratification | "Shuffle, 70/15/15", no seed/strat | Seeded shuffle (seed 42) stratified by joint (mod,SNR) via sklearn train_test_split; 70/15/15 | Guarantees every (mod,SNR) represented in each split; plain random ≈ same in expectation | Low |
| 10 | Batch size | Paper: 32 for 10a | **128** (deviation, budget-driven) | Batch 32 → ~160 s/epoch on shared RTX4090 → 58 epochs ≈ 2.5 h > 60-min budget; batch 128 → ~36 s/epoch initially ≈ 35 min. Noted as deviation | Medium — larger batch, slightly different regularization/noise |
| 14 | Epochs actually run | Paper: 58 | **26 of 58** (budget-driven early stop; best-val checkpoint used) | Shared-GPU contention drove epoch time 36 s → ~5 min by ep26; killed to leave time for freeze + single final eval inside hard limit. Val acc still rising (60.9%), so full 58 epochs would likely close part of the −2.3pp gap | Medium |
| 11 | EarlyStopping patience | "halted when val loss stagnated", no patience | Not used as hard stop; trained full 58 epochs, checkpoint on best val accuracy (ModelCheckpoint equivalent) | Paper itself reports epoch-58 endpoints, implying full schedule ran | Low |
| 12 | Weight init, gradient clip, dataloader workers | Not stated | PyTorch defaults (Kaiming/Xavier), grad clip 5.0, shuffling each epoch | Stability only | Low |
| 13 | Test metric definition | "average accuracy" | Overall (micro) accuracy over all test examples incl. all SNRs + per-SNR, macro-F1, Cohen κ | Standard reading; matches Table 3 "average accuracy" | Low |
