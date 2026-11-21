"""Pilot + full training script. Uses only train/val."""
import sys, os, time, csv
import numpy as np
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
import torch
import torch.nn as nn
sys.path.insert(0, os.path.dirname(__file__))
from data import load_dict, build_split, make_loaders
from model import CDSCNN


def run(seed=0, epochs=60, batch=256, subset=None, tag='pilot', lr=1e-3):
    torch.manual_seed(seed); np.random.seed(seed)
    dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    d = load_dict()
    sp = build_split(d, seed=12345)
    print('split sha', sp['sha'], flush=True)
    trX, trY, vaX, vaY = sp['trX'], sp['trY'], sp['vaX'], sp['vaY']
    if subset:
        rng2=np.random.RandomState(0)
        pi=rng2.permutation(len(trX))[:subset]; trX, trY = trX[pi], trY[pi]
    from torch.utils.data import TensorDataset, DataLoader
    trL = DataLoader(TensorDataset(torch.from_numpy(np.ascontiguousarray(trX)), torch.from_numpy(np.ascontiguousarray(trY))),
                     batch_size=batch, shuffle=True, num_workers=2, pin_memory=True)
    vaL = DataLoader(TensorDataset(torch.from_numpy(np.ascontiguousarray(vaX)), torch.from_numpy(np.ascontiguousarray(vaY))),
                     batch_size=1024, shuffle=False, num_workers=2)
    m = CDSCNN().to(dev)
    print('params %.3fM' % (m.count_params() / 1e6), flush=True)
    opt = torch.optim.Adam(m.parameters(), lr=lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingWarmRestarts(opt, T_0=10, T_mult=1)
    ce = nn.CrossEntropyLoss()
    hist = []
    best_val = 1e9; best_ep = -1; wait = 0
    for ep in range(epochs):
        m.train()
        tl, tc, n = 0.0, 0, 0
        for xb, yb in trL:
            xb, yb = xb.to(dev, non_blocking=True), yb.to(dev, non_blocking=True)
            opt.zero_grad()
            out = m(xb)
            loss = ce(out, yb)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(m.parameters(), 5.0)
            opt.step()
            tl += loss.item() * len(xb); tc += (out.argmax(1) == yb).sum().item(); n += len(xb)
        m.eval()
        vl, vc, vn = 0.0, 0, 0
        with torch.no_grad():
            for xb, yb in vaL:
                xb, yb = xb.to(dev, non_blocking=True), yb.to(dev, non_blocking=True)
                out = m(xb)
                vl += ce(out, yb).item() * len(xb); vc += (out.argmax(1) == yb).sum().item(); vn += len(xb)
        sched.step()
        lrnow = opt.param_groups[0]['lr']
        print(f'ep{ep} train_loss={tl/n:.4f} acc={tc/n:.4f} val_loss={vl/vn:.4f} acc={vc/vn:.4f} lr={lrnow:.6f}', flush=True)
        hist.append((ep, tl / n, tc / n, vl / vn, vc / vn, lrnow))
        if vl / vn < best_val - 1e-6:
            best_val = vl / vn; best_ep = ep; wait = 0
            torch.save(m.state_dict(), os.path.join(ROOT, f'checkpoints/{tag}_seed{seed}_best.pt'))
        else:
            wait += 1
            if wait >= 10:
                print('early stop', flush=True)
                break
    print(f'BEST ep{best_ep} val_loss {best_val:.4f}', flush=True)
    os.makedirs(os.path.join(ROOT, 'logs'), exist_ok=True)
    with open(os.path.join(ROOT, f'logs/{tag}_seed{seed}.csv'), 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['epoch', 'train_loss', 'train_acc', 'val_loss', 'val_acc', 'lr']); w.writerows(hist)
    return best_val, best_ep


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--epochs', type=int, default=60)
    ap.add_argument('--batch', type=int, default=256)
    ap.add_argument('--subset', type=int, default=0)
    ap.add_argument('--tag', type=str, default='pilot')
    a = ap.parse_args()
    run(a.seed, a.epochs, a.batch, a.subset if a.subset > 0 else None, a.tag)
