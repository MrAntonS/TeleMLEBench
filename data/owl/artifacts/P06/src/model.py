"""MCCFN model — Multi-scale Complex-valued Convolutional Fusion Network."""
import math
import torch
import torch.nn as nn


class ComplexConv1d(nn.Module):
    """Emulates complex convolution (paper Eq.10, Fig.1 center) with real Conv1d.

    Input real tensor x of shape (B, Cin_real, L).
    Interpreted as complex with Cin_c = Cin_real//2 complex channels,
    except the first layer where Cin_real=2 means 1 complex channel
    (I = channel 0, Q = channel 1).
    Output real tensor of shape (B, Cout_real, L) = concat([real, imag]),
    each with Cout_c = Cout_real//2 channels.
    Two real kernels Kr, Ki of shape (Cout_c, Cin_c, k).
    y_r = xr*Kr - xi*Ki ; y_i = xr*Ki + xi*Kr.
    BN+ReLU applied outside on the concatenated real tensor (paper Fig.1
    shows BN+ReLU on real-valued feature maps of sizes 12/48/...).
    """

    def __init__(self, cin_real, cout_real, kernel_size, padding):
        super().__init__()
        assert cout_real % 2 == 0, "Cout_real must be even"
        cin_c = cin_real // 2 if cin_real > 1 else 1
        # first layer cin_real=2 -> cin_c=1 correct; all others even
        if cin_real % 2 == 1:
            raise ValueError("cin_real must be even (pairs of real/imag)")
        cout_c = cout_real // 2
        self.cin_c = cin_c
        self.cout_c = cout_c
        self.conv_r = nn.Conv1d(cin_c, cout_c, kernel_size, padding=padding, bias=False)
        self.conv_i = nn.Conv1d(cin_c, cout_c, kernel_size, padding=padding, bias=False)

    def forward(self, x):
        if x.size(1) == 2 and self.cin_c == 1:
            xr = x[:, 0:1, :]
            xi = x[:, 1:2, :]
        else:
            halves = x.chunk(2, dim=1)
            xr, xi = halves[0], halves[1]
            # handle odd split safety (should not happen with our channel choices)
        yr = self.conv_r(xr) - self.conv_i(xi)
        yi = self.conv_i(xr) + self.conv_r(xi)
        return torch.cat([yr, yi], dim=1)


class ComplexBlock(nn.Module):
    def __init__(self, cin, cout, k=3, p=1):
        super().__init__()
        self.conv = ComplexConv1d(cin, cout, k, p)
        self.bn = nn.BatchNorm1d(cout)
        self.relu = nn.ReLU(inplace=True)

    def forward(self, x):
        return self.relu(self.bn(self.conv(x)))


class ChannelAttention(nn.Module):
    """Multi-head self-attention over channel tokens (paper Sec 3.1, Eq.5-6).

    Input X5 in R^{B,C,L} (paper: R^{C x L}). Tokens = C channels, each with
    feature dim L=128. Three Linear layers map L -> dk (Q,K) and L -> dv (V)
    per head; h=2. head = softmax(QK^T/sqrt(dk)) V  (C x dv).
    Concat heads (C x 2dv) -> Linear(2dv -> L) restores (C x L), then dropout.
    dk/dv unspecified in paper; chosen 64 (see MISSING_PARAMETERS.md).
    """

    def __init__(self, L=128, dk=64, dv=64, n_heads=2, dropout_p=0.5):
        super().__init__()
        self.n_heads = n_heads
        self.dk = dk
        self.dv = dv
        self.q_linears = nn.ModuleList([nn.Linear(L, dk) for _ in range(n_heads)])
        self.k_linears = nn.ModuleList([nn.Linear(L, dk) for _ in range(n_heads)])
        self.v_linears = nn.ModuleList([nn.Linear(L, dv) for _ in range(n_heads)])
        self.out_linear = nn.Linear(n_heads * dv, L)
        self.dropout = nn.Dropout(dropout_p)

    def forward(self, x):
        # x: (B,C,L)
        heads = []
        for h in range(self.n_heads):
            Q = self.q_linears[h](x)  # (B,C,dk)
            K = self.k_linears[h](x)
            V = self.v_linears[h](x)  # (B,C,dv)
            scores = torch.matmul(Q, K.transpose(-2, -1)) / math.sqrt(self.dk)
            attn = torch.softmax(scores, dim=-1)
            heads.append(torch.matmul(attn, V))  # (B,C,dv)
        concat = torch.cat(heads, dim=-1)  # (B,C,2dv)
        out = self.out_linear(concat)  # (B,C,L)
        return self.dropout(out)

    def set_dropout_p(self, p):
        self.dropout.p = p


class MCCFN(nn.Module):
    def __init__(self, num_classes=11, L=128, dk=64, dv=64, heads=2, dropout_p=0.5):
        super().__init__()
        # Multi-scale branches: out 12 each, kernels 7/5/3, pads 3/2/1 (Eq.3)
        self.branch7 = ComplexBlock(2, 12, k=7, p=3)
        self.branch5 = ComplexBlock(2, 12, k=5, p=2)
        self.branch3 = ComplexBlock(2, 12, k=3, p=1)
        # Four progressive blocks 48/64/128/256, kernel 3 pad 1 (Fig.1 bottom)
        self.b1 = ComplexBlock(36, 48, k=3, p=1)
        self.b2 = ComplexBlock(48, 64, k=3, p=1)
        self.b3 = ComplexBlock(64, 128, k=3, p=1)
        self.b4 = ComplexBlock(128, 256, k=3, p=1)
        self.attn = ChannelAttention(L=L, dk=dk, dv=dv, n_heads=heads, dropout_p=dropout_p)
        self.gap = nn.AdaptiveAvgPool1d(1)
        self.fc1 = nn.Linear(256, 512)
        self.relu = nn.ReLU(inplace=True)
        self.dropout = nn.Dropout(dropout_p)
        self.fc2 = nn.Linear(512, num_classes)

    def forward(self, x):
        # x: (B,2,128)
        f7 = self.branch7(x)
        f5 = self.branch5(x)
        f3 = self.branch3(x)
        x1 = torch.cat([f7, f5, f3], dim=1)  # B,36,128
        x2 = self.b1(x1)
        x3 = self.b2(x2)
        x4 = self.b3(x3)
        x5 = self.b4(x4)  # B,256,128
        x6 = self.attn(x5)  # B,256,128
        g = self.gap(x6).squeeze(-1)  # B,256
        h = self.fc1(g)
        h = self.relu(h)
        h = self.dropout(h)
        return self.fc2(h)

    def set_dropout_p(self, p):
        self.attn.set_dropout_p(p)
        self.dropout.p = p
