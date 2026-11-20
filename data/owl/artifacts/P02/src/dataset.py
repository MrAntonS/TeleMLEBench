# AWN reproduction - dataset
import pickle, hashlib
import numpy as np

MODS = ['8PSK','AM-DSB','AM-SSB','BPSK','CPFSK','GFSK','PAM4','QAM16','QAM64','QPSK','WBFM']
SNRS = [-20,-18,-16,-14,-12,-10,-8,-6,-4,-2,0,2,4,6,8,10,12,14,16,18]
MOD2IDX = {m:i for i,m in enumerate(MODS)}

def load_all(path='/data/RML2016.10a_dict.pkl'):
    with open(path,'rb') as f:
        d = pickle.load(f, encoding='latin1')
    return d

def build_arrays(path='/data/RML2016.10a_dict.pkl'):
    d = load_all(path)
    Xs, ys, snrs = [], [], []
    for mod in MODS:
        for snr in SNRS:
            key = (mod, snr)
            arr = d[key]  # (1000,2,128)
            Xs.append(arr)
            ys.append(np.full(arr.shape[0], MOD2IDX[mod], dtype=np.int64))
            snrs.append(np.full(arr.shape[0], snr, dtype=np.int64))
    X = np.concatenate(Xs, axis=0).astype(np.float32)  # (220000,2,128)
    y = np.concatenate(ys, axis=0)
    s = np.concatenate(snrs, axis=0)
    return X, y, s

def stratified_split(seed=0, path='/data/RML2016.10a_dict.pkl'):
    """Per (mod,snr) key: 600 train / 200 val / 200 test. Returns idx arrays + description."""
    d = load_all(path)
    rng = np.random.RandomState(seed)
    tr, va, te = [], [], []
    # deterministic order over keys
    offset = 0
    for mod in MODS:
        for snr in SNRS:
            n = d[(mod, snr)].shape[0]  # 1000
            perm = rng.permutation(n)
            idx = offset + perm
            tr.append(idx[:600]); va.append(idx[600:800]); te.append(idx[800:1000])
            offset += n
    tr = np.concatenate(tr); va = np.concatenate(va); te = np.concatenate(te)
    # shuffle within split for training order determinism
    tr = rng.permutation(tr)
    va = np.sort(va); te = np.sort(te)
    desc = "stratified per (modulation,SNR): 600/200/200 of 1000 -> 132k/44k/44k, seed=%d" % seed
    h = hashlib.sha256()
    for a in (tr, va, te):
        h.update(a.tobytes())
    return tr, va, te, desc, h.hexdigest()
