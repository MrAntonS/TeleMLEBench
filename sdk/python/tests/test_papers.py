import pytest

import owl_wireless as owl

from conftest import load


def test_paper_metadata_keeps_status_value_source(fake):
    p = owl.paper("P62")
    assert p.title.startswith("A Local Machine Learning Approach")
    md = p.metadata
    assert len(md) == 10
    assert md["architecture"].source == "paper" and md["architecture"].status == "partial"
    # Values the OWL spec took from the authors' code are marked "code", not assumed.
    bs = md["batch_size"]
    assert (bs.source, bs.value, bs.assumed_value) == ("code", "20 (floor-stage CNN)", None)
    assert md["random_seed"].source == "code"
    # Missing stays None.
    assert md["split_seed"].value is None and md["split_seed"].source is None


def test_paper_claim_and_baseline(fake):
    p = owl.paper("P62")
    c = p.claimed
    assert (c.value, c.unit, c.metric) == (95.52, "%", "floor hit rate")
    assert c.location == "Table I, PDF page 5" and c.split.startswith("UJIIndoorLoc validation")
    b = p.baseline
    assert b.score == 90.7291 and b.gap == 4.79
    assert b.validation_rule == "i" and b.validation.startswith("Validated re-run")
    assert (b.agent, b.model) == ("Aider 0.86.2", "Gemma 4 31B")


def test_assumed_values_are_not_promoted_to_paper_values(fake):
    md = owl.paper("P96").metadata
    bs = md["batch_size"]
    assert (bs.source, bs.value, bs.assumed_value, bs.assumed_where) == ("assumed", None, "1024", "reproduce.py line 232")


@pytest.mark.parametrize("query", ["p62", "2302.10810", "2302.10810v1", "arXiv:2302.10810",
                                   "https://arxiv.org/abs/2302.10810v1"])
def test_paper_lookup_forms(fake, query):
    assert owl.paper(query).id == "P62"


def test_not_reproduced(fake):
    p = owl.paper("P31")
    assert p.baseline is None and p.claimed is None
    assert len(p.metadata) == 10
    with pytest.raises(owl.NotReproduced):
        p.artifact


def test_catalog_only_paper_has_no_invented_fields(fake):
    p = owl.paper("1711.02824")
    assert p.catalog_only and p.title.startswith("RCNF")
    assert p.metadata is None and p.claimed is None and p.baseline is None
    with pytest.raises(owl.NotReproduced):
        p.artifact


def test_unknown_paper(fake):
    with pytest.raises(owl.NotFound):
        owl.paper("P999")


def test_artifact_download(fake, tmp_path):
    saved = owl.paper("P62").artifact.download(tmp_path / "p62")
    expected = load("papers.json")["papers"]["P62"]["reproduction"]["files"]
    assert [s.name for s in saved] == [f["name"] for f in expected]
    for s, f in zip(saved, expected):
        assert s.stat().st_size == f["bytes"]


def test_dataset_papers_merge_catalog_and_owl(fake):
    papers = owl.dataset("ujiindoorloc").papers()
    by_id = {p.id: p for p in papers}
    assert by_id["P62"].claimed.value == 95.52 and by_id["P62"].baseline.score == 90.7291
    assert by_id["P61"].baseline is not None
    # Reproduced papers come first; catalog papers without OWL data keep None.
    assert papers[0].baseline is not None
    plain = [p for p in papers if p.id.startswith("paper_")]
    assert plain and all(p.claimed is None and p.baseline is None for p in plain)
    assert len({p.id for p in papers}) == len(papers)
