"""Dataset utilities for RML2016.10a reproduction of ICRNNA paper."""
import pickle, hashlib
import numpy as np
from sklearn.model_selection import train_test_split

MODS = ['8PSK','AM-DSB','AM-SSB','BPSK','CPFSK','GFSK','PAM4','QAM16','QAM64','QPSK','WBFM']
MOD2IDX = {m:i for i,m in enumerate(MODS)}
SNRS = [-20,-18,-16,-14,-12,-10,-8,-6,-4,-2,0,2,4,6,8,10,12,14,16,18]
PKL_PATH = '/data/RML2016.10a_dict.pkl'

def load_all(pkl_path=PKL_PATH):
    d = pickle.load(open(pkl_path,'rb'), encoding='latin1')
    Xs, ys, snrs = [], [], []
    for (mod, snr), arr in d.items():
        Xs.append(arr)
        ys += [MOD2IDX[str(mod)]]*len(arr)
        snrs += [int(snr)]*len(arr)
    X = np.concatenate(Xs, axis=0).astype(np.float32)  # (220000,2,128)
    y = np.array(ys, dtype=np.int64)
    snr = np.array(snrs, dtype=np.int64)
    return X, y, snr

def make_splits(X, y, snr, seed=42):
    """70/15/15 split. Stratified by joint (mod,snr) key to guarantee coverage.
    Paper says: 70% train, 15% val, 15% test after shuffling (Sec 4.1). Stratification not specified."""
    joint = y*100 + ((snr+20)//2)  # unique per (mod,snr)
    idx = np.arange(len(y))
    train_idx, tmp_idx = train_test_split(idx, test_size=0.30, random_state=seed, stratify=joint)
    tmp_joint = joint[tmp_idx]
    val_idx, test_idx = train_test_split(tmp_idx, test_size=0.50, random_state=seed+1, stratify=tmp_joint)
    return train_idx, val_idx, test_idx

def split_sha256(train_idx, val_idx, test_idx, y, snr):
    h = hashlib.sha256()
    h.update(np.ascontiguousarray(train_idx).tobytes())
    h.update(np.ascontiguousarray(val_idx).tobytes())
    h.update(np.ascontiguousarray(test_idx).tobytes())
    return h.hexdigest()

def compute_norm_stats(X_train):
    mean = float(X_train.mean())
    std = float(X_train.std())
    return mean, std
