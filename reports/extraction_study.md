# Spectrum-level systematic study (toy)

GNN v2, calibrated (T=0.550); veto threshold P(clean) > 0.55. Test split of the 50k set.

## Mock a-coefficient extraction

generator a = **-0.105**; truth-quantities reference â = 0.12253 (toy-model floor)

| scenario | â | stat err | Δâ vs truth-ref | n events | unphysical c |
|---|---|---|---|---|---|
| truth | 0.12253 | 0.03794 | +0.00000 | 4,100 | 3.4% |
| recon raw | 0.14185 | 0.03948 | +0.01931 | 4,100 | 6.6% |
| recon + veto | 0.13461 | 0.04307 | +0.01208 | 3,245 | 2.9% |
| recon + correction | 0.13488 | 0.03840 | +0.01235 | 4,100 | 4.7% |
| recon + veto + corr | 0.14859 | 0.04260 | +0.02605 | 3,245 | 2.4% |

Δâ is the spectrum-level systematic of each scheme; the stat err column shows what sample-size penalty a veto incurs.
