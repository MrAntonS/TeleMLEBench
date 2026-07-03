import numpy as np
import torch

from nab_ml.calibrate import apply_temperature, ece, fit_temperature


def test_temperature_recovers_scale():
    """Logits deliberately over-confident by 3x -> fitted T ~ 3."""
    rng = np.random.default_rng(0)
    n, k = 4000, 5
    true_logits = torch.from_numpy(rng.normal(0, 1.5, (n, k))).float()
    y = torch.distributions.Categorical(logits=true_logits).sample()
    overconfident = true_logits * 3.0
    t = fit_temperature(overconfident, y)
    assert 2.0 < t < 4.5, t


def test_calibration_improves_ece():
    rng = np.random.default_rng(1)
    n, k = 4000, 5
    true_logits = torch.from_numpy(rng.normal(0, 1.5, (n, k))).float()
    y = torch.distributions.Categorical(logits=true_logits).sample()
    over = true_logits * 3.0
    t = fit_temperature(over, y)
    correct = (over.argmax(-1) == y).numpy()
    e_before = ece(torch.softmax(over, -1).numpy(), correct)
    e_after = ece(apply_temperature(over, t).numpy(), correct)
    assert e_after < e_before
