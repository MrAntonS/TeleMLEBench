# Nab toy experiment — 50,000 events

date: 2026-07-03 · seed 42 · split 70/15/15

## Dataset statistics memo

- events: **50,000**, triggers: **107,916** (mean 2.16/event, max 7)
- tcoinc emulation: pFound 95.8%, eFound 54.3%

| class | fraction | mean |d_eEng| keV | mean d_eEng keV | mean |d_tof| us |
|---|---|---|---|---|
| CLEAN_COINC | 71.17% | 1.0 | -1.0 | 0.01 |
| BS_SAME_DET | 4.07% | 160.3 | -160.3 | 0.14 |
| BS_OTHER_DET | 2.40% | 47.5 | -47.5 | 0.08 |
| BS_LOST | 2.58% | 187.2 | -187.2 | 0.08 |
| BREMS_LOSS | 3.31% | 83.5 | -83.5 | 0.13 |
| DEAD_LAYER_LOSS | 3.18% | 18.5 | -18.5 | 0.24 |
| MISSED_PROTON | 3.86% | 43.6 | -43.6 | 6.56 |
| MISSED_ELECTRON | 0.64% | 12.8 | -12.8 | 5.34 |
| ACCIDENTAL | 3.00% | 78.1 | -40.6 | 8.17 |
| NOISE_CONTAM | 5.80% | 13.0 | -13.0 | 1.21 |

## Model comparison (held-out test split)
| model | accuracy | macro-F1 |
|---|---|---|
| Rule-based cuts | 0.7511 | 0.3929 |
| GBDT | 0.6859 | 0.6942 |
| MLP | 0.9040 | 0.6757 |
| NabGNN | 0.5271 | 0.6712 |


### Rule-based cuts (zeroth-order)

accuracy **0.7511**, macro-F1 **0.3929**

| class | precision | recall | F1 | support |
|---|---|---|---|---|
| CLEAN_COINC | 0.852 | 0.899 | 0.875 | 5374 |
| BS_SAME_DET | 0.832 | 0.349 | 0.492 | 312 |
| BS_OTHER_DET | 0.377 | 0.720 | 0.495 | 175 |
| BS_LOST | 0.000 | 0.000 | 0.000 | 193 |
| BREMS_LOSS | 0.000 | 0.000 | 0.000 | 227 |
| DEAD_LAYER_LOSS | 0.000 | 0.000 | 0.000 | 252 |
| MISSED_PROTON | 0.860 | 0.953 | 0.904 | 278 |
| MISSED_ELECTRON | 0.051 | 0.949 | 0.097 | 39 |
| ACCIDENTAL | 0.908 | 0.366 | 0.521 | 216 |
| NOISE_CONTAM | 0.749 | 0.426 | 0.543 | 434 |

### HistGradientBoosting (engineered features)

accuracy **0.6859**, macro-F1 **0.6942**

| class | precision | recall | F1 | support |
|---|---|---|---|---|
| CLEAN_COINC | 0.918 | 0.664 | 0.771 | 5374 |
| BS_SAME_DET | 0.984 | 0.978 | 0.981 | 312 |
| BS_OTHER_DET | 0.983 | 0.966 | 0.974 | 175 |
| BS_LOST | 0.107 | 0.482 | 0.175 | 193 |
| BREMS_LOSS | 0.051 | 0.159 | 0.077 | 227 |
| DEAD_LAYER_LOSS | 0.033 | 0.071 | 0.045 | 252 |
| MISSED_PROTON | 1.000 | 0.989 | 0.995 | 278 |
| MISSED_ELECTRON | 1.000 | 1.000 | 1.000 | 39 |
| ACCIDENTAL | 0.982 | 0.991 | 0.986 | 216 |
| NOISE_CONTAM | 0.902 | 0.979 | 0.939 | 434 |

### MLP (engineered features)

accuracy **0.9040**, macro-F1 **0.6757**

| class | precision | recall | F1 | support |
|---|---|---|---|---|
| CLEAN_COINC | 0.893 | 0.999 | 0.943 | 5374 |
| BS_SAME_DET | 0.970 | 0.933 | 0.951 | 312 |
| BS_OTHER_DET | 0.988 | 0.949 | 0.968 | 175 |
| BS_LOST | 0.600 | 0.016 | 0.030 | 193 |
| BREMS_LOSS | 0.000 | 0.000 | 0.000 | 227 |
| DEAD_LAYER_LOSS | 0.000 | 0.000 | 0.000 | 252 |
| MISSED_PROTON | 0.982 | 0.978 | 0.980 | 278 |
| MISSED_ELECTRON | 1.000 | 0.949 | 0.974 | 39 |
| ACCIDENTAL | 0.968 | 0.972 | 0.970 | 216 |
| NOISE_CONTAM | 0.896 | 0.991 | 0.941 | 434 |

### NabGNN (multi-decoder, trigger graph)

accuracy **0.5271**, macro-F1 **0.6712**

| class | precision | recall | F1 | support |
|---|---|---|---|---|
| CLEAN_COINC | 0.930 | 0.434 | 0.592 | 5374 |
| BS_SAME_DET | 0.984 | 0.965 | 0.974 | 312 |
| BS_OTHER_DET | 0.960 | 0.949 | 0.954 | 175 |
| BS_LOST | 0.090 | 0.611 | 0.157 | 193 |
| BREMS_LOSS | 0.043 | 0.335 | 0.076 | 227 |
| DEAD_LAYER_LOSS | 0.041 | 0.071 | 0.052 | 252 |
| MISSED_PROTON | 1.000 | 0.993 | 0.996 | 278 |
| MISSED_ELECTRON | 1.000 | 0.974 | 0.987 | 39 |
| ACCIDENTAL | 0.995 | 0.986 | 0.991 | 216 |
| NOISE_CONTAM | 0.910 | 0.959 | 0.934 | 434 |

#### GNN confusion matrix (test)
| true \ pred | CLEAN_COI | BS_SAME_D | BS_OTHER_ | BS_LOST | BREMS_LOS | DEAD_LAYE | MISSED_PR | MISSED_EL | ACCIDENTA | NOISE_CON |
|---|---|---|---|---|---|---|---|---|---|---|
| **CLEAN_COI** | 2331 | 2 | 0 | 1061 | 1581 | 399 | 0 | 0 | 0 | 0 |
| **BS_SAME_D** | 2 | 301 | 1 | 3 | 4 | 0 | 0 | 0 | 0 | 1 |
| **BS_OTHER_** | 0 | 0 | 166 | 4 | 3 | 0 | 0 | 0 | 1 | 1 |
| **BS_LOST** | 17 | 0 | 1 | 118 | 41 | 3 | 0 | 0 | 0 | 13 |
| **BREMS_LOS** | 66 | 0 | 0 | 61 | 76 | 14 | 0 | 0 | 0 | 10 |
| **DEAD_LAYE** | 90 | 0 | 0 | 54 | 74 | 18 | 0 | 0 | 0 | 16 |
| **MISSED_PR** | 1 | 0 | 0 | 1 | 0 | 0 | 276 | 0 | 0 | 0 |
| **MISSED_EL** | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 38 | 0 | 0 |
| **ACCIDENTA** | 0 | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 213 | 0 |
| **NOISE_CON** | 0 | 1 | 4 | 12 | 1 | 0 | 0 | 0 | 0 | 416 |

per-trigger label accuracy: **0.9821** (16,189 triggers)

### Residual (systematic-error) regression, test split
- **d_eEng (keV)**: RMSE(model) = 54.66, RMSE(null=0) = 72.6, corr = 0.624, explained = 43.3%

- **d_tof (us)**: RMSE(model) = 2.288, RMSE(null=0) = 2.933, corr = 0.633, explained = 39.2%


_total wall time: 1263s_
