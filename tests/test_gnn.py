"""GNN model tests: shapes, masking invariance, overfit sanity."""

import numpy as np
import pytest
import torch

from nab_ml.models.gnn import MAX_TRIGS, NabGNN, dataset_to_tensors
from nab_ml.recon import residuals, run_tcoinc
from nab_ml.taxonomy import N_CLASSES, N_TRIGGER_LABELS
from nab_ml.toysim import NabToySimulator, SimConfig


@pytest.fixture(scope="module")
def tensors():
    ds = NabToySimulator(SimConfig(seed=11, n_events=600)).generate()
    rec = run_tcoinc(ds)
    return dataset_to_tensors(ds, residuals(ds, rec))


def test_tensor_shapes(tensors):
    n = tensors["y_event"].shape[0]
    assert tensors["x"].shape[:2] == (n, MAX_TRIGS)
    assert tensors["edge_attr"].shape[1:3] == (MAX_TRIGS, MAX_TRIGS)
    assert tensors["mask"].dtype == torch.bool
    # padded node labels are ignore_index
    assert (tensors["y_node"][~tensors["mask"]] == -100).all()


def test_forward_shapes(tensors):
    model = NabGNN(dim=32, n_layers=2)
    out = model(tensors["x"][:8], tensors["edge_attr"][:8], tensors["mask"][:8])
    assert out["event_logits"].shape == (8, N_CLASSES)
    assert out["node_logits"].shape == (8, MAX_TRIGS, N_TRIGGER_LABELS)
    assert out["res_pred"].shape == (8, 2)
    for v in out.values():
        assert torch.isfinite(v).all()


def test_padding_invariance(tensors):
    """Changing features of PADDED slots must not change outputs."""
    model = NabGNN(dim=32, n_layers=2)
    model.eval()
    x = tensors["x"][:16].clone()
    ea = tensors["edge_attr"][:16].clone()
    mask = tensors["mask"][:16]
    with torch.no_grad():
        out1 = model(x, ea, mask)
        x2 = x.clone()
        x2[~mask] = 99.0  # garbage in padded slots
        out2 = model(x2, ea, mask)
    assert torch.allclose(out1["event_logits"], out2["event_logits"], atol=1e-5)
    assert torch.allclose(out1["res_pred"], out2["res_pred"], atol=1e-5)


def test_gnn_can_overfit_tiny_subset(tensors):
    """200 events, a few hundred steps: training loss must drop a lot."""
    from nab_ml.train import TrainConfig, train_gnn

    sub = {k: v[:200] for k, v in tensors.items()}
    model = NabGNN(dim=48, n_layers=2)
    cfg = TrainConfig(epochs=80, batch_size=64, lr=3e-3, patience=200)
    model, hist = train_gnn(model, sub, sub, cfg, verbose=False)
    # loss must collapse and the best epoch must fit the subset well
    assert hist[-1]["train_loss"] < hist[0]["train_loss"] / 4, hist[-1]
    assert max(h["val_acc"] for h in hist) > 0.80, hist[-1]
