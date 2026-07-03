"""Multi-decoder message-passing GNN for Nab event topology.

NuGraph2-style: one shared message-passing engine, several decoders:
  * event-class softmax (graph level)      -> topology classification
  * per-trigger softmax (node level)       -> electron/backscatter/proton/pile-up/noise
  * residual regression (graph level)      -> recon-minus-truth (d_eEng, d_tof)
                                              = the systematic-error hook

Implementation notes
--------------------
Nab events carry O(10) triggers, so instead of PyTorch Geometric's sparse
batching we use dense padded tensors [B, N, F] with a mask -- plain
PyTorch, no extra dependencies, trivially portable to the group's
machines and to GPUs.  Graphs are fully connected within an event; edge
features (dt, ring distance, same-detector) carry the geometry, matching
the "triggers are nodes, event types are graph-level outputs" framing.
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn

from .. import geometry
from ..taxonomy import N_CLASSES, N_TAGS, N_TRIGGER_LABELS
from ..toysim import ToyDataset

MAX_TRIGS = 12  # events with more triggers are truncated (rare; noise-heavy)

NODE_FEATS = 6  # x, y (norm), det, energy (norm), log-energy, time (norm)
EDGE_FEATS = 4  # |dt|, ring distance, same-det flag, same-pixel flag


# ---------------------------------------------------------------------------
# Tensorization
# ---------------------------------------------------------------------------

def dataset_to_tensors(ds: ToyDataset, residual_targets: dict[str, np.ndarray]):
    """Pack a ToyDataset into dense padded tensors.

    residual_targets: dict with 'd_eEng' (keV) and 'd_tof' (us) arrays from
    recon.residuals(); NaNs (recon failed) are masked out of the regression
    loss but kept as events.
    """
    n = ds.n_events
    off = ds.event_slices()

    x = np.zeros((n, MAX_TRIGS, NODE_FEATS), dtype=np.float32)
    ea = np.zeros((n, MAX_TRIGS, MAX_TRIGS, EDGE_FEATS), dtype=np.float32)
    mask = np.zeros((n, MAX_TRIGS), dtype=bool)
    y_node = np.full((n, MAX_TRIGS), -100, dtype=np.int64)  # ignore_index

    xy = geometry.XY_MM / geometry.DETECTOR_RADIUS_MM  # normalized coords

    for i in range(n):
        s, e = off[i], off[i + 1]
        k = min(e - s, MAX_TRIGS)
        if k == 0:
            continue
        # order by time, truncate to MAX_TRIGS keeping earliest
        order = np.argsort(ds.trig_time[s:e])[:k]
        pix = ds.trig_pixel[s:e][order]
        det = ds.trig_det[s:e][order].astype(np.float32)
        en = ds.trig_energy[s:e][order].astype(np.float32)
        tm = ds.trig_time[s:e][order].astype(np.float32)
        lb = ds.trig_label[s:e][order]

        x[i, :k, 0] = xy[pix, 0]
        x[i, :k, 1] = xy[pix, 1]
        x[i, :k, 2] = det
        x[i, :k, 3] = en / 800.0                      # ~ endpoint scale
        x[i, :k, 4] = np.log1p(en) / 7.0
        x[i, :k, 5] = tm / 40.0                       # ~ TOF window scale
        mask[i, :k] = True
        y_node[i, :k] = lb

        dt = np.abs(tm[:, None] - tm[None, :]) / 40.0
        rd = geometry.RING_DIST[pix[:, None], pix[None, :]] / 12.0
        same_det = (det[:, None] == det[None, :]).astype(np.float32)
        same_pix = (pix[:, None] == pix[None, :]).astype(np.float32)
        ea[i, :k, :k, 0] = dt
        ea[i, :k, :k, 1] = rd
        ea[i, :k, :k, 2] = same_det
        ea[i, :k, :k, 3] = same_pix

    d_eeng = np.nan_to_num(residual_targets["d_eEng"], nan=0.0).astype(np.float32)
    d_tof = np.nan_to_num(residual_targets["d_tof"], nan=0.0).astype(np.float32)
    res_mask = ~(
        np.isnan(residual_targets["d_eEng"]) | np.isnan(residual_targets["d_tof"])
    )

    return {
        "x": torch.from_numpy(x),
        "edge_attr": torch.from_numpy(ea),
        "mask": torch.from_numpy(mask),
        "y_event": torch.from_numpy(ds.event_class),
        "y_node": torch.from_numpy(y_node),
        "y_tags": torch.from_numpy(ds.event_tags.astype(np.float32)),
        "y_res": torch.from_numpy(
            np.stack([d_eeng / 100.0, d_tof / 5.0], axis=1)  # scaled targets
        ),
        "res_mask": torch.from_numpy(res_mask),
    }


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

class EdgeMPLayer(nn.Module):
    """One round of edge-conditioned message passing with attention weights."""

    def __init__(self, dim: int, edge_feats: int):
        super().__init__()
        self.msg = nn.Sequential(
            nn.Linear(2 * dim + edge_feats, dim), nn.SiLU(), nn.Linear(dim, dim)
        )
        self.att = nn.Sequential(
            nn.Linear(2 * dim + edge_feats, dim), nn.SiLU(), nn.Linear(dim, 1)
        )
        self.upd = nn.Sequential(
            nn.Linear(2 * dim, dim), nn.SiLU(), nn.Linear(dim, dim)
        )
        self.norm = nn.LayerNorm(dim)

    def forward(self, h, edge_attr, mask):
        B, N, D = h.shape
        hi = h.unsqueeze(2).expand(B, N, N, D)  # receiver
        hj = h.unsqueeze(1).expand(B, N, N, D)  # sender
        eij = torch.cat([hi, hj, edge_attr], dim=-1)

        m = self.msg(eij)                                   # [B,N,N,D]
        a = self.att(eij).squeeze(-1)                       # [B,N,N]
        # mask out padded senders and self-loops
        pad = mask.unsqueeze(1).expand(B, N, N).clone()
        idx = torch.arange(N, device=h.device)
        pad[:, idx, idx] = False
        a = a.masked_fill(~pad, -1e9)
        w = torch.softmax(a, dim=-1).unsqueeze(-1)          # [B,N,N,1]
        # events with a single trigger: softmax over all -1e9 -> uniform junk;
        # zero those rows via pad-any
        has_nb = pad.any(dim=-1, keepdim=True).unsqueeze(-1)
        agg = (w * m).sum(dim=2) * has_nb.squeeze(2)

        out = self.norm(h + self.upd(torch.cat([h, agg], dim=-1)))
        return out * mask.unsqueeze(-1)


class NabGNN(nn.Module):
    def __init__(
        self,
        dim: int = 96,
        n_layers: int = 3,
        node_feats: int = NODE_FEATS,
        edge_feats: int = EDGE_FEATS,
    ):
        super().__init__()
        self.enc = nn.Sequential(
            nn.Linear(node_feats, dim), nn.SiLU(), nn.Linear(dim, dim)
        )
        self.layers = nn.ModuleList(
            [EdgeMPLayer(dim, edge_feats) for _ in range(n_layers)]
        )
        pooled = 3 * dim  # mean + max + sum pooling
        self.event_head = nn.Sequential(
            nn.Linear(pooled, dim), nn.SiLU(), nn.Linear(dim, N_CLASSES)
        )
        self.node_head = nn.Sequential(
            nn.Linear(dim + pooled, dim), nn.SiLU(), nn.Linear(dim, N_TRIGGER_LABELS)
        )
        self.tag_head = nn.Sequential(
            nn.Linear(pooled, dim), nn.SiLU(), nn.Linear(dim, N_TAGS)
        )
        self.res_head = nn.Sequential(
            nn.Linear(pooled, dim), nn.SiLU(), nn.Linear(dim, 2)
        )

    def forward(self, x, edge_attr, mask):
        h = self.enc(x) * mask.unsqueeze(-1)
        for layer in self.layers:
            h = layer(h, edge_attr, mask)

        m = mask.unsqueeze(-1).float()
        denom = m.sum(dim=1).clamp(min=1.0)
        mean_p = (h * m).sum(dim=1) / denom
        max_p = h.masked_fill(~mask.unsqueeze(-1), -1e9).max(dim=1).values
        max_p = torch.where(
            mask.any(dim=1, keepdim=True), max_p, torch.zeros_like(max_p)
        )
        sum_p = (h * m).sum(dim=1)
        g = torch.cat([mean_p, max_p, sum_p], dim=-1)

        node_in = torch.cat(
            [h, g.unsqueeze(1).expand(-1, h.shape[1], -1)], dim=-1
        )
        return {
            "event_logits": self.event_head(g),
            "node_logits": self.node_head(node_in),
            "tag_logits": self.tag_head(g),
            "res_pred": self.res_head(g),
        }
