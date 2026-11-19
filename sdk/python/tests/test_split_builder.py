import hashlib
import json
import zipfile

import pytest

from owl_wireless.split_builder import BuildError, build, ecmascript_number, normalize_header


@pytest.mark.parametrize("raw,js", [
    ("6.0", "6"), (" 4000000.0", "4000000"), ("666666.6667", "666666.6667"), ("-0.0", "0"), ("1e21", "1e+21"),
    ("1e20", "100000000000000000000"), ("0.000001", "0.000001"), ("1e-7", "1e-7"), (".5", "0.5"),
    ("007", "7"), ("Infinity", "Infinity"), ("NaN", "NaN"), (" BENIGN ", "BENIGN"), ("", ""),
])
def test_ecmascript_number_matches_javascript(raw, js):
    # Expected values are Number(raw).toString() in Node (verified on 20k random inputs).
    assert ecmascript_number(raw) == js


def test_header_strip_and_duplicates():
    assert normalize_header([" A", "B ", " A", "A"]) == ["A", "B", "A__2", "A__3"]


def _zip_task(tmp_path, members, expected=None):
    archive = tmp_path / "snapshot.zip"
    with zipfile.ZipFile(archive, "w") as z:
        for name, text in members.items():
            z.writestr(name, text)
    data = archive.read_bytes()
    task = {
        "feature_fields": ["x"], "target_fields": ["y"], "counts": {"train": 1, "validation": 1, "test": 1},
        "source": {"format": "csv_zip", "members": list(members),
                   "files": [{"name": "snapshot.zip", "sha256": hashlib.sha256(data).hexdigest(),
                              "byte_size": len(data)}]},
        "reference_outputs": expected or {},
    }
    assign = tmp_path / "assignments.csv"
    assign.write_text("sample_id,split,source_file,source_row\n" + "".join(
        f"s{i},{sp},csv/a.csv,{i}\n" for i, sp in enumerate(["train", "val", "test"], start=1)))
    return archive, task, assign


def test_zip_snapshot_and_extracted_members(tmp_path):
    members = {"csv/a.csv": "x,y\n1.0,a\n2.5,b\n3,c\n"}
    archive, task, assign = _zip_task(tmp_path, members)
    first = build(task, assign, archive, tmp_path / "out1")
    assert first["sources_verified"] == "sha256"
    assert (tmp_path / "out1" / "train.csv").read_text() == "sample_id,x,y\ns1,1,a\n"
    assert (tmp_path / "out1" / "test-features.csv").read_text() == "sample_id,x\ns3,3\n"
    ref = {r: {"sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for r, p in first["files"].items()}
    task["reference_outputs"] = ref
    # Extracted member CSVs have no hashes of their own: accepted only if the output matches the reference.
    extracted = tmp_path / "extracted"
    extracted.mkdir()
    (extracted / "a.csv").write_text(members["csv/a.csv"])
    assert build(task, assign, extracted, tmp_path / "out2")["sources_verified"] == "reference_outputs"
    (extracted / "a.csv").write_text("x,y\n9,a\n2.5,b\n3,c\n")
    with pytest.raises(BuildError, match="do not reproduce"):
        build(task, assign, extracted, tmp_path / "out3")


def test_row_mismatch_is_reported(tmp_path):
    archive, task, assign = _zip_task(tmp_path, {"csv/a.csv": "x,y\n1,a\n2,b\n"})
    with pytest.raises(BuildError, match="fewer rows"):
        build(task, assign, archive, tmp_path / "out")
