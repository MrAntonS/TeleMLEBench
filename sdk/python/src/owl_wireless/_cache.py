"""Local cache with SHA-256 verification."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Optional

from . import _http
from .errors import ChecksumMismatch, ServiceError

CHUNK = 1 << 20


def cache_dir() -> Path:
    root = os.environ.get("OWL_CACHE")
    path = Path(root).expanduser() if root else Path.home() / ".cache" / "owl"
    path.mkdir(parents=True, exist_ok=True)
    return path


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def _stamp(path: Path) -> str:
    st = path.stat()
    return f"{st.st_size}:{st.st_mtime_ns}"


def _marker(path: Path) -> Path:
    return path.with_name(path.name + ".sha256")


def is_verified(path: Path, sha256: str) -> bool:
    """True when ``path`` exists and its SHA-256 equals ``sha256``.

    A sidecar ``<file>.sha256`` remembers a verified hash for the file's current size and
    mtime, so large files are hashed once, not on every ``load()``.
    """
    if not path.is_file():
        return False
    marker = _marker(path)
    try:
        recorded_sha, recorded_stamp = marker.read_text().split()
        if recorded_sha == sha256 and recorded_stamp == _stamp(path):
            return True
    except (OSError, ValueError):
        pass
    if sha256_file(path) == sha256:
        marker.write_text(f"{sha256} {_stamp(path)}\n")
        return True
    return False


def download_verified(url: str, dest: Path, sha256: str, size: Optional[int] = None) -> Path:
    """Download ``url`` to ``dest`` unless a file with the expected SHA-256 is already there."""
    sha256 = sha256.lower()
    if is_verified(dest, sha256):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    h = hashlib.sha256()
    with _http.session().get(url, stream=True, timeout=_http.TIMEOUT, allow_redirects=True) as resp:
        if not resp.ok:
            raise ServiceError(f"download of {url} failed with HTTP {resp.status_code}")
        header_sha = next(
            (r.headers.get("X-TeleMLEBench-SHA256") for r in [*resp.history, resp]
             if r.headers.get("X-TeleMLEBench-SHA256")),
            None,
        )
        if header_sha and header_sha.lower() != sha256:
            raise ChecksumMismatch(str(dest), sha256, f"{header_sha} (server header)")
        with open(part, "wb") as fh:
            for block in resp.iter_content(CHUNK):
                fh.write(block)
                h.update(block)
    actual = h.hexdigest()
    if actual != sha256 or (size is not None and part.stat().st_size != size):
        part.unlink(missing_ok=True)
        raise ChecksumMismatch(str(dest), sha256, actual)
    os.replace(part, dest)
    _marker(dest).write_text(f"{sha256} {_stamp(dest)}\n")
    return dest
