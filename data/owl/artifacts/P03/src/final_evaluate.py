"""Final evaluation — runs ONCE on locked test split. Verifies source hashes vs FROZEN_CONFIG.json."""
import json, hashlib, os, datetime
import numpy as np, torch
from torch.utils.data import TensorDataset, DataLoader
from dataset import load_all, make_splits, split_sha256
from model import ICRNNA
from metrics import compute_metrics, per_snr_accuracy

def sha256_file(p):
    h = hashlib.sha256()
    with open(p,'rb') as f:
        for b in iter(lambda: f.read(1<<20), b''):
            h.update(b)
    return h.hexdigest()

def main():
    ws = '~/workspace'
    frozen = json.load(open(os.path.join(ws,'FROZEN_CONFIG.json')))
    # verify hashes
    cur = {}
    for fn in sorted(os.listdir(os.path.join(ws,'src'))):
        if fn.endswith('.py'):
            cur[fn] = sha256_file(os.path.join(ws,'src',fn))
    concat = ''.join(cur[k] for k in sorted(cur)).encode()
    combined = hashlib.sha256(concat).hexdigest()
    assert cur == frozen['source_files'], f'source hash mismatch: {cur} vs {frozen["source_files"]}'
    assert combined == frozen['source_sha256'], 'combined source sha mismatch'
    print('hash check OK', combined, flush=True)
    seed = frozen['split_seed']
    ckpt_path = os.path.join(ws, frozen['best_checkpoint'])
    dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    X, y, snr = load_all()
    tr, va, te = make_splits(X, y, snr, seed=seed)
    ssha = split_sha256(tr, va, te, y, snr)
    ckpt = torch.load(ckpt_path, map_location=dev)
    mean, std = float(ckpt['mean']), float(ckpt['std'])
    Xn = (X - mean)/std
    model = ICRNNA().to(dev)
    model.load_state_dict(ckpt['model']); model.eval()
    dl = DataLoader(TensorDataset(torch.from_numpy(Xn[te]), torch.from_numpy(y[te])), batch_size=1024)
    preds = []
    with torch.no_grad():
        for xb, _ in dl:
            preds += model(xb.to(dev)).argmax(1).cpu().tolist()
    preds = np.array(preds); yt = y[te]; st = snr[te]
    m = compute_metrics(yt, preds)
    per_snr = per_snr_accuracy(yt, preds, st)
    paper_overall = 0.6324
    res = {
        'overall_accuracy': m['accuracy'],
        'per_snr_accuracy': per_snr,
        'macro_f1': m['macro_f1'],
        'kappa': m['kappa'],
        'n_test': int(len(te)),
        'split_description': '70/15/15 random split stratified by joint (modulation,SNR), seed 42; test = 15% (33000 examples)',
        'split_sha256': ssha,
        'n_runs_or_seeds': 1,
        'source_sha256': combined,
        'paper_reported': {'overall_accuracy_RML2016_10a': paper_overall, 'location': 'Table 3, p.6 (also Table 6: 0.6324; text Sec 4.2.2: 63.39%)'},
        'difference_pp': float((m['accuracy']-paper_overall)*100),
        'final_eval_timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    json.dump(res, open(os.path.join(ws,'RESULTS.json'),'w'), indent=2)
    np.savez(os.path.join(ws,'results','test_predictions.npz'), y_true=yt, y_pred=preds, snr=st)
    print(json.dumps(res, indent=2), flush=True)

if __name__ == '__main__':
    main()
