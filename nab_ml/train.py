"""Training loop for the multi-decoder NabGNN."""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
import torch
import torch.nn.functional as F

from .models.gnn import NabGNN


@dataclass
class TrainConfig:
    epochs: int = 30
    batch_size: int = 256
    lr: float = 2e-3
    weight_decay: float = 1e-4
    w_event: float = 1.0
    w_node: float = 0.5
    w_tags: float = 0.3
    w_res: float = 0.5
    patience: int = 6
    seed: int = 0
    device: str = "cpu"
    # class-imbalance handling: weight ~ (1/freq)^power.  power=1 chases
    # rare classes at the cost of majority accuracy (v1 pathology: clean
    # recall collapsed to 0.43); power~0.5 is the sane default.
    weight_power: float = 0.5
    weight_clamp: float = 10.0
    # model selection: "macro_f1" (default) or "loss"
    select_by: str = "macro_f1"


def class_weights(
    y: torch.Tensor, n_classes: int, power: float = 0.5, clamp: float = 10.0
) -> torch.Tensor:
    """(1/frequency)^power weights, normalized to mean 1, clipped."""
    counts = torch.bincount(y, minlength=n_classes).float().clamp(min=1.0)
    w = (counts.sum() / (n_classes * counts)) ** power
    w = w / w.mean()
    return w.clamp(max=clamp)


def _batches(n: int, bs: int, rng: np.random.Generator | None):
    idx = np.arange(n)
    if rng is not None:
        rng.shuffle(idx)
    for s in range(0, n, bs):
        yield torch.from_numpy(idx[s : s + bs])


def multitask_loss(out, batch, ev_w, node_w, cfg: TrainConfig):
    l_event = F.cross_entropy(out["event_logits"], batch["y_event"], weight=ev_w)
    l_node = F.cross_entropy(
        out["node_logits"].reshape(-1, out["node_logits"].shape[-1]),
        batch["y_node"].reshape(-1),
        weight=node_w,
        ignore_index=-100,
    )
    l_tags = F.binary_cross_entropy_with_logits(out["tag_logits"], batch["y_tags"])
    rm = batch["res_mask"]
    if rm.any():
        l_res = F.smooth_l1_loss(out["res_pred"][rm], batch["y_res"][rm])
    else:
        l_res = torch.zeros((), device=out["res_pred"].device)
    total = (
        cfg.w_event * l_event
        + cfg.w_node * l_node
        + cfg.w_tags * l_tags
        + cfg.w_res * l_res
    )
    return total, {
        "event": float(l_event.detach()),
        "node": float(l_node.detach()),
        "tags": float(l_tags.detach()),
        "res": float(l_res.detach()),
    }


def train_gnn(
    model: NabGNN,
    tensors_train: dict,
    tensors_val: dict,
    cfg: TrainConfig | None = None,
    verbose: bool = True,
):
    cfg = cfg or TrainConfig()
    torch.manual_seed(cfg.seed)
    dev = torch.device(cfg.device)
    model = model.to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=cfg.epochs)

    from .taxonomy import N_CLASSES, N_TRIGGER_LABELS

    ev_w = class_weights(
        tensors_train["y_event"], N_CLASSES, cfg.weight_power, cfg.weight_clamp
    ).to(dev)
    node_y = tensors_train["y_node"]
    node_w = class_weights(
        node_y[node_y >= 0], N_TRIGGER_LABELS, cfg.weight_power, cfg.weight_clamp
    ).to(dev)

    n = tensors_train["y_event"].shape[0]
    rng = np.random.default_rng(cfg.seed)
    keys = ["x", "edge_attr", "mask", "y_event", "y_node", "y_tags", "y_res", "res_mask"]

    best_val, best_state, bad = np.inf, None, 0
    history = []
    for epoch in range(cfg.epochs):
        model.train()
        t0 = time.time()
        tr_loss, nb = 0.0, 0
        for bidx in _batches(n, cfg.batch_size, rng):
            batch = {k: tensors_train[k][bidx].to(dev) for k in keys}
            out = model(batch["x"], batch["edge_attr"], batch["mask"])
            loss, _ = multitask_loss(out, batch, ev_w, node_w, cfg)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            tr_loss += float(loss.detach())
            nb += 1
        sched.step()

        # validation
        model.eval()
        va_loss, va_nb = 0.0, 0
        preds, trues = [], []
        with torch.no_grad():
            for bidx in _batches(tensors_val["y_event"].shape[0], 1024, None):
                batch = {k: tensors_val[k][bidx].to(dev) for k in keys}
                out = model(batch["x"], batch["edge_attr"], batch["mask"])
                loss, _ = multitask_loss(out, batch, ev_w, node_w, cfg)
                va_loss += float(loss)
                va_nb += 1
                preds.append(out["event_logits"].argmax(dim=-1).cpu())
                trues.append(batch["y_event"].cpu())
        va_loss /= max(va_nb, 1)
        yp = torch.cat(preds).numpy()
        yt = torch.cat(trues).numpy()
        acc = float((yp == yt).mean())

        from .eval import confusion, per_class_metrics

        f1 = per_class_metrics(confusion(yt, yp, N_CLASSES))["macro_f1"]
        history.append(
            {"epoch": epoch, "train_loss": tr_loss / max(nb, 1),
             "val_loss": va_loss, "val_acc": acc, "val_macro_f1": float(f1),
             "sec": time.time() - t0}
        )
        if verbose:
            h = history[-1]
            print(
                f"epoch {epoch:3d}  train {h['train_loss']:.4f}  "
                f"val {h['val_loss']:.4f}  acc {h['val_acc']:.4f}  "
                f"mF1 {h['val_macro_f1']:.4f}  {h['sec']:.1f}s"
            )
        score = -f1 if cfg.select_by == "macro_f1" else va_loss
        if score < best_val - 1e-4:
            best_val, bad = score, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
            if bad >= cfg.patience:
                break

    if best_state is not None:
        model.load_state_dict(best_state)
    return model, history


@torch.no_grad()
def predict(model: NabGNN, tensors: dict, device: str = "cpu", bs: int = 1024):
    model.eval()
    dev = torch.device(device)
    outs = {"event_logits": [], "node_logits": [], "tag_logits": [], "res_pred": []}
    n = tensors["y_event"].shape[0]
    for bidx in _batches(n, bs, None):
        out = model(
            tensors["x"][bidx].to(dev),
            tensors["edge_attr"][bidx].to(dev),
            tensors["mask"][bidx].to(dev),
        )
        for k in outs:
            outs[k].append(out[k].cpu())
    return {k: torch.cat(v) for k, v in outs.items()}
