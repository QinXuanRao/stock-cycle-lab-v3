"""Assemble the offline HTML from inspected source files; no downloads."""
from pathlib import Path
import argparse
import hashlib
import json

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    html = (root / "app.template.html").read_text(encoding="utf-8")
    for marker, filename in (("ENGINE", "engine.js"), ("ADAPTERS", "adapters.js"), ("DEMO", "demo.js"), ("UI", "ui.js")):
        source = (root / filename).read_text(encoding="utf-8")
        if "</script" in source.lower():
            raise ValueError("Unsafe inline script delimiter in source")
        html = html.replace("/*__" + marker + "__*/", source)
    if "/*__" in html:
        raise ValueError("Unresolved build marker")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(html, encoding="utf-8")
    print(json.dumps({"output": str(args.output), "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest()}))

if __name__ == "__main__":
    main()
