"""MCDformer: FDDM + 4-layer CNN backbone + DTM(2 blocks + distillation) + MLP head. Paper Sec III, Fig.1-2."""
import torch, torch.nn as nn

class FDDM(nn.Module):
    def __init__(self, L=128, hidden=32):
        super().__init__()
        self.mlp = nn.Sequential(nn.Linear(L, hidden), nn.ReLU(), nn.Linear(hidden, L), nn.Sigmoid())
    def forward(self, x):  # x: (B,2,L)
        It, Qt = x[:,0,:], x[:,1,:]
        If = torch.fft.fft(It, dim=-1); Qf = torch.fft.fft(Qt, dim=-1)
        gI = self.mlp(torch.abs(If)); gQ = self.mlp(torch.abs(Qf))
        It2 = torch.fft.ifft(If*gI, dim=-1).real + It
        Qt2 = torch.fft.ifft(Qf*gQ, dim=-1).real + Qt
        return torch.stack([It2, Qt2], dim=1)

class CNNBackbone(nn.Module):
    def __init__(self):
        super().__init__()
        def blk(cin,cout,kh):
            return nn.Sequential(nn.Conv2d(cin,cout,(kh,3),padding=(0,1)), nn.BatchNorm2d(cout), nn.ReLU())
        self.l1 = blk(1,36,1); self.l2 = blk(36,64,2); self.l3 = blk(64,128,1); self.l4 = blk(128,256,1)
    def forward(self, x):  # (B,2,L)
        h = x.unsqueeze(1)  # (B,1,2,L)
        h = self.l1(h); h = self.l2(h); h = self.l3(h); h = self.l4(h)  # (B,256,1,L)
        return h.squeeze(2)  # (B,256,L)

class MultiHeadFeatureAttention(nn.Module):
    """Attention over channel axis: X(B,C,L) -> Q(B,C,dk) per head; map C x C. dk=dv=L/h."""
    def __init__(self, L, h=2, dropout=0.5):
        super().__init__()
        assert L % h == 0
        self.h=h; self.dk=L//h
        self.WQ=nn.ModuleList([nn.Linear(L,self.dk) for _ in range(h)])
        self.WK=nn.ModuleList([nn.Linear(L,self.dk) for _ in range(h)])
        self.WV=nn.ModuleList([nn.Linear(L,self.dk) for _ in range(h)])
        self.WO=nn.Linear(h*self.dk, L)
        self.drop=nn.Dropout(dropout)
    def forward(self, X):
        outs=[]
        for i in range(self.h):
            Q=self.WQ[i](X); K=self.WK[i](X); V=self.WV[i](X)
            A=torch.softmax(Q@K.transpose(-1,-2)/(self.dk**0.5), dim=-1)
            A=self.drop(A)
            outs.append(A@V)
        return self.WO(torch.cat(outs,dim=-1))

class Block(nn.Module):
    def __init__(self, L, h=2, dropout=0.5, ff_mult=4):
        super().__init__()
        self.attn=MultiHeadFeatureAttention(L,h,dropout)
        self.n1=nn.LayerNorm(L); self.n2=nn.LayerNorm(L)
        self.ffn=nn.Sequential(nn.Linear(L,ff_mult*L),nn.ReLU(),nn.Dropout(dropout),nn.Linear(ff_mult*L,L),nn.Dropout(dropout))
    def forward(self, X):
        X = X + self.attn(self.n1(X))
        X = X + self.ffn(self.n2(X))
        return X

class Distillation(nn.Module):
    def __init__(self, C=256):
        super().__init__()
        self.conv=nn.Conv1d(C,C,3,padding=1); self.elu=nn.ELU(); self.bn=nn.BatchNorm1d(C)
        self.pool=nn.MaxPool1d(3,stride=2,padding=1)
    def forward(self,X):
        return self.pool(self.bn(self.elu(self.conv(X))))

class MCDformer(nn.Module):
    def __init__(self, L=128, nclass=11, heads=2, fddm_hidden=32, clf_hidden=256, dropout=0.5):
        super().__init__()
        self.fddm=FDDM(L,fddm_hidden)
        self.cnn=CNNBackbone()
        self.block1=Block(L,heads,dropout)
        self.distill=Distillation(256)
        self.block2=Block(L//2,heads,dropout)
        self.head=nn.Sequential(nn.Linear(256,clf_hidden),nn.ReLU(),nn.Dropout(dropout),nn.Linear(clf_hidden,nclass))
    def forward(self,x):
        x=self.fddm(x); z=self.cnn(x)       # (B,256,L)
        z=self.block1(z); z=self.distill(z) # (B,256,L/2)
        z=self.block2(z)
        return self.head(z[:,:,-1])          # last time-step -> classes
    def param_count(self):
        return sum(p.numel() for p in self.parameters())
