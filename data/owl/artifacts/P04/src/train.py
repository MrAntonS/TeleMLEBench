"""Train MCDformer on train/val only. Writes checkpoints/best.pt + TRAINING_HISTORY.csv."""
import os, sys, csv, time, torch, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dataset import load_all, stratified_split
from model import MCDformer
from torch.utils.data import TensorDataset, DataLoader

def acc_of(logits, y): return (logits.argmax(1)==y).float().mean().item()

def main(max_epochs=40, patience=8, batch=32, lr=0.0005, seed=0, subset=None, out_hist='~/workspace/TRAINING_HISTORY.csv', ckpt='~/workspace/checkpoints/best.pt'):
    torch.manual_seed(seed); np.random.seed(seed)
    X,y,s = load_all()
    (Xtr,ytr,str_),(Xva,yva,sva),_,split_desc,split_sha = stratified_split(X,y,s,seed=seed)
    if subset:  # pilot: small balanced subset
        n = subset
        Xtr,ytr = Xtr[:n],ytr[:n]; Xva,yva = Xva[:min(n//3,len(Xva))],yva[:min(n//3,len(Xva))]
    dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    tl = DataLoader(TensorDataset(torch.from_numpy(Xtr),torch.from_numpy(ytr)),batch_size=batch,shuffle=True,num_workers=4,pin_memory=True)
    vl = DataLoader(TensorDataset(torch.from_numpy(Xva),torch.from_numpy(yva)),batch_size=512,shuffle=False,num_workers=4,pin_memory=True)
    m = MCDformer().to(dev)
    print('params:', m.param_count(), flush=True)
    opt = torch.optim.Adam(m.parameters(), lr=lr)
    lossf = torch.nn.CrossEntropyLoss()
    scaler = torch.cuda.amp.GradScaler(enabled=(dev.type=='cuda'))
    best_va=-1; bad=0; hist=[]
    for ep in range(max_epochs):
        t0=time.time(); m.train(); tl_sum=tl_n=0; tl_c=0
        for xb,yb in tl:
            xb,yb = xb.to(dev,non_blocking=True), yb.to(dev,non_blocking=True)
            opt.zero_grad()
            with torch.cuda.amp.autocast(enabled=(dev.type=='cuda')):
                out=m(xb); loss=lossf(out,yb)
            scaler.scale(loss).backward(); scaler.step(opt); scaler.update()
            tl_sum+=loss.item()*len(xb); tl_c+=(out.argmax(1)==yb).sum().item(); tl_n+=len(xb)
        m.eval(); vs=vc=vn=0
        with torch.no_grad():
            for xb,yb in vl:
                xb,yb=xb.to(dev,non_blocking=True),yb.to(dev,non_blocking=True)
                out=m(xb); vs+=lossf(out,yb).item()*len(xb); vc+=(out.argmax(1)==yb).sum().item(); vn+=len(xb)
        trl=tl_sum/tl_n; tra=tl_c/tl_n; vl_=vs/vn; vaa=vc/vn
        dt=time.time()-t0
        print(f"ep{ep+1}/{max_epochs} tr_loss={trl:.4f} tr_acc={tra:.4f} val_loss={vl_:.4f} val_acc={vaa:.4f} lr={lr} {dt:.1f}s", flush=True)
        hist.append((ep+1,trl,tra,vl_,vaa,lr))
        if vaa>best_va+1e-6: best_va=vaa; bad=0; os.makedirs(os.path.dirname(ckpt),exist_ok=True); torch.save({'model':m.state_dict(),'ep':ep+1,'val_acc':vaa},ckpt)
        else: bad+=1
        if bad>=patience: print('early stop',flush=True); break
    with open(out_hist,'w',newline='') as f:
        w=csv.writer(f); w.writerow(['epoch','train_loss','train_acc','val_loss','val_acc','lr']); w.writerows(hist)
    print('BEST_VAL',best_va,'SPLIT_SHA',split_sha,flush=True)

if __name__=='__main__':
    import argparse
    a=argparse.ArgumentParser(); a.add_argument('--epochs',type=int,default=40); a.add_argument('--patience',type=int,default=8)
    a.add_argument('--subset',type=int,default=None); a.add_argument('--seed',type=int,default=0)
    o=a.parse_args(); main(max_epochs=o.epochs,patience=o.patience,subset=o.subset,seed=o.seed)
