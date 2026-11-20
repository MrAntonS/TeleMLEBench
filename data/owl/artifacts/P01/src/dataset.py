"""Dataset loading for RML2016.10a dict."""
import pickle
import numpy as np
import torch
from torch.utils.data import Dataset
from .common import MODULATIONS, MOD_TO_IDX, SNRS


def load_pkl(path="/data/RML2016.10a_dict.pkl"):
    with open(path, "rb") as f:
        return pickle.load(f, encoding="latin1")


class RMLDataset(Dataset):
    def __init__(self, data, keys_index):
        """data: dict; keys_index: list of ((mod,snr), idx) tuples."""
        self.data = data
        # Precompute flat arrays of (key, idx) for fast access; load lazily from dict.
        self.items = keys_index
        # Cache per-key arrays
        self._cache = {}

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        (m, s), j = self.items[i]
        arr = self.data[(m, s)][j]  # (2,128) float32
        return (torch.from_numpy(np.ascontiguousarray(arr)),
                MOD_TO_IDX[m], s)


def flatten_split(split):
    tr, va, te = [], [], []
    for m in MODULATIONS:
        for s in SNRS:
            itr, iva, ite = split[(m, s)]
            tr += [((m, s), int(j)) for j in itr]
            va += [((m, s), int(j)) for j in iva]
            te += [((m, s), int(j)) for j in ite]
    return tr, va, te
