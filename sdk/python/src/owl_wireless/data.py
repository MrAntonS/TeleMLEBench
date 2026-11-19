"""Task adapters: turn verified release files into pandas / numpy objects."""
from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import numpy as np
import pandas as pd

from .errors import OWLError

Table = Union[pd.DataFrame, Dict[str, np.ndarray]]


def _read_csv(path: Path) -> pd.DataFrame:
    kwargs: Dict[str, Any] = {"dtype": {"sample_id": str}}
    try:
        import pyarrow  # noqa: F401  (optional, faster parser)

        kwargs["engine"] = "pyarrow"
    except ImportError:
        kwargs["low_memory"] = False
    return pd.read_csv(path, **kwargs)


def _read_npz_zip(path: Path) -> Dict[str, np.ndarray]:
    """Concatenate every ``.npz`` group in the archive, in archive order.

    IQ releases (RadioML, WiSig) ship ``groups/<hash>.npz`` members with arrays such as
    ``iq`` (n, 2, length), ``sample_id`` and, for train/validation only, the target.
    """
    parts: Dict[str, List[np.ndarray]] = {}
    with zipfile.ZipFile(path) as archive:
        members = [m for m in archive.infolist() if m.filename.endswith(".npz")]
        if not members:
            raise OWLError(f"{path.name} contains no .npz groups; open the file directly from split.files")
        for member in members:
            with np.load(io.BytesIO(archive.read(member)), allow_pickle=False) as group:
                keys = set(group.files)
                if parts and keys != set(parts):
                    raise OWLError(f"{member.filename} has arrays {sorted(keys)}, expected {sorted(parts)}")
                for key in group.files:
                    parts.setdefault(key, []).append(group[key])
    return {key: np.concatenate(chunks) for key, chunks in parts.items()}


def read_table(path: Path, media_type: str) -> Table:
    name = path.name.lower()
    if name.endswith((".csv", ".csv.gz")) or media_type in ("text/csv", "application/csv"):
        return _read_csv(path)
    if name.endswith(".zip") or media_type == "application/zip":
        return _read_npz_zip(path)
    raise OWLError(f"no task adapter for {path.name} ({media_type}); the verified file is at {path}")


@dataclass
class Split:
    """A downloaded, checksum-verified release. Tables are read on first access."""

    release_id: str
    version: str
    target: Optional[str]
    metric: Optional[str]
    target_fields: List[str]
    files: Dict[str, Path]
    media_types: Dict[str, str] = field(repr=False)
    expected_test_rows: Optional[int] = None
    _tables: Dict[str, Table] = field(default_factory=dict, repr=False)

    def _table(self, role: str) -> Table:
        if role not in self._tables:
            self._tables[role] = read_table(self.files[role], self.media_types[role])
        return self._tables[role]

    @property
    def train(self) -> Table:
        return self._table("train")

    @property
    def val(self) -> Table:
        return self._table("validation")

    @property
    def test_inputs(self) -> Table:
        """Test features with ``sample_id``; labels stay on the server."""
        return self._table("test_features")

    def test_sample_ids(self) -> np.ndarray:
        table = self.test_inputs
        ids = table["sample_id"]
        return ids.to_numpy() if isinstance(ids, pd.Series) else np.asarray(ids)
