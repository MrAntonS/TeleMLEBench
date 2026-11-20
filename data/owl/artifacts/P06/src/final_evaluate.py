"""Final evaluation, once, on the locked test split."""
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import torch
from torch.utils.data import DataLoader
from sklearn.metrics import accuracy_score, f1_score, cohen_kappa_score

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from data import load_dict, build_arrays, stratified_split_per_key, split_sha256, IQDataset, MODS
from model import MCCFN


def sha_of_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()


def cfg(frozen, key, default=None):
    v = frozen.get(key, default)
    if isinstance(v, dict) and 'value' in v:
        return v['value']
    return v


def main():
    with open('FROZEN_CONFIG.json') as f:
        frozen = json.load(f)
    # verify source hashes
    file_hashes = {}
    for fn in sorted(os.listdir('src')):
        if fn.endswith('.py'):
            file_hashes[fn] = sha_of_file(os.path.join('src', fn))
    combined = hashlib.sha256(''.join(f'{k}:{file_hashes[k]}' for k in sorted(file_hashes)).encode()).hexdigest()
    assert file_hashes == frozen['source_files'], f'source files changed! {file_hashes} vs {frozen["source_files"]}'
    assert combined == frozen['source_sha256'], 'combined source sha mismatch'
    print('source hash check OK', combined[:16], flush=True)

    seed = cfg(frozen, 'seed', 42)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    dp = frozen.get('data_path', '/data/RML2016.10a_dict.pkl')
    if isinstance(dp, dict):
        dp = dp.get('value', '/data/RML2016.10a_dict.pkl')
    d = load_dict(dp)
    X, y, snr = build_arrays(d)
    tr, va, te = stratified_split_per_key(seed=seed)
    assert split_sha256(tr, va, te) == frozen['split_sha256'], 'split mismatch'
    print('split OK', len(tr), len(va), len(te), flush=True)

    loader = DataLoader(IQDataset(X, y, snr, te), batch_size=512, shuffle=False, num_workers=4)
    model = MCCFN(num_classes=11, dk=cfg(frozen, 'dk', 64), dv=cfg(frozen, 'dv', 64),
                  heads=cfg(frozen, 'heads', 2),
                  dropout_p=cfg(frozen, 'final_dropout_p', 0.6)).to(device)
    ckpt = torch.load(cfg(frozen, 'checkpoint', 'checkpoints/mccfn_best.pt'), map_location=device)
    model.load_state_dict(ckpt['state_dict'])
    model.eval()
    preds, trues, snrs = [], [], []
    with torch.no_grad():
        for xb, yb, sb in loader:
            out = model(xb.to(device))
            preds.append(out.argmax(1).cpu().numpy())
            trues.append(np.asarray(yb))
            snrs.append(np.asarray(sb))
    y_pred = np.concatenate(preds)
    y_true = np.concatenate(trues)
    snr_arr = np.concatenate(snrs)

    overall = float(accuracy_score(y_true, y_pred))
    macro_f1 = float(f1_score(y_true, y_pred, average='macro'))
    kappa = float(cohen_kappa_score(y_true, y_pred))
    per_snr = {}
    for s in sorted(np.unique(snr_arr).tolist()):
        m = snr_arr == s
        per_snr[str(s)] = float(accuracy_score(y_true[m], y_pred[m]))

    os.makedirs('results', exist_ok=True)
    np.savez_compressed('results/test_predictions.npz', y_true=y_true, y_pred=y_pred, snr=snr_arr)

    paper_acc = frozen['paper_reported']['accuracy_2016_10a']
    if isinstance(paper_acc, dict):
        paper_acc = paper_acc.get('value', 0.6341)
    results = {
        'overall_accuracy': overall,
        'per_snr_accuracy': per_snr,
        'macro_f1': macro_f1,
        'kappa': kappa,
        'n_test': int(len(te)),
        'split_description': 'stratified per-(mod,SNR) 700/200/100, seed 42 (train/val/test 7:2:1)',
        'split_sha256': frozen['split_sha256'],
        'n_runs_or_seeds': 1,
        'source_sha256': combined,
        'paper_reported': frozen['paper_reported'],
        'difference_pp': (overall - paper_acc) * 100.0,
        'final_eval_timestamp': datetime.now(timezone.utc).isoformat(),
    }
    with open('RESULTS.json', 'w') as f:
        json.dump(results, f, indent=2)
    print(json.dumps({k: v for k, v in results.items() if k != 'per_snr_accuracy'}, indent=2), flush=True)
    print('per_snr', per_snr, flush=True)


if __name__ == '__main__':
    main()
