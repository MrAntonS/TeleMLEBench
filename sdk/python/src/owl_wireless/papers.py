"""Paper pages: reproduction details, claimed results, OWL baselines and run artifacts.

Source: the site's static paper data layer (``<site>/data/owl/papers.json``, built by
``scripts/build-owl-papers.mjs``) plus the catalog tables for dataset-paper links.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from . import _http
from .errors import Ambiguous, NotFound, NotReproduced, OWLError


@dataclass(frozen=True)
class Detail:
    """One of the ten reproduction details, exactly as the paper page shows it."""

    key: str
    label: str
    status: Optional[str]          # full / partial / absent / code / na
    value: Optional[str]
    source: Optional[str]          # paper / code / paper+code / assumed / None
    explanation: Optional[str]
    evidence: Tuple[str, ...]
    assumed_value: Optional[str] = None
    assumed_where: Optional[str] = None


@dataclass(frozen=True)
class Claim:
    value: Optional[float]
    unit: Optional[str]
    metric: Optional[str]
    split: Optional[str]
    location: Optional[str]
    page: Optional[int]
    url: Optional[str]
    dataset: Optional[str]
    description: Optional[str]


@dataclass(frozen=True)
class Baseline:
    """The validated OWL reproduction (agent given the paper and the OWL spec)."""

    score: Optional[float]
    unit: Optional[str]
    metric: Optional[str]
    split: Optional[str]
    gap: Optional[float]
    validation_rule: Optional[str]
    validation: Optional[str]
    agent: Optional[str]
    model: Optional[str]
    model_id: Optional[str]
    condition: Optional[str]
    run: Optional[str]
    agent_reported: Optional[float]
    rerun: Optional[float]
    fidelity: Optional[float]
    finished_at: Optional[str]
    note: Optional[str]


@dataclass(frozen=True)
class ArtifactFile:
    name: str
    label: Optional[str]
    url: str
    bytes: Optional[int]


@dataclass(frozen=True)
class Artifact:
    paper_id: str
    files: Tuple[ArtifactFile, ...]

    def download(self, directory: Union[str, Path] = ".") -> List[Path]:
        """Save reproduce.py, config.yaml, RESULT.json and logs, as listed on the paper page."""
        out = Path(directory)
        out.mkdir(parents=True, exist_ok=True)
        saved = []
        for f in self.files:
            if "/" in f.name or "\\" in f.name or f.name in ("", ".", ".."):
                raise OWLError(f"unsafe artifact file name {f.name!r}")
            resp = _http.session().get(f.url, timeout=_http.TIMEOUT)
            if not resp.ok:
                raise OWLError(f"artifact {f.name} failed with HTTP {resp.status_code}")
            if f.bytes is not None and len(resp.content) != f.bytes:
                raise OWLError(f"artifact {f.name}: expected {f.bytes} bytes, got {len(resp.content)}")
            dest = out / f.name
            dest.write_bytes(resp.content)
            saved.append(dest)
        return saved


@dataclass(frozen=True)
class PaperInfo:
    """A paper linked to a dataset (catalog link and/or OWL paper page)."""

    id: Optional[str]          # OWL paper-page id (e.g. "P62"), else the catalog id
    title: Optional[str]
    year: Optional[int]
    venue: Optional[str]
    doi: Optional[str]
    arxiv_id: Optional[str]
    url: Optional[str]
    claimed: Optional[Claim]
    baseline: Optional[Baseline]


class Paper:
    """An OWL paper page. Use :func:`owl.paper` to get one."""

    def __init__(self, raw: Dict[str, Any], catalog_only: bool = False):
        self._raw = raw
        self.catalog_only = catalog_only
        self.id: str = raw["id"]
        self.title: Optional[str] = raw.get("title")
        self.authors: List[str] = list(raw.get("authors") or [])
        self.year: Optional[int] = raw.get("year")
        self.venue: Optional[str] = raw.get("venue")
        self.doi: Optional[str] = raw.get("doi")
        self.arxiv_id: Optional[str] = raw.get("arxiv_id")
        self.url: Optional[str] = raw.get("url")
        self.pdf_url: Optional[str] = raw.get("pdf_url")
        self.code_url: Optional[str] = raw.get("code_url")
        self.method: Optional[str] = raw.get("method")
        self.experiment: Optional[str] = raw.get("experiment")
        self.dataset: Optional[Dict[str, Any]] = raw.get("dataset")
        fr = raw.get("fully_reported")
        self.fully_reported: Optional[Tuple[int, int]] = (fr["k"], fr["n"]) if fr else None

    def __repr__(self) -> str:
        return f"<owl.Paper {self.id} {self.title!r}>"

    @property
    def metadata(self) -> Optional[Dict[str, Detail]]:
        """The ten reproduction details keyed by name; None if OWL has no disclosure table."""
        if self.catalog_only:
            return None
        return {
            d["key"]: Detail(
                key=d["key"], label=d.get("label"), status=d.get("status"), value=d.get("value"),
                source=d.get("source"), explanation=d.get("explanation"),
                evidence=tuple(d.get("evidence") or ()),
                assumed_value=d.get("assumed_value"), assumed_where=d.get("assumed_where"),
            )
            for d in self._raw.get("details") or []
        }

    @property
    def claimed(self) -> Optional[Claim]:
        return _claim(self._raw.get("claim"))

    @property
    def baseline(self) -> Optional[Baseline]:
        """The OWL baseline, or None if the paper has not been reproduced."""
        return _baseline(self._raw.get("reproduction"))

    @property
    def artifact(self) -> Artifact:
        repro = self._raw.get("reproduction")
        if not repro or not repro.get("files"):
            raise NotReproduced(f"{self.id} has no validated OWL reproduction, so there are no run artifacts")
        site = _http.site_base()
        return Artifact(self.id, tuple(
            ArtifactFile(name=f["name"], label=f.get("label"), url=f"{site}/{f['path'].lstrip('/')}",
                         bytes=f.get("bytes"))
            for f in repro["files"]
        ))


def _claim(c: Optional[Dict[str, Any]]) -> Optional[Claim]:
    if not c:
        return None
    return Claim(value=c.get("value"), unit=c.get("unit"), metric=c.get("metric"), split=c.get("split"),
                 location=c.get("locator"), page=c.get("page"), url=c.get("url"),
                 dataset=c.get("dataset"), description=c.get("description"))


def _baseline(r: Optional[Dict[str, Any]]) -> Optional[Baseline]:
    if not r:
        return None
    v = r.get("validation") or {}
    return Baseline(score=r.get("score"), unit=r.get("unit"), metric=r.get("metric"), split=r.get("split"),
                    gap=r.get("gap"), validation_rule=v.get("rule"), validation=v.get("text"),
                    agent=r.get("harness"), model=r.get("model"), model_id=r.get("model_id"),
                    condition=r.get("condition"), run=r.get("run"), agent_reported=r.get("agent_reported"),
                    rerun=r.get("rerun"), fidelity=r.get("fidelity"), finished_at=r.get("finished_at"),
                    note=r.get("note"))


def _owl_papers() -> Dict[str, Dict[str, Any]]:
    payload = _http.get_json(f"{_http.site_base()}/data/owl/papers.json", "OWL paper data")
    return payload.get("papers") or {}


def _arxiv(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    m = re.search(r"(\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?/\d{7})(v\d+)?", text, re.I)
    return m.group(1).lower() if m else None


def _doi(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    m = re.search(r"10\.\d{4,9}/\S+", text.strip())
    return m.group(0).lower().rstrip(".") if m else None


def paper(query: str) -> Paper:
    """Find a paper page by OWL id (``"P62"``), DOI or arXiv id."""
    q = query.strip()
    owl = _owl_papers()
    by_id = {k.lower(): v for k, v in owl.items()}
    if q.lower() in by_id:
        return Paper(by_id[q.lower()])
    doi, arxiv = _doi(q), (None if _doi(q) else _arxiv(q))
    hits = [p for p in owl.values()
            if (doi and _doi(p.get("doi")) == doi) or (arxiv and _arxiv(p.get("arxiv_id")) == arxiv)]
    if len(hits) > 1:
        raise Ambiguous(f"{query!r} matches several OWL papers: " + ", ".join(p["id"] for p in hits))
    if hits:
        return Paper(hits[0])
    # Not an OWL paper page: fall back to the catalog record (no details, claim or baseline).
    if doi or arxiv:
        rows = _http.supabase("tmlb_papers", {
            "select": "id,doi,arxiv_id,title,authors,venue,year",
            ("doi" if doi else "arxiv_id"): f"eq.{doi or arxiv}", "limit": "2",
        })
        if rows:
            row = dict(rows[0])
            row["url"] = (f"https://doi.org/{row['doi']}" if row.get("doi")
                          else f"https://arxiv.org/abs/{row['arxiv_id']}" if row.get("arxiv_id") else None)
            return Paper(row, catalog_only=True)
    raise NotFound(f"no OWL paper page or catalog paper matches {query!r}")


def papers_for_dataset(info: Any) -> List[PaperInfo]:
    """Catalog dataset-paper links merged with OWL paper pages for the same dataset."""
    versions = _http.supabase("tmlb_dataset_versions", {"select": "id", "dataset_id": f"eq.{info.id}"})
    rows: List[Dict[str, Any]] = []
    if versions:
        rows = _http.supabase_all("tmlb_dataset_paper_usage", {
            "select": "version_id,tmlb_paper_versions(source_url,tmlb_papers(id,doi,arxiv_id,title,venue,year))",
            "version_id": _http.in_filter([v["id"] for v in versions]),
            "order": "confirmed_at.desc",
        })
    owl = [p for p in _owl_papers().values() if (p.get("dataset") or {}).get("slug") == info.slug]
    used_owl = set()
    out: List[PaperInfo] = []
    seen = set()
    for row in rows:
        pv = row.get("tmlb_paper_versions") or {}
        pv = pv[0] if isinstance(pv, list) and pv else pv
        p = pv.get("tmlb_papers") or {}
        p = p[0] if isinstance(p, list) and p else p
        if not p.get("id") or p["id"] in seen:
            continue
        seen.add(p["id"])
        match = next((o for o in owl if (_doi(o.get("doi")) and _doi(o.get("doi")) == _doi(p.get("doi")))
                      or (_arxiv(o.get("arxiv_id")) and _arxiv(o.get("arxiv_id")) == _arxiv(p.get("arxiv_id")))),
                     None)
        if match:
            used_owl.add(match["id"])
        url = pv.get("source_url") or (f"https://doi.org/{p['doi']}" if p.get("doi") else
                                       f"https://arxiv.org/abs/{p['arxiv_id']}" if p.get("arxiv_id") else None)
        out.append(PaperInfo(
            id=match["id"] if match else p["id"], title=p.get("title"), year=p.get("year"),
            venue=p.get("venue"), doi=p.get("doi"), arxiv_id=p.get("arxiv_id"), url=url,
            claimed=_claim(match.get("claim")) if match else None,
            baseline=_baseline(match.get("reproduction")) if match else None,
        ))
    for o in owl:
        if o["id"] not in used_owl:
            out.append(PaperInfo(id=o["id"], title=o.get("title"), year=o.get("year"), venue=o.get("venue"),
                                 doi=o.get("doi"), arxiv_id=o.get("arxiv_id"), url=o.get("url"),
                                 claimed=_claim(o.get("claim")), baseline=_baseline(o.get("reproduction"))))
    out.sort(key=lambda p: (p.baseline is None, p.claimed is None))
    return out
