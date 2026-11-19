"""Endpoints and the shared HTTP session.

Every endpoint here is one the OWL website already uses:

* the public Supabase catalog (read-only tables, publishable key from the site's ``config.js``);
* the release / evaluation API on Vercel (``/api/v1``; the site's ``?api=`` override maps to ``OWL_API``);
* the static paper data layer on GitHub Pages (``data/owl/papers.json`` and run artifacts).
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from ._version import __version__
from .errors import NotFound, ServiceError

DEFAULT_API = "https://telemlebench.vercel.app/api/v1"
DEFAULT_SITE = "https://owl.publicvm.com"
DEFAULT_SUPABASE_URL = "https://xyzrtrugifrnwoukrxyj.supabase.co"
# Publishable (client-visible) key; row-level security keeps the catalog read-only.
DEFAULT_SUPABASE_KEY = "sb_publishable_xQ82sy82qEFQ0RYy9ycRhQ_Eu6PBGS0"

TIMEOUT = (10, 60)


def api_base() -> str:
    return os.environ.get("OWL_API", DEFAULT_API).rstrip("/")


def site_base() -> str:
    return os.environ.get("OWL_SITE", DEFAULT_SITE).rstrip("/")


def supabase_url() -> str:
    return os.environ.get("OWL_SUPABASE_URL", DEFAULT_SUPABASE_URL).rstrip("/")


def supabase_key() -> str:
    return os.environ.get("OWL_SUPABASE_KEY", DEFAULT_SUPABASE_KEY)


_session: Optional[requests.Session] = None


def session() -> requests.Session:
    global _session
    if _session is None:
        s = requests.Session()
        retry = Retry(
            total=4,
            backoff_factor=1.0,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET", "HEAD"}),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry)
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        s.headers["User-Agent"] = f"owl-wireless/{__version__}"
        _session = s
    return _session


def set_session(s: Optional[requests.Session]) -> None:
    """Replace the shared session (used by tests)."""
    global _session
    _session = s


def _check(resp: requests.Response, what: str) -> requests.Response:
    if resp.status_code == 404:
        raise NotFound(f"{what}: not found ({resp.url})")
    if not resp.ok:
        raise ServiceError(f"{what} failed with HTTP {resp.status_code}: {resp.text[:300]}")
    return resp


def get_json(url: str, what: str, **kwargs: Any) -> Any:
    resp = _check(session().get(url, timeout=TIMEOUT, headers={"Accept": "application/json"}, **kwargs), what)
    try:
        return resp.json()
    except ValueError as exc:
        raise ServiceError(f"{what} returned invalid JSON") from exc


def supabase(table: str, params: Dict[str, str]) -> List[Dict[str, Any]]:
    """One page of a public catalog table, exactly as the site queries it."""
    resp = session().get(
        f"{supabase_url()}/rest/v1/{table}",
        params=params,
        timeout=TIMEOUT,
        headers={"Accept": "application/json", "apikey": supabase_key()},
    )
    rows = _check(resp, f"catalog table {table}").json()
    if not isinstance(rows, list):
        raise ServiceError(f"catalog table {table} returned {type(rows).__name__}, expected a list")
    return rows


def supabase_all(table: str, params: Dict[str, str], maximum: int = 5000) -> List[Dict[str, Any]]:
    page = 1000
    rows: List[Dict[str, Any]] = []
    while len(rows) < maximum:
        batch = supabase(table, {**params, "limit": str(min(page, maximum - len(rows))), "offset": str(len(rows))})
        rows.extend(batch)
        if len(batch) < page:
            break
    return rows


def in_filter(values: List[str]) -> str:
    return "in.(" + ",".join('"' + str(v).replace('"', "") + '"' for v in values) + ")"
