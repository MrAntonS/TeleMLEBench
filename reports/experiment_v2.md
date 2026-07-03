# Experiment v2 — weighting fix + ceiling study

| model | accuracy | macro-F1 |
|---|---|---|
| GBDT sqrt-weights | 0.9057 | 0.7110 |
| GBDT + true-lost-energy CHEAT | 0.9719 | 0.9092 |
| NabGNN v2 | 0.9060 | 0.7116 |

v1 reference: MLP 0.9040/0.6757, GBDT-balanced 0.6859/0.6942, GNN-v1 0.5271/0.6712

### GBDT (sqrt class weights)

accuracy **0.9057**, macro-F1 **0.7110**

| class | precision | recall | F1 | support |
|---|---|---|---|---|
| CLEAN_COINC | 0.904 | 0.990 | 0.945 | 5374 |
| BS_SAME_DET | 0.990 | 0.968 | 0.979 | 312 |
| BS_OTHER_DET | 0.966 | 0.983 | 0.975 | 175 |
| BS_LOST | 0.388 | 0.207 | 0.270 | 193 |
| BREMS_LOSS | 0.062 | 0.004 | 0.008 | 227 |
| DEAD_LAYER_LOSS | 0.200 | 0.004 | 0.008 | 252 |
| MISSED_PROTON | 1.000 | 0.986 | 0.993 | 278 |
| MISSED_ELECTRON | 1.000 | 1.000 | 1.000 | 39 |
| ACCIDENTAL | 0.991 | 0.991 | 0.991 | 216 |
| NOISE_CONTAM | 0.901 | 0.986 | 0.942 | 434 |

### GBDT + true lost energy (ceiling)

accuracy **0.9719**, macro-F1 **0.9092**

| class | precision | recall | F1 | support |
|---|---|---|---|---|
| CLEAN_COINC | 0.998 | 0.998 | 0.998 | 5374 |
| BS_SAME_DET | 0.984 | 0.971 | 0.977 | 312 |
| BS_OTHER_DET | 0.966 | 0.983 | 0.975 | 175 |
| BS_LOST | 0.714 | 0.710 | 0.712 | 193 |
| BREMS_LOSS | 0.679 | 0.586 | 0.629 | 227 |
| DEAD_LAYER_LOSS | 0.780 | 0.889 | 0.831 | 252 |
| MISSED_PROTON | 1.000 | 0.982 | 0.991 | 278 |
| MISSED_ELECTRON | 1.000 | 1.000 | 1.000 | 39 |
| ACCIDENTAL | 0.991 | 0.991 | 0.991 | 216 |
| NOISE_CONTAM | 0.986 | 0.991 | 0.989 | 434 |

### NabGNN v2

accuracy **0.9060**, macro-F1 **0.7116**

| class | precision | recall | F1 | support |
|---|---|---|---|---|
| CLEAN_COINC | 0.903 | 0.992 | 0.945 | 5374 |
| BS_SAME_DET | 0.981 | 0.968 | 0.974 | 312 |
| BS_OTHER_DET | 0.982 | 0.943 | 0.962 | 175 |
| BS_LOST | 0.433 | 0.233 | 0.303 | 193 |
| BREMS_LOSS | 0.000 | 0.000 | 0.000 | 227 |
| DEAD_LAYER_LOSS | 0.000 | 0.000 | 0.000 | 252 |
| MISSED_PROTON | 1.000 | 0.996 | 0.998 | 278 |
| MISSED_ELECTRON | 1.000 | 1.000 | 1.000 | 39 |
| ACCIDENTAL | 0.995 | 0.986 | 0.991 | 216 |
| NOISE_CONTAM | 0.912 | 0.975 | 0.942 | 434 |

#### GNN v2 confusion matrix (test)
| true \ pred | CLEAN_COI | BS_SAME_D | BS_OTHER_ | BS_LOST | BREMS_LOS | DEAD_LAYE | MISSED_PR | MISSED_EL | ACCIDENTA | NOISE_CON |
|---|---|---|---|---|---|---|---|---|---|---|
| **CLEAN_COI** | 5331 | 4 | 0 | 31 | 8 | 0 | 0 | 0 | 0 | 0 |
| **BS_SAME_D** | 8 | 302 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| **BS_OTHER_** | 8 | 0 | 165 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| **BS_LOST** | 128 | 0 | 0 | 45 | 8 | 0 | 0 | 0 | 0 | 12 |
| **BREMS_LOS** | 202 | 0 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 10 |
| **DEAD_LAYE** | 225 | 0 | 0 | 7 | 4 | 0 | 0 | 0 | 0 | 16 |
| **MISSED_PR** | 1 | 0 | 0 | 0 | 0 | 0 | 277 | 0 | 0 | 0 |
| **MISSED_EL** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 39 | 0 | 0 |
| **ACCIDENTA** | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 213 | 0 |
| **NOISE_CON** | 1 | 1 | 2 | 6 | 1 | 0 | 0 | 0 | 0 | 423 |

per-trigger accuracy: **0.9894**

### Residual regression (test)
- **d_eEng (keV)**: RMSE(model) = 52.52, RMSE(null=0) = 72.6, corr = 0.660, explained = 47.7%

- **d_tof (us)**: RMSE(model) = 2.11, RMSE(null=0) = 2.933, corr = 0.696, explained = 48.3%


_wall time: 1077s_
