"""Complex-valued layers for CDSCNN (Xiao et al. TIM 2023)."""
import torch
import torch.nn as nn


class ComplexConv1d(nn.Module):
    """Complex conv: out_r = conv(xr,Wr)-conv(xi,Wi), out_i = conv(xr,Wi)+conv(xi,Wr).
    Tensor layout: (B, 2N, L), first N real, last N imag. N complex in, M complex out."""
    def __init__(self, in_complex, out_complex, kernel_size=3, stride=1, padding=0, bias=True):
        super().__init__()
        self.N = in_complex
        self.M = out_complex
        self.conv_r = nn.Conv1d(in_complex, out_complex, kernel_size, stride=stride, padding=padding, bias=False)
        self.conv_i = nn.Conv1d(in_complex, out_complex, kernel_size, stride=stride, padding=padding, bias=False)
        if bias:
            self.bias_r = nn.Parameter(torch.zeros(out_complex))
            self.bias_i = nn.Parameter(torch.zeros(out_complex))
        else:
            self.register_parameter('bias_r', None)
            self.register_parameter('bias_i', None)

    def forward(self, x):
        N = self.N
        xr, xi = x[:, :N, :], x[:, N:, :]
        yr = self.conv_r(xr) - self.conv_i(xi)
        yi = self.conv_r(xi) + self.conv_i(xr)
        if self.bias_r is not None:
            yr = yr + self.bias_r.view(1, -1, 1)
            yi = yi + self.bias_i.view(1, -1, 1)
        return torch.cat([yr, yi], dim=1)


class DepthwiseRealConv1d(nn.Module):
    def __init__(self, channels, kernel_size=3, stride=1, padding=1, bias=True):
        super().__init__()
        self.conv = nn.Conv1d(channels, channels, kernel_size, stride=stride,
                              padding=padding, groups=channels, bias=bias)

    def forward(self, x):
        return self.conv(x)


class CDSC(nn.Module):
    """Complex-valued depthwise separable conv: real DWC + complex 1x1 PWC."""
    def __init__(self, in_complex, out_complex, kernel_size=3, stride=1, padding=1, bias=True):
        super().__init__()
        self.N = in_complex
        self.M = out_complex
        self.dwc = nn.Conv1d(2 * in_complex, 2 * in_complex, kernel_size,
                             stride=stride, padding=padding, groups=2 * in_complex, bias=True)
        self.pwc = ComplexConv1d(in_complex, out_complex, kernel_size=1, bias=bias)

    def forward(self, x):
        return self.pwc(self.dwc(x))


class ComplexBatchNorm1d(nn.Module):
    """CBN via 2D whitening per complex channel (Trabelsi et al. Deep Complex Networks)."""
    def __init__(self, num_complex, eps=1e-5, momentum=0.1):
        super().__init__()
        self.N = num_complex
        self.eps = eps
        self.momentum = momentum
        self.register_buffer('running_mean_r', torch.zeros(num_complex))
        self.register_buffer('running_mean_i', torch.zeros(num_complex))
        self.register_buffer('running_Vrr', torch.ones(num_complex))
        self.register_buffer('running_Vii', torch.ones(num_complex))
        self.register_buffer('running_Vri', torch.zeros(num_complex))
        # learnable gamma (2x2 spd): rr, ii, ri ; beta complex
        self.gamma_rr = nn.Parameter(torch.full((num_complex,), 1.0 / 2**0.5))
        self.gamma_ii = nn.Parameter(torch.full((num_complex,), 1.0 / 2**0.5))
        self.gamma_ri = nn.Parameter(torch.zeros(num_complex))
        self.beta_r = nn.Parameter(torch.zeros(num_complex))
        self.beta_i = nn.Parameter(torch.zeros(num_complex))

    def forward(self, x):
        N = self.N
        xr, xi = x[:, :N, :], x[:, N:, :]
        if self.training:
            mu_r = xr.mean(dim=(0, 2))
            mu_i = xi.mean(dim=(0, 2))
            xr0 = xr - mu_r.view(1, -1, 1)
            xi0 = xi - mu_i.view(1, -1, 1)
            Vrr = (xr0 * xr0).mean(dim=(0, 2)) + self.eps
            Vii = (xi0 * xi0).mean(dim=(0, 2)) + self.eps
            Vri = (xr0 * xi0).mean(dim=(0, 2))
            with torch.no_grad():
                m = self.momentum
                self.running_mean_r.mul_(1 - m).add_(mu_r * m)
                self.running_mean_i.mul_(1 - m).add_(mu_i * m)
                self.running_Vrr.mul_(1 - m).add_(Vrr * m)
                self.running_Vii.mul_(1 - m).add_(Vii * m)
                self.running_Vri.mul_(1 - m).add_(Vri * m)
        else:
            mu_r, mu_i = self.running_mean_r, self.running_mean_i
            Vrr, Vii, Vri = self.running_Vrr, self.running_Vii, self.running_Vri
            xr0 = xr - mu_r.view(1, -1, 1)
            xi0 = xi - mu_i.view(1, -1, 1)
        # inverse sqrt of 2x2 cov per channel: tau=(Vrr+Vii), delta=(Vrr*Vii-Vri^2)
        tau = Vrr + Vii + self.eps
        delta = (Vrr * Vii - Vri * Vri).clamp_min(self.eps)
        s = torch.sqrt(delta)
        t = torch.sqrt(tau + 2 * s)
        inv_s_t = 1.0 / (s * t + self.eps)
        Wrr = (Vii + s) * inv_s_t
        Wii = (Vrr + s) * inv_s_t
        Wri = -Vri * inv_s_t
        zr = Wrr.view(1, -1, 1) * xr0 + Wri.view(1, -1, 1) * xi0
        zi = Wri.view(1, -1, 1) * xr0 + Wii.view(1, -1, 1) * xi0
        grr, gii, gri = self.gamma_rr, self.gamma_ii, self.gamma_ri
        yr = grr.view(1, -1, 1) * zr + gri.view(1, -1, 1) * zi + self.beta_r.view(1, -1, 1)
        yi = gri.view(1, -1, 1) * zr + gii.view(1, -1, 1) * zi + self.beta_i.view(1, -1, 1)
        return torch.cat([yr, yi], dim=1)


class CReLU(nn.Module):
    def forward(self, x):
        return torch.relu(x)


class ComplexMaxPool1d(nn.Module):
    """CMP: maxpool on magnitude, gather matching complex entries."""
    def __init__(self, kernel_size=2, stride=2):
        super().__init__()
        self.k = kernel_size
        self.s = stride if stride is not None else kernel_size

    def forward(self, x):
        N = x.shape[1] // 2
        xr, xi = x[:, :N, :], x[:, N:, :]
        mag = torch.sqrt(xr * xr + xi * xi + 1e-12)
        pooled, idx = torch.nn.functional.max_pool1d(mag, self.k, self.s, return_indices=True)
        # gather along time dim
        B, C, L = pooled.shape
        xr_p = torch.gather(xr, 2, idx)
        xi_p = torch.gather(xi, 2, idx)
        return torch.cat([xr_p, xi_p], dim=1)


class ComplexAvgPool1d(nn.Module):
    def __init__(self, kernel_size=2, stride=2):
        super().__init__()
        self.k = kernel_size
        self.s = stride if stride is not None else kernel_size

    def forward(self, x):
        return torch.nn.functional.avg_pool1d(x, self.k, self.s)


class ComplexGlobalAvgPool1d(nn.Module):
    def forward(self, x):
        return x.mean(dim=2)


class ComplexLinear(nn.Module):
    """CFC: (B,2N) -> (B,2M)."""
    def __init__(self, in_complex, out_complex, bias=True):
        super().__init__()
        self.N = in_complex
        self.M = out_complex
        self.Wr = nn.Parameter(torch.randn(out_complex, in_complex) * (1.0 / in_complex**0.5))
        self.Wi = nn.Parameter(torch.randn(out_complex, in_complex) * (1.0 / in_complex**0.5))
        if bias:
            self.br = nn.Parameter(torch.zeros(out_complex))
            self.bi = nn.Parameter(torch.zeros(out_complex))
        else:
            self.register_parameter('br', None)
            self.register_parameter('bi', None)

    def forward(self, x):
        N = self.N
        xr, xi = x[:, :N], x[:, N:]
        yr = torch.nn.functional.linear(xr, self.Wr) - torch.nn.functional.linear(xi, self.Wi)
        yi = torch.nn.functional.linear(xr, self.Wi) + torch.nn.functional.linear(xi, self.Wr)
        if self.br is not None:
            yr = yr + self.br
            yi = yi + self.bi
        return torch.cat([yr, yi], dim=1)
