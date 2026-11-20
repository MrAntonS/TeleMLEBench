"""Shared constants, split construction, seeding."""
import hashlib
import numpy as np

MODULATIONS = ['8PSK', 'AM-DSB', 'AM-SSB', 'BPSK', 'CPFSK', 'GFSK',
               'PAM4', 'QAM16', 'QAM64', 'QPSK', 'WBFM']
MOD_TO_IDX = {m: i for i, m in enumerate(MODULATIONS)}
SNRS = [-20, -18, -16, -14, -12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18]
L = 128
N_CLASSES = 11


def build_split_indices(n_per_key=1000, n_train=600, n_val=200, n_test=200, seed=0):
    """Stratified per (mod, snr) key. Returns dict key->(train_idx, val_idx, test_idx)."""
    rng = np.random.RandomState(seed)
    split = {}
    for m in MODULATIONS:
        for s in SNRS:
            perm = rng.permutation(n_per_key)
            split[(m, s)] = (perm[:n_train], perm[n_train:n_train + n_val],
                             perm[n_train + n_val:n_train + n_val + n_test])
    return split


def split_sha256(split):
    h = hashlib.sha256()
    for m in MODULATIONS:
        for s in SNRS:
            for arr in split[(m, s)]:
                h.update(np.ascontiguousarray(arr).tobytes())
    return h.hexdigest()


def seed_everything(seed=0):
    import random, torch
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
