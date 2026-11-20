"""AMC-Net model (paper Sec 2.2, Fig.1). PyTorch."""
import math
import torch
import torch.nn as nn


class ACM(nn.Module):
    """Adaptive Correction Module: FFT -> MLP scaling (Re/Im) -> IFFT -> add skip."""

    def __init__(self, L=128, hidden=48):
        super().__init__()
        self.mlp_re = nn.Sequential(nn.Linear(L, hidden), nn.ReLU(), nn.Linear(hidden, L))
        self.mlp_im = nn.Sequential(nn.Linear(L, hidden), nn.ReLU(), nn.Linear(hidden, L))

    def forward(self, x):
        # x: (B, 2, L) real I/Q
        xc = torch.complex(x[:, 0, :], x[:, 1, :])          # (B, L) complex
        Xc = torch.fft.fft(xc, norm="backward")            # Eq.1 unnormalized forward
        Xr, Xi = Xc.real, Xc.imag                           # (B, L)
        wr = torch.tanh(self.mlp_re(Xr))                   # (B, L) in [-1,1]
        wi = torch.tanh(self.mlp_im(Xi))
        Xhat = torch.complex(wr * Xr, wi * Xi)             # Eq.2
        xhat_c = torch.fft.ifft(Xhat, norm="backward")     # Eq.3 (1/N)
        xhat = torch.stack([xhat_c.real, xhat_c.imag], dim=1)  # (B, 2, L)
        return x + xhat                                    # skip Add (Fig.1)


class MSM(nn.Module):
    """Multi-Scale Module: 3 branches Conv2d(1->12, (2,k)) + BN + ReLU, concat."""

    def __init__(self):
        super().__init__()
        self.branches = nn.ModuleList()
        for k in (3, 5, 7):
            self.branches.append(nn.Sequential(
                nn.Conv2d(1, 12, kernel_size=(2, k), padding=(0, k // 2)),
                nn.BatchNorm2d(12),
                nn.ReLU(inplace=True),
            ))

    def forward(self, x):
        # x: (B, 2, L) -> (B, 1, 2, L)
        h = x.unsqueeze(1)
        outs = [b(h) for b in self.branches]  # each (B, 12, 1, L)
        return torch.cat(outs, dim=1).squeeze(2)  # (B, 36, L)


class FFM(nn.Module):
    """Feature Fusion Module: 2-head self-attention (paper Eq.5-7).

    mode="temporal": scores = Q K^T / sqrt(dk) over positions (LxL map), mixes time.
      Matches the paper's "long-distance dependence / entire sequence" intent.
    mode="channel": literal Eq.5 with Q,K,V in R^{dkxL}: scores = Q K^T (dkxdk map),
      mixes the dk feature dim, preserves L. Matches the printed equations.
    Both give (B, h*dk, L).
    """

    def __init__(self, C=256, n_heads=2, dk=64, mode="temporal"):
        super().__init__()
        assert mode in ("temporal", "channel")
        self.h = n_heads
        self.dk = dk
        self.mode = mode
        self.Wq = nn.ModuleList([nn.Linear(C, dk) for _ in range(n_heads)])
        self.Wk = nn.ModuleList([nn.Linear(C, dk) for _ in range(n_heads)])
        self.Wv = nn.ModuleList([nn.Linear(C, dk) for _ in range(n_heads)])

    def forward(self, x):
        # x: (B, C, L)
        if self.mode == "temporal":
            xt = x.transpose(1, 2)  # (B, L, C)
            heads = []
            for i in range(self.h):
                Q = self.Wq[i](xt)  # (B, L, dk)
                K = self.Wk[i](xt)
                V = self.Wv[i](xt)
                scores = torch.matmul(Q, K.transpose(1, 2)) / math.sqrt(self.dk)  # (B,L,L)
                A = torch.softmax(scores, dim=-1)
                heads.append(torch.matmul(A, V))  # (B, L, dk)
            return torch.cat(heads, dim=-1).transpose(1, 2)  # (B, h*dk, L)
        else:  # literal Eq.5: Q,K,V in R^{dkxL}, softmax(QK^T/sqrt(dk)) V
            heads = []
            for i in range(self.h):
                Q = self.Wq[i](x.transpose(1, 2)).transpose(1, 2)  # (B, dk, L)
                K = self.Wk[i](x.transpose(1, 2)).transpose(1, 2)
                V = self.Wv[i](x.transpose(1, 2)).transpose(1, 2)
                scores = torch.matmul(Q, K.transpose(1, 2)) / math.sqrt(self.dk)  # (B,dk,dk)
                A = torch.softmax(scores, dim=-1)
                heads.append(torch.matmul(A, V))  # (B, dk, L)
            return torch.cat(heads, dim=1)  # (B, h*dk, L)


class NoACM(nn.Module):
    def forward(self, x):
        return x


class AMCNet(nn.Module):
    def __init__(self, n_classes=11, L=128, acm_hidden=48, n_heads=2, dk=64,
                 ffm_mode="temporal", use_acm=True):
        super().__init__()
        self.acm = ACM(L, acm_hidden) if use_acm else NoACM()
        self.msm = MSM()
        self.backbone = nn.Sequential(
            nn.Conv1d(36, 64, 3, padding=1), nn.ReLU(inplace=True),
            nn.Conv1d(64, 128, 3, padding=1), nn.ReLU(inplace=True),
            nn.Conv1d(128, 256, 3, padding=1), nn.ReLU(inplace=True),
        )
        self.ffm = FFM(256, n_heads, dk, mode=ffm_mode)
        fc_in = n_heads * dk
        self.classifier = nn.Sequential(
            nn.Linear(fc_in, 512), nn.ReLU(inplace=True),
            nn.Linear(512, 256), nn.ReLU(inplace=True),
            nn.Linear(256, n_classes),
        )
        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, (nn.Conv1d, nn.Conv2d, nn.Linear)):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)
            elif isinstance(m, (nn.BatchNorm1d, nn.BatchNorm2d)):
                nn.init.ones_(m.weight)
                nn.init.zeros_(m.bias)

    def forward(self, x):
        x = self.acm(x)
        x = self.msm(x)
        x = self.backbone(x)
        x = self.ffm(x)
        x = x.mean(dim=2)  # GAP over time
        return self.classifier(x)


def count_params(model):
    return sum(p.numel() for p in model.parameters() if p.requires_grad)
