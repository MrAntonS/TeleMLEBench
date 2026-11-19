"""``owl`` command line: the same four functions as the Python API."""
from __future__ import annotations

import argparse
import dataclasses
import json
import sys
from typing import Any, List, Optional

from . import __version__
from .datasets import dataset, datasets
from .errors import OWLError
from .papers import paper
from .scoring import score


def _dump(obj: Any) -> None:
    def default(o: Any) -> Any:
        if dataclasses.is_dataclass(o):
            return dataclasses.asdict(o)
        return str(o)

    print(json.dumps(obj, indent=2, default=default))


def _na(value: Any) -> str:
    return "-" if value is None else str(value)


def cmd_datasets(args: argparse.Namespace) -> None:
    items = datasets(task=args.task, released=True if args.released else None)
    if args.json:
        return _dump([dataclasses.asdict(d) | {"downloadable": d.downloadable} for d in items])
    print(f"{'SLUG':<44} {'TITLE':<34} {'PAPERS':>6}  {'RELEASE':<16} TASK")
    for d in items:
        rel = ("download" if d.downloadable else "provider-only") if d.released else "-"
        print(f"{d.slug[:44]:<44} {d.title[:34]:<34} {_na(d.paper_count):>6}  {rel:<16} {_na(d.task)}")


def cmd_get(args: argparse.Namespace) -> None:
    split = dataset(args.dataset).load(version=args.version, source_dir=args.source_dir)
    if args.json:
        return _dump({"release_id": split.release_id, "version": split.version, "target": split.target,
                      "metric": split.metric, "files": {k: str(v) for k, v in split.files.items()}})
    print(f"{split.release_id} ({split.version})  target={_na(split.target)}  metric={_na(split.metric)}")
    for role, path in split.files.items():
        print(f"  {role:<14} {path}")


def cmd_paper(args: argparse.Namespace) -> None:
    p = paper(args.paper)
    if args.download:
        for path in p.artifact.download(args.download):
            print(path)
        return
    if args.json:
        return _dump({"id": p.id, "title": p.title, "doi": p.doi, "arxiv_id": p.arxiv_id, "url": p.url,
                      "metadata": p.metadata, "claimed": p.claimed, "baseline": p.baseline})
    print(f"{p.id}  {p.title}")
    print(f"  {', '.join(p.authors)} ({_na(p.year)}) {_na(p.url)}")
    if p.metadata is not None:
        print("  Reproduction details:")
        for d in p.metadata.values():
            value = d.value if d.value is not None else (f"[assumed] {d.assumed_value}" if d.assumed_value else None)
            print(f"    {d.label:<20} {_na(d.status):<8} {_na(d.source):<8} {_na(value)}")
    c = p.claimed
    print(f"  Claimed: {c.value}{c.unit or ''} {c.metric} on {_na(c.split)} ({_na(c.location)})" if c
          else "  Claimed: -")
    b = p.baseline
    print(f"  OWL baseline: {b.score}{b.unit or ''} {b.metric}, gap {_na(b.gap)}, rule {_na(b.validation_rule)}, "
          f"{b.agent} + {b.model}" if b else "  OWL baseline: not reproduced")


def cmd_score(args: argparse.Namespace) -> None:
    result = score(args.predictions, dataset=args.dataset, version=args.version)
    if args.json:
        return _dump(result)
    print(f"{result.release_id}: {result.metric} = {result.value:.6f} "
          f"({_na(result.correct)}/{_na(result.sample_count)})  [private result, not published]")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="owl", description="OWL (Open Wireless Learning) client")
    parser.add_argument("--version", action="version", version=f"owl-wireless {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("datasets", help="list catalog datasets")
    p.add_argument("--task", help="filter by task name or type")
    p.add_argument("--released", action="store_true", help="only datasets with an OWL release")
    p.set_defaults(func=cmd_datasets)

    p = sub.add_parser("get", help="download and verify a dataset release")
    p.add_argument("dataset", help="slug, title or DOI")
    p.add_argument("--version", help="release id or version (default: latest)")
    p.add_argument("--source-dir", help="provider files you downloaded (for datasets OWL does not redistribute)")
    p.set_defaults(func=cmd_get)

    p = sub.add_parser("paper", help="show a paper page")
    p.add_argument("paper", help="OWL id (P62), DOI or arXiv id")
    p.add_argument("--download", metavar="DIR", help="save the run artifacts to DIR")
    p.set_defaults(func=cmd_paper)

    p = sub.add_parser("score", help="score predictions on hidden labels (needs OWL_TOKEN)")
    p.add_argument("predictions", help="CSV or CSV.GZ with sample_id,prediction")
    p.add_argument("--dataset", required=True)
    p.add_argument("--version")
    p.set_defaults(func=cmd_score)

    for p in sub.choices.values():
        p.add_argument("--json", action="store_true", help="machine-readable output")

    args = parser.parse_args(argv)
    try:
        args.func(args)
    except OWLError as exc:
        print(f"owl: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
