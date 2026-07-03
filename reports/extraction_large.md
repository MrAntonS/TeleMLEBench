# Spectrum-level systematic study — 200,000 independent events

GNN v2 (trained on the 50k set), calibrated T=0.550, veto P(clean) > 0.55.

## Mock a-coefficient extraction

generator a = **-0.105**; truth-quantities reference â = 0.12473 (toy-model floor)

| scenario | â | stat err | Δâ vs truth-ref | n events | unphysical c |
|---|---|---|---|---|---|
| truth | 0.12473 | 0.00730 | +0.00000 | 109,167 | 4.0% |
| recon raw | 0.15379 | 0.00759 | +0.02906 | 109,167 | 6.9% |
| recon + veto | 0.15253 | 0.00832 | +0.02780 | 85,785 | 3.3% |
| recon + correction | 0.15176 | 0.00743 | +0.02703 | 109,167 | 5.3% |
| recon + veto + corr | 0.16173 | 0.00827 | +0.03700 | 85,785 | 2.8% |

Note: the truth-reference â differs from the generator a because the tcoinc selection (8–40 µs window, 2-ring cut) has strong acceptance effects; Δâ vs that reference isolates the *reconstruction-quality* systematic, which is what the ML schemes act on.
