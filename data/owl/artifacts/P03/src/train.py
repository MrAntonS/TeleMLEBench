"""Train ICRNNA on RML2016.10a. Uses only train/val. Saves best checkpoint on val accuracy."""
import os, csv, time, argparse, json
import numpy as np, torch
import torch.nn as nn
from torch.utils.data import TensorDataset, DataLoader
from dataset import load_all, make_splits, compute_norm_stats
from model import ICRNNA, count_params
from metrics import compute_metrics

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--epochs', type=int, default=58)
    ap.add_argument('--batch', type=int, default=32)
    ap.add_argument('--lr', type=float, default=1e-3)
    ap.add_argument('--wd', type=float, default=1e-4)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--pilot_frac', type=float, default=1.0)
    ap.add_argument('--out_ckpt', type=str, default='checkpoints/best.pt')
    ap.add_argument('--out_hist', type=str, default='TRAINING_HISTORY.csv')
    args = ap.parse_args()
    torch.manual_seed(args.seed); np.random.seed(args.seed)
    dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print('device', dev, flush=True)
    X, y, snr = load_all()
    tr, va, te = make_splits(X, y, snr, seed=args.seed)
    if args.pilot_frac < 1.0:
        rng = np.random.RandomState(args.seed)
        tr = rng.choice(tr, size=int(len(tr)*args.pilot_frac), replace=False)
        va = rng.choice(va, size=max(2000,int(len(va)*args.pilot_frac)), replace=False)
    mean, std = compute_norm_stats(X[tr])
    print(f'norm mean={mean:.6f} std={std:.6f} ntrain={len(tr)} nval={len(va)}', flush=True)
    Xn = (X - mean)/std
    def loader(idx, train):
        ds = TensorDataset(torch.from_numpy(Xn[idx]), torch.from_numpy(y[idx]))
        return DataLoader(ds, batch_size=args.batch, shuffle=train, num_workers=2, pin_memory=True)
    trL, vaL = loader(tr, True), loader(va, False)
    model = ICRNNA().to(dev)
    print('params', count_params(model), flush=True)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr, weight_decay=args.wd)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, mode='min', factor=0.2, patience=5, min_lr=1e-6)
    lossf = nn.CrossEntropyLoss()
    best_va = -1; best_ep = -1
    rows = []
    t0=time.time()
    for ep in range(1, args.epochs+1):
        model.train(); tl=0; tp=[]; tt=[]
        for xb, yb in trL:
            xb, yb = xb.to(dev), yb.to(dev)
            opt.zero_grad()
            out = model(xb)
            loss = lossf(out, yb)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            tl += loss.item()*len(xb)
            tp += out.argmax(1).cpu().tolist(); tt += yb.cpu().tolist()
        tr_loss = tl/len(tr); tr_acc = float((np.array(tp)==np.array(tt)).mean())
        model.eval(); vl=0; vp=[]; vt=[]
        with torch.no_grad():
            for xb, yb in vaL:
                xb, yb = xb.to(dev), yb.to(dev)
                out = model(xb)
                vl += lossf(out, yb).item()*len(xb)
                vp += out.argmax(1).cpu().tolist(); vt += yb.cpu().tolist()
        va_loss = vl/len(va); va_acc = float((np.array(vp)==np.array(vt)).mean())
        lr = opt.param_groups[0]['lr']
        sched.step(va_loss)
        rows.append((ep, tr_loss, tr_acc, va_loss, va_acc, lr))
        print(f'ep {ep}/{args.epochs} tr_loss={tr_loss:.4f} tr_acc={tr_acc:.4f} va_loss={va_loss:.4f} va_acc={va_acc:.4f} lr={lr:.2e} ({time.time()-t0:.0f}s)', flush=True)
        if va_acc > best_va:
            best_va = va_acc; best_ep = ep
            os.makedirs(os.path.dirname(args.out_ckpt) or '.', exist_ok=True)
            torch.save({'model': model.state_dict(), 'mean': mean, 'std': std, 'epoch': ep, 'va_acc': va_acc}, args.out_ckpt)
    with open(args.out_hist,'w',newline='') as f:
        w = csv.writer(f); w.writerow(['epoch','train_loss','train_acc','val_loss','val_acc','lr']); w.writerows(rows)
    print(f'BEST ep={best_ep} va_acc={best_va:.4f}', flush=True)

if __name__ == '__main__':
    main()
