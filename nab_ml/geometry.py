"""Nab detector pixel geometry.

Each Nab silicon detector has 127 hexagonal pixels arranged in a centered
hexagonal lattice: a central pixel (ring 0) surrounded by rings 1..6 with
6*k pixels in ring k, giving 1 + 6+12+18+24+30+36 = 127.

We use axial hex coordinates (q, r) with the standard cube-coordinate
distance.  Pixel IDs are assigned 0..126 in ring order (ring 0 first,
then ring 1 counterclockwise, ...), which is stable and easy to reason
about.  When we eventually map to the experiment's own pixel numbering,
only `PIXEL_ORDER` needs to change.

The pixel flat-to-flat pitch is chosen so that "two pixel rings" matches
the 18.2 mm coincidence-search radius used by the current reconstruction
(Jin's doc): 2 rings ~ 18.2 mm  =>  pitch ~ 9.1 mm... in reality the Nab
pixel is ~5.9 mm flat-to-flat with 127 pixels over a ~70 mm active
region; the exact value only sets a distance scale in the toy simulation
and features, not any physics conclusion.
"""

from __future__ import annotations

import numpy as np

N_PIXELS = 127
N_RINGS = 6  # rings 1..6 around the central pixel
PIXEL_PITCH_MM = 9.1  # center-to-center distance so that 2 rings = 18.2 mm

# Axial hex directions (pointy-top), counterclockwise.
_HEX_DIRS = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]


def _build_axial_coords() -> np.ndarray:
    """Return (127, 2) int array of axial (q, r) coords in ring order."""
    coords = [(0, 0)]
    for ring in range(1, N_RINGS + 1):
        # Start at (ring, -ring)... standard ring walk: start at direction 4
        # scaled by ring, then walk each of the 6 sides.
        q, r = ring, 0
        # Walk order: start on the +q axis and go counterclockwise.
        for side in range(6):
            dq, dr = _HEX_DIRS[(side + 2) % 6]
            for _ in range(ring):
                coords.append((q, r))
                q, r = q + dq, r + dr
    assert len(coords) == N_PIXELS, len(coords)
    return np.array(coords, dtype=np.int64)


AXIAL = _build_axial_coords()  # (127, 2)


def _axial_to_xy(axial: np.ndarray) -> np.ndarray:
    """Axial -> cartesian (mm), pointy-top hex layout."""
    q = axial[:, 0].astype(np.float64)
    r = axial[:, 1].astype(np.float64)
    x = PIXEL_PITCH_MM * (q + r / 2.0)
    y = PIXEL_PITCH_MM * (np.sqrt(3.0) / 2.0) * r
    return np.stack([x, y], axis=1)


XY_MM = _axial_to_xy(AXIAL)  # (127, 2) pixel centers in mm


def hex_distance(pix_a: np.ndarray, pix_b: np.ndarray) -> np.ndarray:
    """Ring (hex lattice) distance between pixel IDs. Vectorized."""
    a = AXIAL[np.asarray(pix_a)]
    b = AXIAL[np.asarray(pix_b)]
    dq = a[..., 0] - b[..., 0]
    dr = a[..., 1] - b[..., 1]
    return ((np.abs(dq) + np.abs(dr) + np.abs(dq + dr)) // 2).astype(np.int64)


def ring_of(pixel: np.ndarray) -> np.ndarray:
    """Ring index (0..6) of each pixel ID = hex distance from center."""
    return hex_distance(pixel, np.zeros_like(np.asarray(pixel)))


def euclid_distance_mm(pix_a: np.ndarray, pix_b: np.ndarray) -> np.ndarray:
    a = XY_MM[np.asarray(pix_a)]
    b = XY_MM[np.asarray(pix_b)]
    return np.sqrt(((a - b) ** 2).sum(axis=-1))


# Precomputed full pairwise ring-distance matrix (127 x 127); small.
ALL_IDS = np.arange(N_PIXELS)
RING_DIST = hex_distance(ALL_IDS[:, None], ALL_IDS[None, :])


def neighbors(pixel: int, max_ring: int = 1) -> np.ndarray:
    """Pixel IDs within `max_ring` hex rings of `pixel` (excluding itself)."""
    d = RING_DIST[pixel]
    out = np.where((d > 0) & (d <= max_ring))[0]
    return out


def pixel_at_xy(x_mm: float, y_mm: float) -> int:
    """Nearest-pixel-center lookup (adequate stand-in for exact hex binning)."""
    d2 = (XY_MM[:, 0] - x_mm) ** 2 + (XY_MM[:, 1] - y_mm) ** 2
    return int(np.argmin(d2))


def pixels_at_xy(x_mm: np.ndarray, y_mm: np.ndarray) -> np.ndarray:
    """Vectorized nearest-pixel lookup."""
    pts = np.stack([np.asarray(x_mm), np.asarray(y_mm)], axis=-1)  # (N,2)
    d2 = ((pts[:, None, :] - XY_MM[None, :, :]) ** 2).sum(axis=-1)
    return np.argmin(d2, axis=1)


DETECTOR_RADIUS_MM = float(np.max(np.sqrt((XY_MM**2).sum(axis=1)))) + PIXEL_PITCH_MM / 2
