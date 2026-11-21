"""ICRNNA model (PyTorch) per paper Fig.2 + Sec.3.
Input (B,2,128) -> Conv1d(2->64,k3,pad1)+ReLU+BN -> Conv1d(64->128,k3,pad1)+ReLU+BN
-> MaxPool1d(2) -> Dropout(0.3) -> (B,128,64) -> transpose -> (B,64,128)
-> BiLSTM(128 in,128 hid, bidirectional) + BN + Dropout(0.3)
-> BiLSTM(256 in,128 hid, bidirectional) + BN + Dropout(0.3) -> (B,64,256)
-> Improved Additive Attention (per-timestep Bahdanau, scaling, dropout 0.1, LayerNorm)
-> Dense 128 ReLU BN Drop0.3 -> Dense 64 ReLU BN Drop0.3 -> Linear 11.
"""
import torch
import torch.nn as nn

class ImprovedAdditiveAttention(nn.Module):
    def __init__(self, dim, attn_dim=None, dropout=0.1, use_scale=True):
        super().__init__()
        attn_dim = attn_dim or dim
        self.wq = nn.Linear(dim, attn_dim)
        self.wk = nn.Linear(dim, attn_dim)
        self.v = nn.Linear(attn_dim, 1, bias=False)
        self.scale = (attn_dim ** -0.5) if use_scale else 1.0
        self.dropout = nn.Dropout(dropout)
        self.layernorm = nn.LayerNorm(dim)
    def forward(self, h):
        # h: (B,T,D)
        q = self.wq(h); k = self.wk(h)
        e = self.v(torch.tanh(q + k)).squeeze(-1) * self.scale  # (B,T)
        alpha = torch.softmax(e, dim=1)  # Eq.5
        alpha_d = self.dropout(alpha)
        ctx = torch.bmm(alpha_d.unsqueeze(1), h).squeeze(1)  # Eq.6 (B,D)
        return self.layernorm(ctx), alpha

class ICRNNA(nn.Module):
    def __init__(self, n_classes=11, dropout=0.3, attn_dropout=0.1, lstm_units=128):
        super().__init__()
        self.conv1 = nn.Conv1d(2, 64, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm1d(64)
        self.conv2 = nn.Conv1d(64, 128, kernel_size=3, padding=1)
        self.bn2 = nn.BatchNorm1d(128)
        self.pool = nn.MaxPool1d(2)
        self.drop_cnn = nn.Dropout(dropout)
        self.lstm1 = nn.LSTM(128, lstm_units, batch_first=True, bidirectional=True)
        self.bn_l1 = nn.BatchNorm1d(lstm_units*2)
        self.drop1 = nn.Dropout(dropout)
        self.lstm2 = nn.LSTM(lstm_units*2, lstm_units, batch_first=True, bidirectional=True)
        self.bn_l2 = nn.BatchNorm1d(lstm_units*2)
        self.drop2 = nn.Dropout(dropout)
        self.attn = ImprovedAdditiveAttention(lstm_units*2, attn_dim=128, dropout=attn_dropout, use_scale=True)
        self.fc1 = nn.Linear(lstm_units*2, 128)
        self.bn_f1 = nn.BatchNorm1d(128)
        self.drop_f1 = nn.Dropout(dropout)
        self.fc2 = nn.Linear(128, 64)
        self.bn_f2 = nn.BatchNorm1d(64)
        self.drop_f2 = nn.Dropout(dropout)
        self.out = nn.Linear(64, n_classes)
        self.relu = nn.ReLU()
    def forward(self, x):
        # x: (B,2,128)
        h = self.relu(self.bn1(self.conv1(x)))
        h = self.relu(self.bn2(self.conv2(h)))
        h = self.pool(h)  # (B,128,64)
        h = self.drop_cnn(h)
        h = h.transpose(1,2)  # (B,64,128)
        o1,_ = self.lstm1(h)  # (B,64,256)
        o1n = self.bn_l1(o1.transpose(1,2)).transpose(1,2)
        o1n = self.drop1(o1n)
        o2,_ = self.lstm2(o1n)
        o2n = self.bn_l2(o2.transpose(1,2)).transpose(1,2)
        o2n = self.drop2(o2n)
        ctx,_ = self.attn(o2n)
        f = self.relu(self.bn_f1(self.fc1(ctx)))
        f = self.drop_f1(f)
        f = self.relu(self.bn_f2(self.fc2(f)))
        f = self.drop_f2(f)
        return self.out(f)

def count_params(m):
    return sum(p.numel() for p in m.parameters() if p.requires_grad)
