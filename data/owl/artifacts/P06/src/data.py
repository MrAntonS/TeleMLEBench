"""Data loading and stratified 7:2:1 split (per (mod,SNR) key)."""
import hashlib
import pickle
import numpy as np
import torch
from torch.utils.data import Dataset

MODS = ['8PSK', 'AM-DSB', 'AM-SSB', 'BPSK', 'CPFSK', 'GFSK', 'PAM4', 'QAM16', 'QAM64', 'QPSK', 'WBFM']
MOD2IDX = {m: i for i, m in enumerate(MODS)}
SNRS = list(range(-20, 20, 2))


def load_dict(path='/data/RML2016.10a_dict.pkl'):
    with open(path, 'rb') as f:
        return pickle.load(f, encoding='latin1')


def build_arrays(d):
    X_list, y_list, snr_list = [], [], []
    for mod in MODS:
        for snr in SNRS:
            arr = d[(mod, snr)]  # (1000,2,128)
            X_list.append(arr)
            y_list.append(np.full(arr.shape[0], MOD2IDX[mod], dtype=np.int64))
            snr_list.append(np.full(arr.shape[0], snr, dtype=np.int16))
    X = np.concatenate(X_list, axis=0).astype(np.float32)
    y = np.concatenate(y_list, axis=0)
    snr = np.concatenate(snr_list, axis=0)
    return X, y, snr


def stratified_split_per_key(n_per_key=1000, n_keys=220, seed=42):
    """Return train/val/test index arrays. 700/200/100 per key."""
    rng = np.random.RandomState(seed)
    train_idx, val_idx, test_idx = [], [], []
    for k in range(n_keys):
        idx = np.arange(k * n_per_key, (k + 1) * n_per_key)
        rng.shuffle(idx)
        train_idx.append(idx[:700])
        val_idx.append(idx[700:900])
        test_idx.append(idx[900:])
    train_idx = np.concatenate(train_idx)
    val_idx = np.concatenate(val_idx)
    test_idx = np.concatenate(test_idx)
    # shuffle globally for training order
    rng.shuffle(train_idx)
    rng.shuffle(val_idx)
    rng.shuffle(test_idx)
    return train_idx, val_idx, test_idx


def split_sha256(train_idx, val_idx, test_idx):
    h = hashlib.sha256()
    for a in (train_idx, val_idx, test_idx):
        h.update(np.ascontiguousarray(a).tobytes())
    return h.hexdigest()


class IQDataset(Dataset):
    def __init__(self, X, y, snr=None, idx=None):
        if idx is not None:
            self.X = X[idx]
            self.y = y[idx]
            self.snr = snr[idx] if snr is not None else None
        else:
            self.X, self.y, self.snr = X, y, snr

    def __len__(self):
        return self.X.shape[0]

    def __getitem__(self, i):
        if self.snr is not None:
            return torch.from_numpy(self.X[i]), int(self.y[i]), int(self.snr[i])
        return torch.from_numpy(self.X[i]), int(self.y[i])
