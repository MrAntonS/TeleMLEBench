"""Metrics: overall accuracy, macro F1, Cohen's kappa. Verified vs sklearn in tests."""
import numpy as np
from sklearn.metrics import accuracy_score, f1_score, cohen_kappa_score


def compute_metrics(y_true, y_pred):
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)
    return {
        "overall_accuracy": float(accuracy_score(y_true, y_pred)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        "kappa": float(cohen_kappa_score(y_true, y_pred)),
    }


def per_snr_accuracy(y_true, y_pred, snrs):
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)
    snrs = np.asarray(snrs)
    out = {}
    for s in sorted(set(snrs.tolist())):
        m = snrs == s
        out[str(int(s))] = float((y_true[m] == y_pred[m]).mean())
    return out
