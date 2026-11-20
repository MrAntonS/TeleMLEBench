import os, sys, json, hashlib, datetime
import numpy as np
import torch
from torch.utils.data import TensorDataset, DataLoader
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dataset import build_arrays, stratified_split, MODS, SNRS
from model import AWN
from sklearn.metrics import accuracy_score, f1_score, cohen_kappa_score

WS = '~/workspace'

def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()

def main():
    with open(os.path.join(WS, 'FROZEN_CONFIG.json')) as f:
        cfg = json.load(f)
    # verify source hashes
    for fname, expect in cfg['source_files'].items():
        got = sha256_file(os.path.join(WS, 'src', fname))
        assert got == expect, f'source changed: {fname} {got} != {expect}'
    print('source hashes OK', flush=True)
    hp = cfg['hyperparameters']
    seed = hp['split_seed']['value']
    X, y, snr = build_arrays()
    tr, va, te, desc, split_sha = stratified_split(seed=seed)
    assert split_sha == cfg['split_sha256'], 'split mismatch'
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = AWN(T=hp['T']['value']).to(device)
    ckpt = torch.load(os.path.join(WS, cfg['checkpoint']), map_location=device)
    model.load_state_dict(ckpt['state_dict'])
    model.eval()
    loader = DataLoader(TensorDataset(torch.from_numpy(X[te]), torch.from_numpy(y[te]), torch.from_numpy(snr[te])),
                        batch_size=2048, shuffle=False, num_workers=4)
    YT, YP, ST = [], [], []
    with torch.no_grad():
        for xb, yb, sb in loader:
            p = model(xb.to(device)).argmax(1).cpu().numpy()
            YT.append(yb.numpy()); YP.append(p); ST.append(sb.numpy())
    yt = np.concatenate(YT); yp = np.concatenate(YP); st = np.concatenate(ST)
    oa = float(accuracy_score(yt, yp))
    mf1 = float(f1_score(yt, yp, average='macro'))
    kap = float(cohen_kappa_score(yt, yp))
    per = {}
    for v in sorted(set(st.tolist())):
        m = st == v
        per[str(int(v))] = float((yp[m] == yt[m]).mean())
    os.makedirs(os.path.join(WS, 'results'), exist_ok=True)
    np.savez(os.path.join(WS, 'results', 'test_predictions.npz'), y_true=yt, y_pred=yp, snr=st)
    res = {
        'overall_accuracy': oa,
        'per_snr_accuracy': per,
        'macro_f1': mf1,
        'kappa': kap,
        'n_test': int(len(te)),
        'split_description': desc,
        'split_sha256': split_sha,
        'n_runs_or_seeds': 1,
        'source_sha256': cfg['source_sha256'],
        'paper_reported': {'overall_accuracy': 0.6244, 'macro_f1': 0.6446, 'kappa': 0.5863,
                           'location': 'Table I, p.557; high-SNR (>0dB) avg 0.9149, max 0.9305 at 12dB, Sec IV-B p.556'},
        'difference_pp': float((oa - 0.6244) * 100),
        'final_eval_timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    with open(os.path.join(WS, 'RESULTS.json'), 'w') as f:
        json.dump(res, f, indent=2)
    print(json.dumps({k: v for k, v in res.items() if k != 'per_snr_accuracy'}, indent=2), flush=True)
    print('per_snr:', json.dumps(per), flush=True)

if __name__ == '__main__':
    main()
