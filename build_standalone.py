"""Build the single-file TeleMLEBench artifact from index.html and app.js."""

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent
INDEX = ROOT / "index.html"
APP = ROOT / "app.js"
OUTPUT = ROOT / "TeleMLEBench.standalone.html"


def main() -> None:
    html = INDEX.read_text(encoding="utf-8")
    javascript = APP.read_text(encoding="utf-8")
    external_script = re.compile(
        r'<script\s+src=["\']\./app\.js(?:\?v=[^"\']*)?["\']\s*></script>'
    )
    standalone, replacements = external_script.subn(
        lambda _match: "<script>\n" + javascript + "\n</script>", html, count=1
    )
    if replacements != 1:
        raise RuntimeError("Could not find the app.js script tag in index.html")
    OUTPUT.write_text(standalone, encoding="utf-8", newline="\n")
    print(f"Wrote {OUTPUT.name}")


if __name__ == "__main__":
    main()
