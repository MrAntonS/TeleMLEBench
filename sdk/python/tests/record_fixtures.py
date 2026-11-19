"""Re-record the JSON fixtures from the live public endpoints.

    python tests/record_fixtures.py

Responses are trimmed (a few papers, a few usage rows) to keep the fixtures small.
Release data files are not recorded; tests generate small files and patch their checksums.
"""
import json
from pathlib import Path

from owl_wireless import _http
from owl_wireless.datasets import _DATASET_SELECT

OUT = Path(__file__).parent / "fixtures"
UJI = "10.24432/c5ms59"
KEEP_PAPERS = ["P31", "P61", "P62", "P59", "P96"]


def save(name, payload):
    (OUT / name).write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n")


def main():
    OUT.mkdir(exist_ok=True)
    save("releases.json", _http.get_json(f"{_http.api_base()}/releases", "releases"))
    save("manifest_ujindoorloc.json",
         _http.get_json(f"{_http.api_base()}/releases/ujindoorloc-floor-v1/manifest", "manifest"))
    save("tmlb_datasets.json", _http.supabase("tmlb_datasets", {
        "select": _DATASET_SELECT, "order": "paper_count.desc,title.asc", "limit": "500"}))
    save("tmlb_dataset_versions_uji.json",
         _http.supabase("tmlb_dataset_versions", {"select": "id", "dataset_id": f"eq.{UJI}"}))
    save("tmlb_dataset_paper_usage_uji.json", _http.supabase("tmlb_dataset_paper_usage", {
        "select": "version_id,tmlb_paper_versions(source_url,tmlb_papers(id,doi,arxiv_id,title,venue,year))",
        "version_id": 'in.("dsv_10089411a0c5dbed537ad731")', "order": "confirmed_at.desc", "limit": "6"}))
    save("tmlb_papers_1711.02824.json", _http.supabase("tmlb_papers", {
        "select": "id,doi,arxiv_id,title,authors,venue,year", "arxiv_id": "eq.1711.02824", "limit": "2"}))
    papers = _http.get_json(f"{_http.site_base()}/data/owl/papers.json", "papers")
    papers["papers"] = {k: papers["papers"][k] for k in KEEP_PAPERS}
    save("papers.json", papers)
    art = OUT / "artifacts" / "P62"
    art.mkdir(parents=True, exist_ok=True)
    for f in papers["papers"]["P62"]["reproduction"]["files"]:
        (art / f["name"]).write_bytes(_http.session().get(f"{_http.site_base()}/{f['path']}").content)


if __name__ == "__main__":
    main()
