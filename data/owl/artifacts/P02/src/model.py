import torch
import torch.nn as nn

class PUOperator(nn.Module):
    """Fig2(c): ReflectionPad -> Conv1d(1x3, mix) -> ReLU -> ReflectionPad -> Depthwise Conv1d(1x3) -> Tanh."""
    def __init__(self, channels=64):
        super().__init__()
        self.net = nn.Sequential(
            nn.ReflectionPad1d(1),
            nn.Conv1d(channels, channels, kernel_size=3, padding=0),
            nn.ReLU(inplace=True),
            nn.ReflectionPad1d(1),
            nn.Conv1d(channels, channels, kernel_size=3, padding=0, groups=channels),
            nn.Tanh(),
        )
    def forward(self, x):
        return self.net(x)

class AWN(nn.Module):
    def __init__(self, num_classes=11, seq_len=128, C=64, T=1, fc_hidden=320, attn_reduction=4):
        super().__init__()
        self.C = C; self.T = T
        self.conv_in = nn.Sequential(
            nn.Conv2d(1, C, kernel_size=(2,7), padding=(0,3)),
            nn.BatchNorm2d(C),
            nn.ReLU(inplace=True),
        )
        self.conv2 = nn.Sequential(
            nn.Conv1d(C, C, kernel_size=5, padding=2),
            nn.BatchNorm1d(C),
            nn.ReLU(inplace=True),
        )
        self.conv3 = nn.Sequential(
            nn.Conv1d(C, C, kernel_size=3, padding=1),
            nn.BatchNorm1d(C),
            nn.ReLU(inplace=True),
        )
        self.Ps = nn.ModuleList([PUOperator(C) for _ in range(T)])
        self.Us = nn.ModuleList([PUOperator(C) for _ in range(T)])
        feat_dim = C*(T+1)
        self.attn = nn.Sequential(
            nn.Linear(feat_dim, feat_dim//attn_reduction),
            nn.ReLU(inplace=True),
            nn.Linear(feat_dim//attn_reduction, feat_dim),
            nn.Sigmoid(),
        )
        self.classifier = nn.Sequential(
            nn.Linear(feat_dim, fc_hidden),
            nn.ReLU(inplace=True),
            nn.Linear(fc_hidden, num_classes),
        )
    def forward(self, x, return_aux=False):
        # x: (B,1,2,L) or (B,2,L)
        if x.dim() == 3:
            x = x.unsqueeze(1)  # (B,1,2,L)
        h = self.conv_in(x).squeeze(2)  # (B,C,L)
        h = self.conv2(h)
        F0 = self.conv3(h)  # (B,C,L)
        F = F0
        Hs, Ls = [], []
        for i in range(self.T):
            Feven = F[:, :, 0::2].contiguous()
            Fodd = F[:, :, 1::2].contiguous()
            Hi = Fodd - self.Ps[i](Feven)
            Li = Feven + self.Us[i](Hi)
            Hs.append(Hi); Ls.append(Li)
            F = Li
        # GAP + concat: low-frequency last + highs
        parts = [Li.mean(dim=2) for Li in [Ls[-1]]] + [Hi.mean(dim=2) for Hi in Hs]
        X = torch.cat(parts, dim=1)
        att = self.attn(X)
        Xt = X * att
        logits = self.classifier(Xt)
        if return_aux:
            return logits, Hs, Ls, F0
        return logits

def awn_loss(logits, y, Hs, Ls, F0, l1=0.01, l2=0.01):
    import torch.nn.functional as F
    ce = F.cross_entropy(logits, y)
    lh = torch.zeros((), device=logits.device)
    ll = torch.zeros((), device=logits.device)
    for Hi in Hs:
        lh = lh + Hi.abs().mean()
    lh = 0.01*lh if False else l1*lh
    Fbar = F0.mean()
    for Li in Ls:
        ll = ll + (Li.mean() - Fbar).abs()
    ll = l2*ll
    return ce + lh + ll, ce.detach(), lh.detach(), ll.detach()

def count_params(m):
    return sum(p.numel() for p in m.parameters() if p.requires_grad)
