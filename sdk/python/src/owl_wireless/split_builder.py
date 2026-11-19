#!/usr/bin/env python3
"""Build an OWL split from provider files you downloaded yourself.

OWL publishes a *split definition* for datasets it may not redistribute: the task file (target,
feature columns, provider file names and SHA-256), and ``assignments.csv`` mapping every
``sample_id`` to its split and to (provider file, data row). This script verifies your provider
files against the task file and writes the same train / validation / test-features CSVs that OWL
would have mirrored. Test labels are never written: the test split gets features only.

Standalone (Python >= 3.9, standard library only):

    python split_builder.py --task task.json --assignments assignments.csv.gz \\
        --source ~/Downloads/CICIDS2017 --out ./cicids2017-split

``owl_wireless`` uses the same code for ``Dataset.load(source_dir=...)``.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import sys
import zipfile
from decimal import Decimal
from pathlib import Path
from typing import IO, Any, Dict, Iterator, List, Optional, Tuple

ROLES = {"train": "train", "val": "validation", "validation": "validation", "test": "test_features"}
OUTPUT_NAMES = {"train": "train.csv", "validation": "validation.csv", "test_features": "test-features.csv"}
CHUNK = 1 << 20
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


class BuildError(Exception):
    """Provider files are missing, do not match their checksum, or do not match the split definition."""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def ecmascript_number(text: str) -> str:
    """Format a numeric cell the way OWL's release builder does (ECMAScript Number#toString).

    ``"6.0" -> "6"``, ``"4000000.0" -> "4000000"``, ``"666666.6667"`` unchanged. Non-numeric and
    non-finite cells (labels, ``Infinity``, ``NaN``) are returned stripped but otherwise verbatim.
    """
    s = text.strip()
    try:
        x = float(s)
    except ValueError:
        return s
    if not math.isfinite(x) or not s or s.lower().lstrip("+-") in ("inf", "infinity", "nan"):
        return s
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    _, digits_t, exp = Decimal(repr(abs(x))).normalize().as_tuple()
    digits = "".join(map(str, digits_t))
    k = len(digits)
    n = k + int(exp)
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        mantissa = digits if k == 1 else digits[0] + "." + digits[1:]
        out = f"{mantissa}e{'+' if e >= 0 else '-'}{abs(e)}"
    return sign + out


def normalize_header(raw: List[str]) -> List[str]:
    """Strip names; the n-th repeat of a name becomes ``name__n`` (e.g. ``Fwd Header Length__2``)."""
    seen: Dict[str, int] = {}
    out = []
    for name in raw:
        name = name.strip().lstrip("﻿")
        seen[name] = seen.get(name, 0) + 1
        out.append(name if seen[name] == 1 else f"{name}__{seen[name]}")
    return out


def _open_text(path: Path) -> IO[str]:
    if path.name.endswith(".gz"):
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8", newline="")
    return open(path, encoding="utf-8", newline="")


def locate_sources(task: Dict[str, Any], source: Path, verify: bool = True) -> Dict[str, Path]:
    """Find every provider file named in the task file under ``source`` and check its SHA-256."""
    files = task["source"]["files"]
    found: Dict[str, Path] = {}
    if source.is_file():
        candidates = [source]
    else:
        candidates = [p for p in source.rglob("*") if p.is_file()]
    by_name: Dict[str, List[Path]] = {}
    for p in candidates:
        by_name.setdefault(p.name.lower(), []).append(p)
    missing, bad = [], []
    for f in files:
        options = by_name.get(f["name"].lower(), [])
        if not options and len(files) == 1 and source.is_file():
            options = [source]
        match = None
        for p in options:
            if not verify or (p.stat().st_size == f["byte_size"] and sha256_file(p) == f["sha256"]):
                match = p
                break
        if match is None:
            (bad if options else missing).append(f)
        else:
            found[f["name"]] = match
    if missing or bad:
        lines = [f"  {f['name']}  sha256 {f['sha256']}  ({f['byte_size']} bytes)" for f in missing + bad]
        raise BuildError(
            ("Provider files missing" if missing else "Provider files do not match their SHA-256")
            + f" under {source}:\n" + "\n".join(lines)
            + f"\nDownload them from {task['source'].get('provider_url') or 'the provider'}."
        )
    return found


def locate_member_files(source: Path, member_names: List[str]) -> Optional[Dict[str, Path]]:
    """For a zipped provider snapshot, accept the extracted member CSVs instead (no per-file hashes)."""
    if not source.is_dir():
        return None
    by_name = {p.name.lower(): p for p in source.rglob("*.csv")}
    found = {}
    for name in member_names:
        p = by_name.get(name.rsplit("/", 1)[-1].lower())
        if p is None:
            return None
        found[name.rsplit("/", 1)[-1]] = p
    return found


class _Members:
    """Opens provider members by the names used in assignments.csv."""

    def __init__(self, task: Dict[str, Any], sources: Dict[str, Path], members_extracted: bool = False):
        self.format = task["source"]["format"]
        self.sources = sources
        self.zip: Optional[zipfile.ZipFile] = None
        if self.format == "csv_zip" and not members_extracted:
            (path,) = sources.values()
            self.zip = zipfile.ZipFile(path)

    def open(self, name: str) -> IO[str]:
        if self.zip is not None:
            return io.TextIOWrapper(self.zip.open(name), encoding="utf-8", newline="")
        base = name.rsplit("/", 1)[-1]
        if base not in self.sources:
            raise BuildError(f"assignments.csv refers to {name!r}, which is not a listed provider file")
        return open(self.sources[base], encoding="utf-8", newline="")

    def close(self) -> None:
        if self.zip is not None:
            self.zip.close()


def _assignments(path: Path) -> Iterator[Tuple[str, str, str, int]]:
    with _open_text(path) as fh:
        reader = csv.reader(fh)
        header = next(reader)
        idx = {k: header.index(k) for k in ("sample_id", "split", "source_file", "source_row")}
        for row in reader:
            yield (row[idx["sample_id"]], row[idx["split"]], row[idx["source_file"]], int(row[idx["source_row"]]))


def build(task: Dict[str, Any], assignments: Path, source: Path, out_dir: Path,
          verify_sources: bool = True, log: Any = None) -> Dict[str, Any]:
    """Write train.csv, validation.csv and test-features.csv to ``out_dir``.

    Returns ``{"files": {role: path}, "matches_reference": {role: bool | None}}``. A reference
    mismatch means the bytes differ from OWL's own build (sample IDs and split membership still come
    from ``assignments.csv``, so hidden-label scoring is unaffected).
    """
    feature_fields: List[str] = task["feature_fields"]
    target_fields: List[str] = task["target_fields"]
    members_extracted = False
    try:
        sources = locate_sources(task, source, verify=verify_sources)
    except BuildError:
        # Zipped snapshot not found: accept the extracted member CSVs, but then the built files
        # must match OWL's reference hashes exactly, since the members have no checksums of their own.
        extracted = (locate_member_files(source, task["source"].get("members") or [])
                     if task["source"].get("format") == "csv_zip" else None)
        if extracted is None or not task.get("reference_outputs"):
            raise
        sources, members_extracted = extracted, True
    members = _Members(task, sources, members_extracted)
    out_dir.mkdir(parents=True, exist_ok=True)
    parts = {role: out_dir / (OUTPUT_NAMES[role] + ".part") for role in OUTPUT_NAMES}
    handles = {role: open(p, "w", encoding="utf-8", newline="") for role, p in parts.items()}
    writers = {role: csv.writer(h, lineterminator="\n") for role, h in handles.items()}
    for role, w in writers.items():
        w.writerow(["sample_id", *feature_fields, *([] if role == "test_features" else target_fields)])
    counts = {role: 0 for role in OUTPUT_NAMES}
    try:
        current: Optional[str] = None
        reader: Optional[Iterator[List[str]]] = None
        handle: Optional[IO[str]] = None
        row_no = 0
        cols: List[int] = []
        tcols: List[int] = []
        for sample_id, split, source_file, source_row in _assignments(assignments):
            if source_file != current:
                if handle is not None:
                    handle.close()
                handle = members.open(source_file)
                reader = csv.reader(handle)
                header = normalize_header(next(reader))
                try:
                    cols = [header.index(f) for f in feature_fields]
                    tcols = [header.index(f) for f in target_fields]
                except ValueError as exc:
                    raise BuildError(f"{source_file}: column {exc} not found; is this the right provider file?")
                current, row_no = source_file, 0
                if log:
                    log(f"reading {source_file}")
            assert reader is not None
            row: List[str] = []
            while not row:  # blank lines are not data rows
                row = next(reader, None)  # type: ignore[assignment]
                if row is None:
                    raise BuildError(f"{source_file} has fewer rows than assignments.csv expects ({source_row})")
            row_no += 1
            if row_no != source_row:
                raise BuildError(f"{source_file}: assignments.csv expects row {source_row}, file is at row {row_no}")
            role = ROLES.get(split)
            if role is None:
                raise BuildError(f"unknown split {split!r} for {sample_id}")
            values = [ecmascript_number(row[i]) for i in cols]
            if role != "test_features":
                values += [ecmascript_number(row[i]) for i in tcols]
            writers[role].writerow([sample_id, *values])
            counts[role] += 1
        if handle is not None:
            handle.close()
    finally:
        for h in handles.values():
            h.close()
        members.close()
    expected = task.get("counts") or {}
    for split, role in (("train", "train"), ("validation", "validation"), ("test", "test_features")):
        if expected.get(split) is not None and expected[split] != counts[role]:
            raise BuildError(f"{role}: built {counts[role]} rows, the split definition says {expected[split]}")
    files, matches = {}, {}
    reference = task.get("reference_outputs") or {}
    for role, part in parts.items():
        final = out_dir / OUTPUT_NAMES[role]
        part.replace(final)
        files[role] = final
        ref = reference.get(role)
        matches[role] = (sha256_file(final) == ref["sha256"]) if ref and ref.get("sha256") else None
    if members_extracted and not all(matches.values()):
        for path in files.values():
            path.unlink()
        raise BuildError("the extracted provider CSVs do not reproduce OWL's reference split; "
                         "download the original archive listed in the task file")
    return {"files": files, "matches_reference": matches, "counts": counts,
            "sources_verified": "reference_outputs" if members_extracted else "sha256"}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--task", required=True, type=Path, help="task.json from /releases/{id}/files/task")
    ap.add_argument("--assignments", required=True, type=Path, help="assignments.csv[.gz] from the release")
    ap.add_argument("--source", required=True, type=Path, help="provider file or directory you downloaded")
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args(argv)
    task = json.loads(args.task.read_text())
    try:
        result = build(task, args.assignments, args.source, args.out, log=lambda m: print(m, file=sys.stderr))
    except BuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    for role, path in result["files"].items():
        same = result["matches_reference"][role]
        note = "" if same is None else ("  (identical to OWL's build)" if same else "  (differs from OWL's build)")
        print(f"{role:<14} {result['counts'][role]:>10} rows  {path}{note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
