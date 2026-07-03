# Augmented-training study (30,000 events, 20 epochs)

Augmented trainer sees a 50/50 mix of nominal and transformed
copies (threshold 12.5 keV, noise +0.25/event, +5% overlay).

| test set | model | accuracy | macro-F1 |
|---|---|---|---|
| nominal | baseline | 0.9011 | 0.7062 |
| nominal | augmented | 0.9020 | 0.7092 |
| thr +5 keV | baseline | 0.8669 | 0.6592 |
| thr +5 keV | augmented | 0.8680 | 0.6657 |
| noise x5 | baseline | 0.8882 | 0.6759 |
| noise x5 | augmented | 0.8973 | 0.6963 |
| acc x2 | baseline | 0.9056 | 0.7063 |
| acc x2 | augmented | 0.9058 | 0.7079 |
