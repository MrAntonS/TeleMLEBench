"""Train AMC-Net on RML2016.10a train/val splits only. No test access.

Usage: python -m src.train [--pilot] [--epochs N] [--batch B] [--seed S]
Writes checkpoints/best.pt and TRAINING_HISTORY.csv (also logs/).
"""
import argparse, csv, os, sys, time
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

sys.path.insert(0, "~/workspace")
from src.common import build_split_indices, seed_everything
from src.dataset import load_pkl, RMLDataset, flatten_split
from src.model import AMCNet, count_params


def evaluate(model, loader, device, criterion):
    model.eval()
    tot_loss, tot_correct, tot_n = 0.0, 0, 0
    with torch.no_grad():
        for xb, yb, _ in loader:
            xb, yb = xb.to(device), yb.to(device)
            out = model(xb)
            loss = criterion(out, yb)
            tot_loss += loss.item() * len(xb)
            tot_correct += (out.argmax(1) == yb).sum().item()
            tot_n += len(xb)
    return tot_loss / tot_n, tot_correct / tot_n


def _pilot_stratified(split, n_tr=30, n_va=6):
    from src.common import MODULATIONS, SNRS
    tr, va = [], []
    for m in MODULATIONS:
        for s in SNRS:
            itr, iva, _ = split[(m, s)]
            tr += [((m, s), int(j)) for j in itr[:n_tr]]
            va += [((m, s), int(j)) for j in iva[:n_va]]
    return tr, va


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pilot", action="store_true")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--patience", type=int, default=10)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--tag", type=str, default="full")
    ap.add_argument("--ffm", type=str, default="temporal", choices=["temporal", "channel"])
    ap.add_argument("--clip", type=float, default=0.0)
    ap.add_argument("--no_acm", action="store_true")
    args = ap.parse_args()

    seed_everything(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print("device:", device, flush=True)

    split = build_split_indices(seed=0)
    data = load_pkl()
    tr_list, va_list, _ = flatten_split(split)
    if args.pilot:
        # stratified subset: 30 train + 6 val per key; 5 epochs
        tr_list, va_list = _pilot_stratified(split, n_tr=30, n_va=6)
        args.epochs = 5
    print(f"train {len(tr_list)} val {len(va_list)}", flush=True)
    tr_ds = RMLDataset(data, tr_list)
    va_ds = RMLDataset(data, va_list)
    tr_ld = DataLoader(tr_ds, batch_size=args.batch, shuffle=True, num_workers=4,
                       pin_memory=True)
    va_ld = DataLoader(va_ds, batch_size=1024, shuffle=False, num_workers=4,
                       pin_memory=True)

    model = AMCNet(ffm_mode=args.ffm, use_acm=not args.no_acm).to(device)
    print("params:", count_params(model), flush=True)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    crit = nn.CrossEntropyLoss()

    hist_path = f"~/workspace/logs/history_{args.tag}.csv"
    ckpt_path = f"~/workspace/checkpoints/best_{args.tag}.pt"
    rows = []
    best_val = float("inf")
    best_ep = -1
    bad = 0
    t0 = time.time()
    with open(hist_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["epoch", "train_loss", "train_acc", "val_loss", "val_acc", "lr", "time_s"])
        for ep in range(1, args.epochs + 1):
            model.train()
            tl, tc, tn = 0.0, 0, 0
            for xb, yb, _ in tr_ld:
                xb, yb = xb.to(device), yb.to(device)
                opt.zero_grad()
                out = model(xb)
                loss = crit(out, yb)
                loss.backward()
                if args.clip > 0:
                    nn.utils.clip_grad_norm_(model.parameters(), args.clip)
                opt.step()
                tl += loss.item() * len(xb)
                tc += (out.argmax(1) == yb).sum().item()
                tn += len(xb)
            tr_loss, tr_acc = tl / tn, tc / tn
            va_loss, va_acc = evaluate(model, va_ld, device, crit)
            lr = opt.param_groups[0]["lr"]
            el = time.time() - t0
            w.writerow([ep, f"{tr_loss:.6f}", f"{tr_acc:.6f}", f"{va_loss:.6f}",
                        f"{va_acc:.6f}", lr, f"{el:.1f}"])
            f.flush()
            print(f"ep {ep}: tr_loss {tr_loss:.4f} tr_acc {tr_acc:.4f} "
                  f"va_loss {va_loss:.4f} va_acc {va_acc:.4f} [{el/60:.1f}min]", flush=True)
            rows.append((ep, tr_loss, tr_acc, va_loss, va_acc))
            if va_loss < best_val - 0.0:
                best_val = va_loss
                best_ep = ep
                bad = 0
                torch.save({"epoch": ep, "model": model.state_dict(),
                            "val_loss": va_loss, "val_acc": va_acc}, ckpt_path)
            else:
                bad += 1
                if bad >= args.patience:
                    print(f"early stop at ep {ep} (best ep {best_ep} val_loss {best_val:.4f})",
                          flush=True)
                    break
    print("done. best:", best_ep, best_val, flush=True)


if __name__ == "__main__":
    main()
