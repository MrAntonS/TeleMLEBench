"""Dataset split + loaders for RadioML2016.10a."""
import pickle, hashlib
import numpy as np
import torch
from torch.utils.data import TensorDataset, DataLoader

MODS = ['8PSK', 'AM-DSB', 'AM-SSB', 'BPSK', 'CPFSK', 'GFSK', 'PAM4', 'QAM16', 'QAM64', 'QPSK', 'WBFM']
SNRS = list(range(-20, 20, 2))
MOD_TO_IDX = {m: i for i, m in enumerate(MODS)}


def load_dict(path='/data/RML2016.10a_dict.pkl'):
    with open(path, 'rb') as f:
        return pickle.load(f, encoding='latin1')


def build_split(d, seed=0):
    """Per (mod,snr): 800 train, 100 val, 100 test. Returns dict of arrays + sha."""
    rng = np.random.RandomState(seed)
    trX, trY, trS, vaX, vaY, vaS, teX, teY, teS = [], [], [], [], [], [], [], [], []
    for mod in MODS:
        for snr in SNRS:
            arr = d[(mod, snr)]  # (1000,2,128)
            idx = rng.permutation(1000)
            mi = MOD_TO_IDX[mod]
            for j, lst in [(idx[:800], (trX, trY, trS)), (idx[800:900], (vaX, vaY, vaS)), (idx[900:], (teX, teY, teS))]:
                X, Y, S = lst
                X.append(arr[j])
                Y.append(np.full(len(j), mi, dtype=np.int64))
                S.append(np.full(len(j), snr, dtype=np.int16))
    out = {}
    for k, v in [('trX', trX), ('trY', trY), ('trS', trS), ('vaX', vaX), ('vaY', vaY), ('vaS', vaS),
                 ('teX', teX), ('teY', teY), ('teS', teS)]:
        out[k] = np.concatenate(v, axis=0)
    h = hashlib.sha256()
    for k in ['trY', 'vaY', 'teY', 'trS', 'vaS', 'teS']:
        h.update(out[k].tobytes())
    out['sha'] = h.hexdigest()
    return out


def make_loaders(split, batch=128, num_workers=2):
    def mk(X, Y):
        return DataLoader(TensorDataset(torch.from_numpy(np.ascontiguousarray(X)),
                                        torch.from_numpy(np.ascontiguousarray(Y))),
                          batch_size=batch, shuffle=True, num_workers=num_workers, pin_memory=True)
    def mk_eval(X, Y):
        return DataLoader(TensorDataset(torch.from_numpy(np.ascontiguousarray(X)),
                                        torch.from_numpy(np.ascontiguousarray(Y))),
                          batch_size=1024, shuffle=False, num_workers=num_workers)
    return mk(split['trX'], split['trY']), mk(split['vaX'], split['vaY']), mk_eval(split['teX'], split['teY'])
