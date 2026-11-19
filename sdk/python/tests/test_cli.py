import json

from owl_wireless.cli import main


def test_cli_datasets(fake, capsys):
    assert main(["datasets", "--released"]) == 0
    out = capsys.readouterr().out
    assert "UJIIndoorLoc" in out and "download" in out and "provider-only" in out


def test_cli_get(fake, capsys):
    assert main(["get", "ujiindoorloc", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["target"] == "FLOOR" and set(data["files"]) == {"train", "validation", "test_features"}


def test_cli_paper(fake, capsys, tmp_path):
    assert main(["paper", "P62"]) == 0
    out = capsys.readouterr().out
    assert "95.52" in out and "89.829" in out and "assumed" in out
    assert main(["paper", "P62", "--download", str(tmp_path)]) == 0
    assert (tmp_path / "reproduce.py").exists()


def test_cli_errors_are_clean(fake, capsys):
    assert main(["get", "cicids2017"]) == 1
    assert "provider" in capsys.readouterr().err
    assert main(["score", "x.csv", "--dataset", "ujiindoorloc"]) == 1
    assert "OWL_TOKEN" in capsys.readouterr().err
