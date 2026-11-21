import os, sys, csv, argparse
import numpy as np
import torch
from torch.utils.data import TensorDataset, DataLoader
sys.path.insert(0, os.path.dirname(__file__))
from dataset import build_arrays, stratified_split
from model import AWN, awn_loss, count_params

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--epochs', type=int, default=50)
    ap.add_argument('--batch', type=int, default=128)
    ap.add_argument('--lr', type=float, default=0.001)
    ap.add_argument('--l1', type=float, default=0.01)
    ap.add_argument('--l2', type=float, default=0.01)
    ap.add_argument('--T', type=int, default=1)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--patience', type=int, default=10)
    ap.add_argument('--out', type=str, default='checkpoints/awn2.pt')
    ap.add_argument('--hist', type=str, default='TRAINING_HISTORY.csv')
    args = ap.parse_args()
    torch.manual_seed(args.seed); np.random.seed(args.seed)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    X, y, s = build_arrays()
    tr, va, te, desc, sh = stratified_split(seed=args.seed)
    train_loader = DataLoader(TensorDataset(torch.from_numpy(X[tr]), torch.from_numpy(y[tr])),
                              batch_size=args.batch, shuffle=True, num_workers=4, pin_memory=True)
    val_loader = DataLoader(TensorDataset(torch.from_numpy(X[va]), torch.from_numpy(y[va])),
                            batch_size=2048, shuffle=False, num_workers=4, pin_memory=True)
    model = AWN(T=args.T).to(device)
    print('params', count_params(model), flush=True)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    best_ce = float('inf'); bad = 0; best_state = None
    rows = []
    for ep in range(args.epochs):
        model.train()
        tl, tc, n = 0.0, 0, 0
        for xb, yb in train_loader:
            xb = xb.to(device); yb = yb.to(device)
            opt.zero_grad()
            logits, Hs, Ls, F0 = model(xb, return_aux=True)
            loss, ce, lh, ll = awn_loss(logits, yb, Hs, Ls, F0, args.l1, args.l2)
            loss.backward()
            opt.step()
            bs = xb.size(0)
            tl += loss.item()*bs; n += bs
            tc += (logits.argmax(1)==yb).sum().item()
        model.eval()
        vl_tot, vl_ce, vc, n2 = 0.0, 0.0, 0, 0
        with torch.no_grad():
            for xb, yb in val_loader:
                xb = xb.to(device); yb = yb.to(device)
                logits, Hs, Ls, F0 = model(xb, return_aux=True)
                loss, ce, lh, ll = awn_loss(logits, yb, Hs, Ls, F0, args.l1, args.l2)
                bs = xb.size(0)
                vl_tot += loss.item()*bs; vl_ce += ce.item()*bs; n2 += bs
                vc += (logits.argmax(1)==yb).sum().item()
        vl_tot/=n2; vl_ce/=n2; va_acc=vc/n2
        print(f'ep {ep+1} tr_loss={tl/n:.4f} tr_acc={tc/n:.4f} val_tot={vl_tot:.4f} val_ce={vl_ce:.4f} val_acc={va_acc:.4f}', flush=True)
        rows.append([ep+1, tl/n, tc/n, vl_tot, vl_ce, va_acc, opt.param_groups[0]['lr']])
        if vl_ce < best_ce - 1e-6:
            best_ce = vl_ce; bad = 0
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
            if bad >= args.patience:
                print(f'early stop ep {ep+1} best_ce={best_ce:.4f}', flush=True)
                break
    torch.save({'state_dict': best_state, 'args': vars(args), 'best_val_ce': best_ce, 'split_sha': sh}, args.out)
    with open(args.hist, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['epoch','train_loss','train_acc','val_total_loss','val_ce_loss','val_acc','lr'])
        w.writerows(rows)
    print('saved', args.out, flush=True)

if __name__ == '__main__':
    main()
