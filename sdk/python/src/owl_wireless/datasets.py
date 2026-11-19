"""Dataset catalog, releases and downloads."""
from __future__ import annotations

import json
import re
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from . import _cache, _http, split_builder
from .data import Split
from .errors import Ambiguous, ChecksumMismatch, DatasetNotReleased, NotFound, OWLError

# Same tables the site reads. Versions use * so new license columns appear without a client change.
_DATASET_SELECT = (
    "id,slug,title,concept_doi,paper_count,"
    "tmlb_dataset_versions(*,tmlb_dataset_profiles(primary_task_name,primary_task_type,modalities)),"
    "tmlb_dataset_sources(provider,landing_url,access_status)"
)
_DATA_ROLES = ("train", "validation", "test_features")


@dataclass(frozen=True)
class ReleaseFile:
    role: str
    logical_path: str
    media_type: str
    byte_size: int
    sha256: str
    download_endpoint: str


@dataclass(frozen=True)
class ReleaseInfo:
    id: str
    version: str
    task_id: str
    dataset_version_id: str
    catalog_dataset_version_id: Optional[str]
    dataset_aliases: Tuple[str, ...]
    target_fields: Tuple[str, ...]
    metric: Optional[str]
    scoring_available: bool
    counts: Dict[str, int]
    files: Tuple[ReleaseFile, ...]
    # "mirrored" (OWL serves the files) or "provider_only" (split definition only); None on old servers.
    distribution: Optional[str] = None
    provider_url: Optional[str] = None
    license: Optional[Dict[str, Any]] = field(default=None, compare=False)
    source_files: Tuple[Dict[str, Any], ...] = ()

    @classmethod
    def from_api(cls, raw: Dict[str, Any]) -> "ReleaseInfo":
        evaluation = raw.get("evaluation") or {}
        split = raw.get("split") or {}
        source = raw.get("source") or {}
        return cls(
            id=raw["id"],
            version=raw.get("release_version") or split.get("view"),
            task_id=raw.get("task_id"),
            dataset_version_id=raw.get("dataset_version_id"),
            catalog_dataset_version_id=raw.get("catalog_dataset_version_id"),
            dataset_aliases=tuple(raw.get("dataset_aliases") or ()),
            target_fields=tuple(raw.get("target_fields") or ()),
            metric=evaluation.get("metric"),
            scoring_available=bool(evaluation.get("available")),
            counts=dict(split.get("counts") or {}),
            files=tuple(
                ReleaseFile(
                    role=f["role"], logical_path=f["logical_path"], media_type=f.get("media_type"),
                    byte_size=int(f["byte_size"]), sha256=f["sha256"].lower(),
                    download_endpoint=f["download_endpoint"],
                )
                for f in raw.get("files") or ()
            ),
            distribution=raw.get("distribution"),
            provider_url=raw.get("provider_url"),
            license=raw.get("license"),
            source_files=tuple(source.get("files") or ()),
        )

    def file(self, role: str) -> Optional[ReleaseFile]:
        return next((f for f in self.files if f.role == role), None)

    @property
    def mirrored(self) -> bool:
        """OWL serves the split files. Old servers without the field listed data files only when mirrored."""
        if self.distribution is not None:
            return self.distribution == "mirrored"
        return all(self.file(r) is not None for r in _DATA_ROLES)


@dataclass(frozen=True)
class DatasetInfo:
    id: str
    slug: str
    title: str
    doi: Optional[str]
    task: Optional[str]
    task_type: Optional[str]
    modalities: Tuple[str, ...]
    license: Optional[str]
    license_url: Optional[str]
    license_source_url: Optional[str]
    license_terms: Optional[str]
    access: Optional[str]
    redistribution: Optional[str]
    provider_url: Optional[str]
    paper_count: Optional[int]
    dataset_versions: Tuple[str, ...]
    releases: Tuple[ReleaseInfo, ...]

    @property
    def released(self) -> bool:
        """OWL has published a release (mirrored data or a split definition) for this dataset."""
        return bool(self.releases)

    @property
    def downloadable(self) -> bool:
        """``load()`` downloads from OWL: a mirrored release exists and the catalog allows redistribution."""
        return self.redistribution == "allowed" and any(r.mirrored for r in self.releases)

    @property
    def release_versions(self) -> List[str]:
        return [r.version for r in self.releases]


def _first(value: Any) -> Dict[str, Any]:
    if isinstance(value, list):
        return value[0] if value else {}
    return value or {}


def _version_key(text: str) -> List[Any]:
    return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", text or "")]


def _info(row: Dict[str, Any], releases: List[ReleaseInfo]) -> DatasetInfo:
    versions = row.get("tmlb_dataset_versions") or []
    sources = row.get("tmlb_dataset_sources") or []
    mine = [r for r in releases if row["slug"].lower() in (a.lower() for a in r.dataset_aliases)
            or row["id"] in r.dataset_aliases]
    mine.sort(key=lambda r: _version_key(r.version))
    # Redistribution follows the catalog version each release was cut from.
    rel_versions = {r.catalog_dataset_version_id or r.dataset_version_id for r in mine}
    governing = [v for v in versions if v.get("id") in rel_versions] or versions
    version = governing[0] if governing else {}
    profile = _first(version.get("tmlb_dataset_profiles"))
    statuses = {v.get("redistribution_status") for v in governing}
    redistribution = statuses.pop() if len(statuses) == 1 else ("mixed" if statuses else None)
    return DatasetInfo(
        id=row["id"],
        slug=row["slug"],
        title=row["title"],
        doi=row.get("concept_doi") or version.get("version_doi"),
        task=profile.get("primary_task_name"),
        task_type=profile.get("primary_task_type"),
        modalities=tuple(profile.get("modalities") or ()),
        license=version.get("license_name"),
        license_url=version.get("license_url"),
        license_source_url=version.get("license_source_url"),
        license_terms=version.get("license_terms"),
        access=version.get("access_status") or (sources[0].get("access_status") if sources else None),
        redistribution=redistribution,
        provider_url=next((s.get("landing_url") for s in sources if s.get("landing_url")), None),
        paper_count=row.get("paper_count"),
        dataset_versions=tuple(v.get("version_label") or v.get("version_key") for v in versions),
        releases=tuple(mine),
    )


def _releases() -> List[ReleaseInfo]:
    payload = _http.get_json(f"{_http.api_base()}/releases", "release registry")
    return [ReleaseInfo.from_api(item) for item in payload.get("items") or []]


def _catalog() -> List[DatasetInfo]:
    rows = _http.supabase("tmlb_datasets", {
        "select": _DATASET_SELECT, "order": "paper_count.desc,title.asc", "limit": "500",
    })
    releases = _releases()
    return [_info(row, releases) for row in rows]


def datasets(task: Optional[str] = None, released: Optional[bool] = None) -> List[DatasetInfo]:
    """List catalog datasets.

    ``task`` matches the task name or type (case-insensitive substring).
    ``released=True`` keeps datasets with an OWL release, ``False`` those without.
    """
    items = _catalog()
    if task:
        needle = task.lower()
        items = [d for d in items if needle in (d.task or "").lower() or needle in (d.task_type or "").lower()]
    if released is not None:
        items = [d for d in items if d.released == released]
    return items


def _norm(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"^(https?://(dx\.)?doi\.org/|doi:)", "", text)
    return text


def _squash(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _resolve(query: str, items: List[DatasetInfo]) -> DatasetInfo:
    q = _norm(query)
    exact = [d for d in items if q in {d.slug.lower(), d.id.lower(), (d.doi or "").lower()}
             or any(q == r.id or q in (a.lower() for a in r.dataset_aliases) for r in d.releases)]
    if not exact:
        exact = [d for d in items if _squash(d.title) == _squash(q)]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise Ambiguous(f"{query!r} matches several datasets: " + ", ".join(d.slug for d in exact))
    hints = [d.slug for d in items if _squash(q) and _squash(q) in _squash(d.title)]
    raise NotFound(f"no dataset matches {query!r}" + (f"; did you mean {', '.join(hints)}?" if hints else ""))


def _api_url(endpoint: str) -> str:
    if endpoint.startswith("/api/v1"):
        return _http.api_base() + endpoint[len("/api/v1"):]
    return endpoint


class Dataset:
    """A catalog dataset. Use :func:`owl_wireless.dataset` to get one."""

    def __init__(self, info: DatasetInfo):
        self.info = info

    def __repr__(self) -> str:
        return f"<owl_wireless.Dataset {self.info.slug} {self.info.title!r}>"

    def papers(self) -> "List[Any]":
        """Papers linked to this dataset, with the claimed result and OWL baseline where they exist."""
        from .papers import papers_for_dataset

        return papers_for_dataset(self.info)

    def _pick(self, version: Optional[str]) -> ReleaseInfo:
        info = self.info
        if not info.releases:
            raise DatasetNotReleased(
                f"{info.title} has no OWL release. Get it from the provider: "
                f"{info.provider_url or 'no provider link recorded'}",
                info.provider_url,
            )
        if version is None:
            return info.releases[-1]
        for release in info.releases:
            if version in (release.id, release.version):
                return release
        raise NotFound(f"{info.title} has no release {version!r}; available: "
                       + ", ".join(f"{r.version} ({r.id})" for r in info.releases))

    def _refuse(self, release: ReleaseInfo) -> DatasetNotReleased:
        info = self.info
        provider = release.provider_url or info.provider_url
        lic = release.license or {}
        how = (f" OWL publishes the split definition: download the provider files, then call "
               f"load(source_dir=...) to build the same split locally."
               if release.file("split_assignment") and release.file("task") else "")
        return DatasetNotReleased(
            f"{info.title}: OWL does not redistribute this dataset (license: "
            f"{lic.get('name') or info.license or 'not recorded'}, redistribution: "
            f"{info.redistribution or 'not recorded'}). Download from the provider: "
            f"{provider or 'no provider link recorded'}.{how}",
            provider,
        )

    def load(self, version: Optional[str] = None,
             source_dir: Optional[Union[str, Path]] = None) -> Split:
        """Get a verified split.

        Mirrored releases are downloaded (or reused from the cache) and checked against the SHA-256
        in the manifest. For datasets OWL may not redistribute, pass ``source_dir`` (the provider
        files you downloaded): their checksums are verified and the same split is built locally.
        """
        release = self._pick(version)
        manifest = ReleaseInfo.from_api(_http.get_json(
            _api_url(f"/api/v1/releases/{release.id}/manifest"), f"manifest for {release.id}"))
        if source_dir is not None:
            return self._build(manifest, Path(source_dir).expanduser())
        if not (manifest.mirrored and self.info.redistribution == "allowed"):
            raise self._refuse(manifest)
        root = _cache.cache_dir() / "releases" / manifest.id
        files: Dict[str, Path] = {}
        media: Dict[str, str] = {}
        for role in _DATA_ROLES:
            entry = manifest.file(role)
            if entry is None:
                raise OWLError(f"release {manifest.id} has no public {role} file")
            files[role] = _cache.download_verified(
                _api_url(entry.download_endpoint), _safe_dest(root, entry.logical_path), entry.sha256, entry.byte_size)
            media[role] = entry.media_type
        return _split(manifest, files, media)

    def _build(self, manifest: ReleaseInfo, source: Path) -> Split:
        assignment, task_entry = manifest.file("split_assignment"), manifest.file("task")
        if assignment is None or task_entry is None:
            raise OWLError(f"release {manifest.id} publishes no split definition to build from")
        if not source.exists():
            raise OWLError(f"source_dir {source} does not exist")
        root = _cache.cache_dir() / "releases" / manifest.id
        assignments = _cache.download_verified(
            _api_url(assignment.download_endpoint), _safe_dest(root, assignment.logical_path),
            assignment.sha256, assignment.byte_size)
        task_path = _cache.download_verified(
            _api_url(task_entry.download_endpoint), _safe_dest(root, "task.json"), task_entry.sha256,
            task_entry.byte_size)
        task = json.loads(task_path.read_text())
        out = root / "built"
        reference = task.get("reference_outputs") or {}
        names = split_builder.OUTPUT_NAMES
        cached = {role: out / names[role] for role in _DATA_ROLES}
        if reference and all(role in reference and _cache.is_verified(cached[role], reference[role]["sha256"])
                             for role in _DATA_ROLES):
            files = cached
        else:
            try:
                result = split_builder.build(task, assignments, source, out)
            except split_builder.BuildError as exc:
                if "SHA-256" in str(exc):
                    raise ChecksumMismatch(str(source), "", "", message=str(exc)) from exc
                raise OWLError(str(exc)) from exc
            files = result["files"]
            differs = [role for role, same in result["matches_reference"].items() if same is False]
            if differs:
                warnings.warn(
                    f"{manifest.id}: built {', '.join(differs)} differ byte-wise from OWL's reference build. "
                    "Sample IDs and split membership come from assignments.csv, so scoring is unaffected.",
                    stacklevel=3,
                )
        return _split(manifest, files, {role: "text/csv" for role in _DATA_ROLES})


def _safe_dest(root: Path, logical_path: str) -> Path:
    dest = root.joinpath(*logical_path.split("/"))
    if root.resolve() not in dest.resolve().parents:
        raise OWLError(f"unsafe path in manifest: {logical_path}")
    return dest


def _split(manifest: ReleaseInfo, files: Dict[str, Path], media: Dict[str, str]) -> Split:
    return Split(
        release_id=manifest.id,
        version=manifest.version,
        target=manifest.target_fields[0] if len(manifest.target_fields) == 1 else None,
        metric=manifest.metric,
        target_fields=list(manifest.target_fields),
        files=files,
        media_types=media,
        expected_test_rows=manifest.counts.get("test"),
    )


def dataset(query: str) -> Dataset:
    """Find a dataset by slug, title, DOI, catalog id or release alias (e.g. ``"ujiindoorloc"``)."""
    return Dataset(_resolve(query, _catalog()))
