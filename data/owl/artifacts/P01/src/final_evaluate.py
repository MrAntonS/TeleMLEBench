"""Final evaluation — runs ONCE on the locked test split.

Verifies src/*.py sha256 against FROZEN_CONFIG.json, evaluates the frozen checkpoint
on the test split (stratified per (mod,SNR), seed 0 — first and only test access),
writes RESULTS.json and results/test_predictions.npz.
"""
import sys, json, hashlib, datetime
from pathlib import Path
import numpy as np
import torch
from torch.utils.data import DataLoader

WS = Path("~/workspace")
sys.path.insert(0, str(WS))
from src.common import build_split_indices, split_sha256, seed_everything
from src.dataset import load_pkl, RMLDataset, flatten_split
from src.model import AMCNet
from src.metrics import compute_metrics, per_snr_accuracy

CFG = json.loads((WS / "FROZEN_CONFIG.json").read_text())


def sha256_file(p):
    h = hashlib.sha256()
    h.update(Path(p).read_bytes())
    return h.hexdigest()


def main():
    # 1. verify source hashes
    for fname, expect in CFG["source_files_sha256"].items():
        got = sha256_file(WS / "src" / fname)
        assert got == expect, f"hash mismatch {fname}: {got} != {expect}"
    print("source hashes OK")

    seed_everything(CFG["split_seed"])
    split = build_split_indices(seed=CFG["split_seed"])
    assert split_sha256(split) == CFG["split_sha256"], "split mismatch"
    data = load_pkl()
    _, _, te_list = flatten_split(split)
    print("n_test:", len(te_list))

    hp = CFG["hyperparameters"]
    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = AMCNet(n_classes=11, L=hp["L"]["value"],
                   acm_hidden=hp["acm_hidden"]["value"],
                   n_heads=hp["ffm_heads"]["value"], dk=hp["ffm_dk"]["value"],
                   ffm_mode=hp["ffm_mode"]["value"],
                   use_acm=hp["use_acm"]["value"]).to(dev)
    ck = torch.load(WS / CFG["checkpoint"], map_location=dev, weights_only=False)
    model.load_state_dict(ck["model"])
    model.eval()

    te_ds = RMLDataset(data, te_list)
    te_ld = DataLoader(te_ds, batch_size=1024, shuffle=False, num_workers=4)
    yt, yp, sn = [], [], []
    with torch.no_grad():
        for xb, yb, sb in te_ld:
            out = model(xb.to(dev))
            yp += out.argmax(1).cpu().tolist()
            yt += yb.tolist()
            sn += (sb.tolist() if hasattr(sb, "tolist") else list(sb))
    yt = np.array(yt)
    yp = np.array(yp)
    sn = np.array(sn)
    m = compute_metrics(yt, yp)
    per = per_snr_accuracy(yt, yp, sn)
    paper = CFG["paper_reported"]["rml2016_10a"]
    ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
    results = {
        "overall_accuracy": m["overall_accuracy"],
        "per_snr_accuracy": per,
        "macro_f1": m["macro_f1"],
        "kappa": m["kappa"],
        "n_test": int(len(yt)),
        "split_description": ("stratified per (modulation,SNR): 600 train / 200 val / "
                              "200 test of 1000 per key, seed 0"),
        "split_sha256": CFG["split_sha256"],
        "n_runs_or_seeds": 1,
        "source_sha256": CFG["source_sha256"],
        "paper_reported": paper,
        "difference_pp": (m["overall_accuracy"] * 100
                          - paper["overall_accuracy_pct"]),
        "final_eval_timestamp": ts,
    }
    (WS / "RESULTS.json").write_text(json.dumps(results, indent=2))
    np.savez_compressed(WS / "results" / "test_predictions.npz",
                        y_true=yt, y_pred=yp, snr=sn)
    print(json.dumps({k: v for k, v in results.items()
                      if k != "per_snr_accuracy"}, indent=2))
    print("per_snr:", {k: round(v, 4) for k, v in per.items()})


if __name__ == "__main__":
    main()
