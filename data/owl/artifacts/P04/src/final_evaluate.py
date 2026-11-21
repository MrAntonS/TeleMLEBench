"""Final evaluation (runs ONCE after freeze): hash-gate, test-only eval, RESULTS.json + results/test_predictions.npz."""
import os, sys, json, hashlib, datetime
import numpy as np, torch
from torch.utils.data import TensorDataset, DataLoader
from sklearn.metrics import f1_score, cohen_kappa_score
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dataset import load_all, stratified_split, MODS
from model import MCDformer

WS = '~/workspace'
def sha(p):
    h = hashlib.sha256()
    with open(p,'rb') as f:
        for b in iter(lambda: f.read(1<<20), b''): h.update(b)
    return h.hexdigest()

def main():
    cfg = json.load(open(os.path.join(WS,'FROZEN_CONFIG.json')))
    cur = {f: sha(os.path.join(WS,'src',f)) for f in sorted(cfg['source_files'])}
    assert cur == cfg['source_hashes'], f'source changed since freeze: {cur} vs {cfg["source_hashes"]}'
    blob = ''.join(f'{k}:{cur[k]};' for k in sorted(cur)).encode()
    assert hashlib.sha256(blob).hexdigest() == cfg['source_sha256'], 'combined hash mismatch'
    X,y,s = load_all()
    (Xtr,ytr,str_),(Xva,yva,sva),(Xte,yte,ste),split_desc,split_sha = stratified_split(X,y,s,seed=cfg['split_seed'])
    assert split_sha == cfg['split_sha256'], 'split mismatch'
    dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    hp = cfg['hyperparameters']
    m = MCDformer(L=hp['L']['value'], nclass=11, heads=hp['n_heads']['value'], fddm_hidden=hp['fddm_hidden']['value'], clf_hidden=hp['clf_hidden']['value'], dropout=hp['dropout']['value']).to(dev)
    ck = torch.load(os.path.join(WS,'checkpoints','best.pt'), map_location=dev, weights_only=True)
    m.load_state_dict(ck['model']); m.eval()
    dl = DataLoader(TensorDataset(torch.from_numpy(Xte),torch.from_numpy(yte)),batch_size=1024,num_workers=4)
    P=[]
    with torch.no_grad():
        for xb,_ in dl:
            P.append(m(xb.to(dev)).argmax(1).cpu().numpy())
    yp = np.concatenate(P); yt = yte
    overall = float((yp==yt).mean())
    per = {str(int(v)): float(((yp[ste==v])==(yt[ste==v])).mean()) for v in sorted(set(ste.tolist()))}
    iv = {}
    for name,lo,hi in [('m20_m8',-20,-8),('m6_p8',-6,8),('p10_p18',10,18)]:
        msk=(ste>=lo)&(ste<=hi); iv[name]=float((yp[msk]==yt[msk]).mean())
    res = {'overall_accuracy':overall,'per_snr_accuracy':per,
      'interval_accuracy':iv,
      'interval_macro_f1':{k:float(f1_score(yt[(ste>=lo)&(ste<=hi)],yp[(ste>=lo)&(ste<=hi)],average='macro')) for k,lo,hi in [('m20_m8',-20,-8),('m6_p8',-6,8),('p10_p18',10,18)]},
      'interval_kappa':{k:float(cohen_kappa_score(yt[(ste>=lo)&(ste<=hi)],yp[(ste>=lo)&(ste<=hi)])) for k,lo,hi in [('m20_m8',-20,-8),('m6_p8',-6,8),('p10_p18',10,18)]},
      'macro_f1':float(f1_score(yt,yp,average='macro')),'kappa':float(cohen_kappa_score(yt,yp)),
      'n_test':int(len(yt)),'split_description':split_desc,'split_sha256':split_sha,
      'n_runs_or_seeds':1,'source_sha256':cfg['source_sha256'],
      'paper_reported':{'source':'Table I row MCDformer-A (p.6)','overall_accuracy':0.6335,'macro_f1':0.6562,'kappa':0.5969,'acc_10_18dB':0.9282},
      'difference_pp':float((overall-0.6335)*100),
      'final_eval_timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    json.dump(res, open(os.path.join(WS,'RESULTS.json'),'w'), indent=2)
    os.makedirs(os.path.join(WS,'results'),exist_ok=True)
    np.savez(os.path.join(WS,'results','test_predictions.npz'),y_true=yt,y_pred=yp,snr=ste)
    print(json.dumps({k:res[k] for k in ['overall_accuracy','macro_f1','kappa','interval_accuracy','n_test','difference_pp']},indent=2), flush=True)

if __name__=='__main__': main()
