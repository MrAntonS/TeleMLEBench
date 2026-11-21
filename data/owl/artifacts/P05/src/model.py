"""CDSCNN model (Fig. 3 reconstruction)."""
import torch
import torch.nn as nn
from complex_nn import (ComplexConv1d, CDSC, ComplexBatchNorm1d, CReLU,
                        ComplexMaxPool1d, ComplexLinear, ComplexGlobalAvgPool1d)


def cc_block(n_in, n_out, k=3, pool=False):
    layers = [ComplexConv1d(n_in, n_out, k, padding=k // 2), ComplexBatchNorm1d(n_out)]
    if pool:
        return layers
    return layers


class CDSCBlock(nn.Module):
    """Pre-activation residual block: CReLU + (CDSC+CBN+CReLU) x2 + (CDSC+CBN) + shortcut."""
    def __init__(self, ch):
        super().__init__()
        self.act0 = CReLU()
        self.c1 = CDSC(ch, ch, 3, padding=1)
        self.bn1 = ComplexBatchNorm1d(ch)
        self.act1 = CReLU()
        self.c2 = CDSC(ch, ch, 3, padding=1)
        self.bn2 = ComplexBatchNorm1d(ch)
        self.act2 = CReLU()
        self.c3 = CDSC(ch, ch, 3, padding=1)
        self.bn3 = ComplexBatchNorm1d(ch)
        self.act3 = CReLU()

    def forward(self, x):
        h = self.act0(x)
        h = self.act1(self.bn1(self.c1(h)))
        h = self.act2(self.bn2(self.c2(h)))
        h = self.bn3(self.c3(h))
        return self.act3(h + x)


class CDSCNN(nn.Module):
    def __init__(self, n_classes=11, n_blocks=7):
        super().__init__()
        self.stem1 = nn.Sequential(ComplexConv1d(1, 8, 3, padding=1), ComplexBatchNorm1d(8), CReLU())
        self.stem2 = nn.Sequential(ComplexConv1d(8, 16, 3, padding=1), ComplexBatchNorm1d(16), CReLU())
        # stage 16->32 with downsample
        self.s2_a = CDSC(16, 32, 3, padding=1)
        self.s2_bn = ComplexBatchNorm1d(32)
        self.s2_act = CReLU()
        self.s2_b = CDSC(32, 32, 3, padding=1)
        self.s2_bnb = ComplexBatchNorm1d(32)
        self.s2_pool = ComplexMaxPool1d(2, 2)
        self.s2_proj = nn.Sequential(ComplexConv1d(16, 32, 1), ComplexBatchNorm1d(32))
        self.s2_act_out = CReLU()
        # stage 32->64 with downsample
        self.s3_act0 = CReLU()
        self.s3_a = CDSC(32, 64, 3, padding=1)
        self.s3_bn = ComplexBatchNorm1d(64)
        self.s3_act = CReLU()
        self.s3_b = CDSC(64, 64, 3, padding=1)
        self.s3_bnb = ComplexBatchNorm1d(64)
        self.s3_pool = ComplexMaxPool1d(2, 2)
        self.s3_proj = nn.Sequential(ComplexConv1d(32, 64, 1), ComplexBatchNorm1d(64))
        # blocks at 64ch, length L/4 = 32
        self.blocks = nn.Sequential(*[CDSCBlock(64) for _ in range(n_blocks)])
        # head 64->128 downsample, 128->256, global avg
        self.h_act = CReLU()
        self.h_a = CDSC(64, 64, 3, padding=1)
        self.h_bn = ComplexBatchNorm1d(64)
        self.h_act2 = CReLU()
        self.h_b = CDSC(64, 128, 3, padding=1)
        self.h_bnb = ComplexBatchNorm1d(128)
        self.h_pool = ComplexMaxPool1d(2, 2)
        self.h_proj = nn.Sequential(ComplexConv1d(64, 128, 1), ComplexBatchNorm1d(128))
        self.h_c = CDSC(128, 256, 3, padding=1)
        self.h_cbn = ComplexBatchNorm1d(256)
        self.h_act3 = CReLU()
        self.gap = ComplexGlobalAvgPool1d()
        self.cfc = ComplexLinear(256, n_classes)

    def forward(self, x):
        # x: (B,2,128) real I/Q -> 1 complex channel
        h = self.stem1(x)
        h = self.stem2(h)
        # stage2
        s = self.s2_proj(h)
        # project path needs same pooling: pool magnitude-based? use avg to match length
        h = self.s2_act(self.s2_bn(self.s2_a(h)))
        h = self.s2_bnb(self.s2_b(h))
        h = self.s2_pool(h)
        # pool shortcut to same length via avg pool on real/imag (approx; both are max-selected vs avg)
        s = torch.nn.functional.avg_pool1d(s, 2, 2)
        h = self.s2_act_out(h + s)
        # stage3
        s = self.s3_proj(h)
        s = torch.nn.functional.avg_pool1d(s, 2, 2)
        h = self.s3_act(self.s3_bn(self.s3_a(self.s3_act0(h))))
        h = self.s3_bnb(self.s3_b(h))
        h = self.s3_pool(h)
        h = h + s
        # blocks
        h = self.blocks(h)
        # head
        s = self.h_proj(h)
        s = torch.nn.functional.avg_pool1d(s, 2, 2)
        h = self.h_act2(self.h_bn(self.h_a(self.h_act(h))))
        h = self.h_bnb(self.h_b(h))
        h = self.h_pool(h)
        h = h + s
        h = self.h_act3(self.h_cbn(self.h_c(h)))
        v = self.gap(h)  # (B,512)
        o = self.cfc(v)  # (B,22)
        M = o.shape[1] // 2
        Or, Oi = o[:, :M], o[:, M:]
        mag = torch.sqrt(Or * Or + Oi * Oi + 1e-12)
        return mag  # logits for CrossEntropy

    def count_params(self):
        return sum(p.numel() for p in self.parameters() if p.requires_grad)
