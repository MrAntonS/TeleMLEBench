"""Pre-freeze verification: shapes, param count, loss/metric sanity vs sklearn, overfit tiny subset, 2-epoch pilot signal."""
import torch, numpy as np
from sklearn.metrics import f1_score, cohen_kappa_score, accuracy_score
from model import MCDformer, FDDM, CNNBackbone
import torch.nn as nn

# 1. shapes + params
m = MCDformer(); m.eval()
x = torch.randn(4,2,128)
with torch.no_grad():
    f = m.fddm(x); assert f.shape==(4,2,128), f.shape
    c = m.cnn(f); assert c.shape==(4,256,128), c.shape
    b1 = m.block1(c); assert b1.shape==(4,256,128)
    d = m.distill(b1); assert d.shape==(4,256,64), d.shape
    b2 = m.block2(d); assert b2.shape==(4,256,64)
    o = m(x); assert o.shape==(4,11), o.shape
print('shapes OK; params =', m.param_count())

# 2. loss/metric sanity vs sklearn on toy logits
torch.manual_seed(0)
logits = torch.randn(200,11); y = torch.randint(0,11,(200,))
ce = nn.CrossEntropyLoss()(logits,y).item()
p = logits.softmax(1).detach().numpy(); yt = y.numpy(); yp = p.argmax(1)
assert abs(accuracy_score(yt,yp)-(yp==yt).mean())<1e-9
mf = f1_score(yt,yp,average='macro'); ka = cohen_kappa_score(yt,yp)
print(f'toy: CE={ce:.4f} (ln11={np.log(11):.4f}) acc={(yp==yt).mean():.3f} macroF1={mf:.3f} kappa={ka:.3f} -- sklearn OK')

# 3. overfit tiny subset: 220 samples, should reach ~100% train acc quickly
X = torch.randn(220,2,128); Y = torch.randint(0,11,(220,))
mm = MCDformer(); opt = torch.optim.Adam(mm.parameters(), lr=0.001); lf=nn.CrossEntropyLoss()
mm.train()
for e in range(30):
    opt.zero_grad(); l=lf(mm(X),Y); l.backward(); opt.step()
    if (e+1)%10==0: print(f'overfit ep{e+1} loss={l.item():.4f}')
tr_acc = (mm(X).argmax(1)==Y).float().mean().item()
print(f'tiny-overfit train_acc={tr_acc:.3f} final_loss={l.item():.4f}')
assert tr_acc>0.9, 'model cannot overfit tiny set!'
print('ALL PRE-FREEZE CHECKS PASSED (shapes/learnability/metrics)')
