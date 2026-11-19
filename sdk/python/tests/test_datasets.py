import io
import zipfile
import numpy as np
import pandas as pd
import pytest

import owl_wireless as owl
import owl_wireless._cache
from owl_wireless.data import read_table

from conftest import CIC, CIC_EXPECTED, PROVIDER_FILES, RELEASE, TEST_IDS


def test_datasets_lists_catalog(fake):
    items = owl.datasets()
    assert len(items) == 35
    assert all(isinstance(d, owl.DatasetInfo) for d in items)
    released = owl.datasets(released=True)
    assert {d.title for d in released} >= {"UJIIndoorLoc", "WiSig", "N-BaIoT", "CICIDS2017"}
    assert all(d.released for d in released)
    assert all(not d.released for d in owl.datasets(released=False))
    assert {d.title for d in owl.datasets(task="localization")} >= {"UJIIndoorLoc"}


@pytest.mark.parametrize("query", [
    "ujiindoorloc", "UJIIndoorLoc", "10-24432__c5ms59", "10.24432/C5MS59",
    "https://doi.org/10.24432/c5ms59", "doi:10.24432/c5ms59", RELEASE,
])
def test_dataset_resolves_slug_title_doi_alias(fake, query):
    assert owl.dataset(query).info.slug == "10-24432__c5ms59"


def test_dataset_not_found(fake):
    with pytest.raises(owl.NotFound):
        owl.dataset("no-such-dataset")


def test_info_fields_come_from_catalog(fake):
    info = owl.dataset("ujiindoorloc").info
    assert info.task == "WLAN fingerprint-based indoor localization"
    assert info.license == "CC-BY-4.0"
    assert info.access == "open"
    assert info.redistribution == "allowed"
    assert info.paper_count == 87
    assert info.release_versions == ["telemlebench-v1"]
    assert info.provider_url == "https://archive.ics.uci.edu/dataset/310/ujindoorloc"
    assert info.downloadable
    # Missing values stay None; nothing is filled in.
    assert info.license_url is None


def test_load_downloads_verifies_and_parses(fake):
    split = owl.dataset("ujiindoorloc").load()
    assert split.release_id == RELEASE
    assert split.target == "FLOOR" and split.metric == "accuracy"
    assert isinstance(split.train, pd.DataFrame) and split.train.shape == (20, 4)
    assert split.val.shape == (8, 4)
    assert list(split.test_inputs.columns) == ["sample_id", "WAP001", "WAP002"]
    assert "FLOOR" not in split.test_inputs.columns
    assert list(split.test_sample_ids()) == TEST_IDS
    assert fake.count(r"/files/") == 3
    # Only the three public data roles are fetched; never split assignments or private files.
    assert not any("split_assignment" in c.url or "private" in c.url for c in fake.calls)


def test_load_uses_cache_and_never_redownloads_matching_files(fake):
    owl.dataset("ujiindoorloc").load()
    before = fake.count(r"hf\.owl\.test")
    split = owl.dataset("ujiindoorloc").load()
    assert fake.count(r"hf\.owl\.test") == before
    # A corrupted cache file is detected by its checksum and fetched again.
    split.files["train"].write_text("tampered")
    owl.dataset("ujiindoorloc").load()
    assert fake.count(r"hf\.owl\.test") == before + 1


def test_checksum_mismatch_raises_and_leaves_no_file(fake):
    path, _ = fake.served["train"]
    fake.served["train"] = (path, b"sample_id,FLOOR\nx,1\n")
    with pytest.raises(owl.ChecksumMismatch):
        owl.dataset("ujiindoorloc").load()
    assert list((owl._cache.cache_dir() / "releases").rglob("train.csv*")) == []


def test_load_refuses_when_redistribution_not_allowed(fake):
    with pytest.raises(owl.DatasetNotReleased) as exc:
        owl.dataset("cicids2017").load()
    assert exc.value.provider_url == "https://www.unb.ca/cic/datasets/ids-2017.html"
    assert "redistribution: not_allowed" in str(exc.value) and "source_dir" in str(exc.value)
    assert fake.count(r"/files/") == 0


def test_load_refuses_unreleased_dataset_with_provider_link(fake):
    with pytest.raises(owl.DatasetNotReleased) as exc:
        owl.dataset("5G-NIDD").load()
    assert exc.value.provider_url and exc.value.provider_url in str(exc.value)


def test_unknown_version(fake):
    with pytest.raises(owl.NotFound):
        owl.dataset("ujiindoorloc").load(version="v99")


def test_iq_zip_adapter_concatenates_npz_groups(tmp_path):
    path = tmp_path / "train.zip"
    with zipfile.ZipFile(path, "w") as z:
        for g in range(2):
            buf = io.BytesIO()
            np.savez(buf, iq=np.full((3, 2, 4), g, dtype=np.float32),
                     sample_id=np.array([f"g{g}s{i}" for i in range(3)]), modulation=np.array(["BPSK"] * 3))
            z.writestr(f"groups/{g}.npz", buf.getvalue())
    table = read_table(path, "application/zip")
    assert table["iq"].shape == (6, 2, 4)
    assert list(table["sample_id"][:4]) == ["g0s0", "g0s1", "g0s2", "g1s0"]


# Step 1 status table: after the catalog patch, the client and the site agree on every release.
DOWNLOADABLE = {
    "cicids2017": False, "ciciot2023": False, "n-baiot": True, "radioml-2016-10a": True, "topologybench": True,
    "ujiindoorloc": True, "veremi-extension": True, "veremi": True, "wisig": True,
}


@pytest.mark.parametrize("name,expected", sorted(DOWNLOADABLE.items()))
def test_client_agrees_with_release_distribution(fake, name, expected):
    info = owl.dataset(name).info
    (release,) = info.releases
    assert release.mirrored is expected                    # what the site shows (API distribution)
    assert info.downloadable is expected                   # what load() will do
    assert info.redistribution == ("allowed" if expected else "not_allowed")


def test_before_catalog_patch_the_client_stays_conservative(fake):
    fake.after_sql = False
    assert not owl.dataset("veremi").info.downloadable     # catalog still says "unknown"
    with pytest.raises(owl.DatasetNotReleased):
        owl.dataset("veremi").load()


def test_radioml_release_is_linked_to_its_catalog_version(fake):
    info = owl.dataset("radioml-2016-10a").info
    (release,) = info.releases
    assert release.catalog_dataset_version_id == "dsv_ebcdc40ddf743d67343b2440"
    assert info.license == "CC-BY-NC-SA-4.0" and info.redistribution == "allowed"
    assert "NonCommercial" in release.license["terms"] and "ShareAlike" in release.license["terms"]


def _provider_dir(tmp_path):
    src = tmp_path / "MachineLearningCVE"
    src.mkdir()
    for name, text in PROVIDER_FILES.items():
        (src / name).write_text(text)
    return src


def test_provider_only_load_builds_split_from_provider_files(fake, tmp_path):
    split = owl.dataset("cicids2017").load(source_dir=_provider_dir(tmp_path))
    for role, text in CIC_EXPECTED.items():
        assert split.files[role].read_text() == text
    assert split.target == "Label" and "Label" not in split.test_inputs.columns
    assert list(split.test_sample_ids()) == ["c4", "c5"]
    # The data bytes are never requested from OWL for a provider-only release.
    assert fake.count(rf"{CIC}/files/(train|validation|test_features)") == 0
    # Built files that match OWL's reference hashes are reused without a rebuild.
    (tmp_path / "MachineLearningCVE" / "Monday-WorkingHours.pcap_ISCX.csv").unlink()
    again = owl.dataset("cicids2017").load(source_dir=tmp_path / "MachineLearningCVE")
    assert again.files == split.files


def test_provider_only_load_rejects_wrong_checksum(fake, tmp_path):
    src = _provider_dir(tmp_path)
    (src / "Monday-WorkingHours.pcap_ISCX.csv").write_text("tampered\n")
    with pytest.raises(owl.ChecksumMismatch, match="Monday-WorkingHours"):
        owl.dataset("cicids2017").load(source_dir=src)


def test_provider_only_load_names_missing_files_and_provider(fake, tmp_path):
    with pytest.raises(owl.OWLError, match="unb.ca/cic/datasets/ids-2017"):
        owl.dataset("cicids2017").load(source_dir=tmp_path)
