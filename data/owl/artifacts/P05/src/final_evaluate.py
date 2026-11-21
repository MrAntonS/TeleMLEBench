"""Final evaluation (runs ONCE after freeze): hash check + test metrics.
Paper protocol: mean of evaluation metrics over independent runs."""
import os, sys, json, hashlib, datetime
import numpy as np
import torch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from data import load_dict, build_split
from model import CDSCNN
from sklearn.metrics import f1_score, cohen_kappa_score, accuracy_score


def sha_of_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()


def main():
    ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    with open(os.path.join(ROOT, 'FROZEN_CONFIG.json')) as f:
        frozen = json.load(f)
    cur = {}
    h = hashlib.sha256()
    for fn in sorted(os.listdir(os.path.join(ROOT, 'src'))):
        if fn.endswith('.py'):
            with open(os.path.join(ROOT, 'src', fn), 'rb') as f:
                data = f.read()
            cur[fn] = hashlib.sha256(data).hexdigest()
            h.update(data)
    assert cur == frozen['source_files'], 'source hash mismatch'
    source_sha256 = h.hexdigest()
    assert source_sha256 == frozen['source_sha256'], 'combined source sha mismatch'
    print('hash check OK', flush=True)

    sp = build_split(load_dict(), seed=frozen['split_seed'])
    assert sp['sha'] == frozen['split']['split_sha256']['value'], 'split reproduction mismatch'
    teX, teY, teS = sp['teX'], sp['teY'], sp['teS']
    print(f'n_test={len(teY)} split_sha={sp["sha"]}', flush=True)

    dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    from torch.utils.data import TensorDataset, DataLoader
    L = DataLoader(TensorDataset(torch.from_numpy(np.ascontiguousarray(teX))),
                   batch_size=1024, shuffle=False, num_workers=2)
    snrs = sorted(set(teS.tolist()))
    run_oas, run_f1, run_kap, per_snr_runs, all_pred = [], [], [], [], []
    for ckpt_name in frozen['checkpoints']:
        m = CDSCNN(n_blocks=frozen['n_cdsc_blocks'])
        m.load_state_dict(torch.load(os.path.join(ROOT, 'checkpoints', ckpt_name), map_location=dev))
        m.to(dev).eval()
        pr = []
        with torch.no_grad():
            for (xb,) in L:
                pr.append(m(xb.to(dev)).argmax(1).cpu().numpy())
        pr = np.concatenate(pr)
        all_pred.append(pr)
        run_oas.append(accuracy_score(teY, pr))
        run_f1.append(f1_score(teY, pr, average='macro'))
        run_kap.append(cohen_kappa_score(teY, pr))
        per_snr_runs.append({str(int(s)): float((pr[teS == s] == teY[teS == s]).mean()) for s in snrs})
        del m
    overall = float(np.mean(run_oas))
    per_snr = {k: float(np.mean([r[k] for r in per_snr_runs])) for k in per_snr_runs[0]}
    paper_oa = 62.63
    res = {
        'overall_accuracy': round(overall * 100, 2),
        'per_run_accuracy': [round(float(v) * 100, 2) for v in run_oas],
        'per_snr_accuracy': {k: round(v * 100, 2) for k, v in per_snr.items()},
        'avg_accuracy_0_to_18': round(float(np.mean([v for k, v in per_snr.items() if int(k) >= 0])) * 100, 2),
        'macro_f1': round(float(np.mean(run_f1)), 4),
        'kappa': round(float(np.mean(run_kap)), 4),
        'n_test': int(len(teY)),
        'split_description': 'per (modulation,SNR) cell: 800 train / 100 val / 100 test, seed 12345',
        'split_sha256': sp['sha'],
        'n_runs_or_seeds': len(frozen['checkpoints']),
        'source_sha256': source_sha256,
        'paper_reported': {'overall_accuracy': paper_oa,
                           'location': 'Table II, Sec. III-F, abstract (RadioML2016.10a test set)'},
        'difference_pp': round(overall * 100 - paper_oa, 2),
        'final_eval_timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    with open(os.path.join(ROOT, 'RESULTS.json'), 'w') as f:
        json.dump(res, f, indent=2)
    np.savez_compressed(os.path.join(ROOT, 'results', 'test_predictions.npz'),
                        y_true=teY, y_pred=np.stack(all_pred), snr=teS)
    print(json.dumps(res, indent=2), flush=True)


if __name__ == '__main__':
    main()
