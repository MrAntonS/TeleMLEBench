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

clean-only recon == oracle veto here (same event set); the Δâ of that row is the energy-scale/resolution floor that NO veto can beat — only an energy calibration or unfolding can.