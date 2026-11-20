"""Training with dual-trigger LR schedule (Alg.1) + LR-based dynamic dropout (Alg.2)."""
import argparse
import copy
import csv
import os
import time

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from sklearn.metrics import accuracy_score

from data import load_dict, build_arrays, stratified_split_per_key, split_sha256, IQDataset
from model import MCCFN


def evaluate(model, loader, device, criterion):
    model.eval()
    tot_loss, tot_n = 0.0, 0
    all_pred, all_true = [], []
    with torch.no_grad():
        for xb, yb, *_ in loader:
            xb = xb.to(device)
            yb = torch.as_tensor(yb, dtype=torch.long).to(device)
            out = model(xb)
            loss = criterion(out, yb)
            tot_loss += loss.item() * xb.size(0)
            tot_n += xb.size(0)
            all_pred.append(out.argmax(1).cpu().numpy())
            all_true.append(yb.cpu().numpy())
    pred = np.concatenate(all_pred)
    true = np.concatenate(all_true)
    return tot_loss / tot_n, accuracy_score(true, pred)


def count_params(model):
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


def make_optimizer(model, lr):
    return torch.optim.Adam(model.parameters(), lr=lr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--epochs', type=int, default=50)
    ap.add_argument('--batch', type=int, default=128)
    ap.add_argument('--lr', type=float, default=0.001)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--subset', type=float, default=1.0)
    ap.add_argument('--out', type=str, default='checkpoints/mccfn_best.pt')
    ap.add_argument('--history', type=str, default='TRAINING_HISTORY.csv')
    ap.add_argument('--max-time', type=float, default=1e9)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print('device', device, flush=True)

    d = load_dict()
    X, y, snr = build_arrays(d)
    tr, va, te = stratified_split_per_key(seed=args.seed)
    print('split sizes', len(tr), len(va), len(te), 'sha', split_sha256(tr, va, te)[:16], flush=True)
    if args.subset < 1.0:
        tr = tr[:int(len(tr) * args.subset)]
        va = va[:int(len(va) * args.subset)]

    train_loader = DataLoader(IQDataset(X, y, snr, tr), batch_size=args.batch, shuffle=True, num_workers=4, pin_memory=True)
    val_loader = DataLoader(IQDataset(X, y, snr, va), batch_size=512, shuffle=False, num_workers=4, pin_memory=True)

    model = MCCFN().to(device)
    print('params', count_params(model), flush=True)
    # shape check
    with torch.no_grad():
        t = torch.randn(4, 2, 128).to(device)
        print('forward shape', model(t).shape, flush=True)

    criterion = nn.CrossEntropyLoss()
    lr = args.lr
    opt = make_optimizer(model, lr)
    # Alg.1 state
    Ces, Cdiff, Lmin = 0, 0, float('inf')
    Aval_prev = 0.0
    M, dthres, P = 4, 0.01, 4
    # Alg.2 state
    p, pmax, dp = 0.5, 0.6, 0.1
    prev_lr = lr
    model.set_dropout_p(p)

    best_val = float('inf')
    best_state = None
    rows = []
    t0 = time.time()
    for epoch in range(1, args.epochs + 1):
        model.train()
        tot_loss, tot_n, correct = 0.0, 0, 0
        for xb, yb, *_ in train_loader:
            xb = xb.to(device, non_blocking=True)
            yb = torch.as_tensor(yb, dtype=torch.long).to(device, non_blocking=True)
            opt.zero_grad()
            out = model(xb)
            loss = criterion(out, yb)
            loss.backward()
            opt.step()
            tot_loss += loss.item() * xb.size(0)
            tot_n += xb.size(0)
            correct += (out.argmax(1) == yb).sum().item()
        train_loss = tot_loss / tot_n
        train_acc = correct / tot_n
        val_loss, val_acc = evaluate(model, val_loader, device, criterion)

        # ---- Algorithm 1 (epoch granularity) ----
        if val_loss > Lmin:
            Ces += 1
        else:
            Lmin = val_loss
        if Ces % M == 0 and Ces > 0:
            lr = 0.5 * lr
            for g in opt.param_groups:
                g['lr'] = lr
            Ces = 0
        Dacc = train_acc - val_acc
        if Dacc > dthres:
            if Cdiff == 0:
                lr = 0.5 * lr
                opt = make_optimizer(model, lr)  # reset optimizer state
                Cdiff = 1
            else:
                Cdiff += 1
                if Cdiff >= P:
                    lr = 0.5 * lr
                    for g in opt.param_groups:
                        g['lr'] = lr
                    Cdiff = 0
        else:
            Cdiff = 0
        if val_acc > Aval_prev:
            Cdiff = 0
        Aval_prev = val_acc
        # ---- Algorithm 2 ----
        if lr < prev_lr:
            p = min(pmax, p + dp)
            model.set_dropout_p(p)
        prev_lr = lr

        rows.append([epoch, train_loss, train_acc, val_loss, val_acc, lr, p])
        print(f'ep {epoch} tr_loss {train_loss:.4f} tr_acc {train_acc:.4f} va_loss {val_loss:.4f} va_acc {val_acc:.4f} lr {lr:.2e} p {p:.2f}', flush=True)
        if val_loss < best_val:
            best_val = val_loss
            best_state = copy.deepcopy(model.state_dict())
        if time.time() - t0 > args.max_time:
            print('time budget hit', flush=True)
            break

    if best_state is not None:
        torch.save({'state_dict': best_state, 'lr': lr, 'dropout_p': p}, args.out)
    with open(args.history, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['epoch', 'train_loss', 'train_acc', 'val_loss', 'val_acc', 'lr', 'dropout_p'])
        w.writerows(rows)
    print('done best_val', best_val, flush=True)


if __name__ == '__main__':
    main()
