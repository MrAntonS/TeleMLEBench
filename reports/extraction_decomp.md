# Δâ decomposition (200k events)

reference (truth quantities, same selection): â = 0.12473

| scenario | â | stat err | Δâ |
|---|---|---|---|
| truth | 0.12473 | 0.00730 | +0.00000 |
| clean-only recon (scale component) | 0.13703 | 0.00865 | +0.01230 |
| oracle veto | 0.13703 | 0.00865 | +0.01230 |
| recon raw | 0.15379 | 0.00759 | +0.02906 |
| ML veto 0.55 | 0.15253 | 0.00832 | +0.02780 |
| gated corr 0.30 | 0.13579 | 0.00750 | +0.01106 |
| gated corr + ML veto | 0.15253 | 0.00832 | +0.02780 |
| gated corr + MC scale calib | 0.14301 | 0.00750 | +0.01828 |

clean-only recon == oracle veto here (same event set); the Δâ of that row is the energy-scale/resolution floor that NO veto can beat — only an energy calibration or unfolding can.

## Gate-threshold scan (scored on Δâ itself)

| gate | corrected frac | Δâ | stat err |
|---|---|---|---|
| none | 0.0% | +0.02906 | 0.00759 |
| 0.1 | 20.1% | +0.00698 | 0.00751 |
| 0.2 | 20.2% | +0.00891 | 0.00750 |
| 0.3 | 20.4% | +0.01106 | 0.00750 |
| 0.4 | 20.7% | +0.01423 | 0.00748 |
| 0.5 | 21.1% | +0.01799 | 0.00747 |
| 0.7 | 24.1% | +0.02763 | 0.00744 |
| 0.9 | 66.1% | +0.03282 | 0.00741 |
| all | 100.0% | +0.02703 | 0.00743 |
