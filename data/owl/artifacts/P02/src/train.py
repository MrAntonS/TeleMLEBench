import os, sys, time, csv, argparse, hashlib
import numpy as np
import torch
from torch.utils.data import TensorDataset, DataLoader
sys.path.insert(0, os.path.dirname(__file__))
from dataset import build_arrays, stratified_split
from model import AWN, awn_loss, count_params
from sklearn.metrics import accuracy_score, f1_score, cohen_kappa_score

def evaluate(model, loader, device):
    model.eval()
    ys, ps = [], []
    with torch.no_grad():
        for xb, yb in loader:
            xb = xb.to(device); yb = yb.to(device)
            logits = model(xb)
            pred = logits.argmax(1).cpu().numpy()
            ps.append(pred); ys.append(yb.cpu().numpy())
    y = np.concatenate(ys); p = np.concatenate(ps)
    return y, p

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--epochs', type=int, default=60)
    ap.add_argument('--batch', type=int, default=128)
    ap.add_argument('--lr', type=float, default=0.001)
    ap.add_argument('--l1', type=float, default=0.01)
    ap.add_argument('--l2', type=float, default=0.01)
    ap.add_argument('--T', type=int, default=1)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--patience', type=int, default=5)
    ap.add_argument('--out', type=str, default='checkpoints/awn.pt')
    ap.add_argument('--hist', type=str, default='TRAINING_HISTORY.csv')
    args = ap.parse_args()
    torch.manual_seed(args.seed); np.random.seed(args.seed)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print('device', device, flush=True)
    X, y, s = build_arrays()
    tr, va, te, desc, sh = stratified_split(seed=args.seed)
    print(desc, sh, flush=True)
    print('shapes', X.shape, flush=True)
    train_ds = TensorDataset(torch.from_numpy(X[tr]), torch.from_numpy(y[tr]))
    val_ds = TensorDataset(torch.from_numpy(X[va]), torch.from_numpy(y[va]))
    train_loader = DataLoader(train_ds, batch_size=args.batch, shuffle=True, num_workers=4, pin_memory=True)
    val_loader = DataLoader(val_ds, batch_size=1024, shuffle=False, num_workers=4, pin_memory=True)
    model = AWN(T=args.T).to(device)
    print('params', count_params(model), flush=True)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    best_val = float('inf'); bad = 0; best_state = None
    rows = []
    import torch.nn.functional as F
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
        train_loss = tl/n; train_acc = tc/n
        # val
        model.eval()
        vl, vc, n2 = 0.0, 0, 0
        with torch.no_grad():
            for xb, yb in val_loader:
                xb = xb.to(device); yb = yb.to(device)
                logits, Hs, Ls, F0 = model(xb, return_aux=True)
                loss, ce, lh, ll = awn_loss(logits, yb, Hs, Ls, F0, args.l1, args.l2)
                bs = xb.size(0)
                vl += loss.item()*bs; n2 += bs
                vc += (logits.argmax(1)==yb).sum().item()
        val_loss = vl/n2; val_acc = vc/n2
        lr = opt.param_groups[0]['lr']
        print(f'ep {ep+1}/{args.epochs} tr_loss={train_loss:.4f} tr_acc={train_acc:.4f} val_loss={val_loss:.4f} val_acc={val_acc:.4f}', flush=True)
        rows.append([ep+1, train_loss, train_acc, val_loss, val_acc, lr])
        if val_loss < best_val - 1e-6:
            best_val = val_loss; bad = 0
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
            if bad >= args.patience:
                print(f'early stop at ep {ep+1} best_val={best_val:.4f}', flush=True)
                break
    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    torch.save({'state_dict': best_state, 'args': vars(args), 'best_val': best_val, 'split_sha': sh}, args.out)
    with open(args.hist, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['epoch','train_loss','train_acc','val_loss','val_acc','lr'])
        w.writerows(rows)
    print('saved', args.out, args.hist, flush=True)

if __name__ == '__main__':
    main()
