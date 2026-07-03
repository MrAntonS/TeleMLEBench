# GNN ablations (20,000 events, 20 epochs, dim 64)

| variant | accuracy | macro-F1 |
|---|---|---|
| full multi-task | 0.8897 | 0.6970 |
| event-head only | 0.8977 | 0.7040 |
| zeroed edge features | 0.8877 | 0.6992 |
| test threshold +5 keV | 0.8573 | 0.6486 |
| test noise x5 | 0.8833 | 0.6740 |
