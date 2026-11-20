"""Dataset: load RML2016.10a dict, stratified 60/20/20 split (seed 0). Test locked: only train/val used pre-freeze."""
import pickle, hashlib
import numpy as np

MODS = ['8PSK','AM-DSB','AM-SSB','BPSK','CPFSK','GFSK','PAM4','QAM16','QAM64','QPSK','WBFM']
SNRS = [-20,-18,-16,-14,-12,-10,-8,-6,-4,-2,0,2,4,6,8,10,12,14,16,18]
MOD2IDX = {m:i for i,m in enumerate(MODS)}
DATA_PATH = '/data/RML2016.10a_dict.pkl'

def load_all(path=DATA_PATH):
    with open(path,'rb') as f:
        d = pickle.load(f, encoding='latin1')
    Xl, yl, sl = [], [], []
    for mod in MODS:
        for snr in SNRS:
            arr = d[(mod, snr)].astype(np.float32)  # (1000,2,128)
            Xl.append(arr); yl += [MOD2IDX[mod]]*len(arr); sl += [snr]*len(arr)
    X = np.concatenate(Xl, axis=0)
    y = np.array(yl, dtype=np.int64); s = np.array(sl, dtype=np.int64)
    return X, y, s

def stratified_split(X, y, s, seed=0, train_frac=0.6, val_frac=0.2):
    rng = np.random.RandomState(seed)
    tr, va, te = [], [], []
    for mi in range(len(MODS)):
        for snr in SNRS:
            idx = np.where((y==mi)&(s==snr))[0]
            rng.shuffle(idx)
            n = len(idx); ntr = int(n*train_frac); nva = int(n*val_frac)
            tr += idx[:ntr].tolist(); va += idx[ntr:ntr+nva].tolist(); te += idx[ntr+nva:].tolist()
    tr = np.array(sorted(tr)); va = np.array(sorted(va)); te = np.array(sorted(te))
    h = hashlib.sha256()
    h.update(f"{seed}|{train_frac}|{val_frac}|".encode()+tr.tobytes()+va.tobytes()+te.tobytes())
    return (X[tr],y[tr],s[tr]), (X[va],y[va],s[va]), (X[te],y[te],s[te]), 'stratified-(mod,snr) 60/20/20 seed=0', h.hexdigest()
