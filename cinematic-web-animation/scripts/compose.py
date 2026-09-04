#!/usr/bin/env python3
"""Compose a standalone HTML scene from a template and a subject file.

    python scripts/compose.py <subject> <out.html> [--title "Text"] [--heading "Left|Right"]

<subject> is a name in assets/subjects/ (e.g. "lavender-field") or a path to a .js file.
The subject file's first line declares which template it targets:
    // @template full      -> assets/template-full.html   (particles + optional field + post-processing)
    // @template field     -> assets/template-field.html  (one fullscreen fragment shader)
    // @template minimal   -> assets/template-minimal.html (particles, no post)
Everything between the SUBJECT BLOCK START/END markers in the template is replaced by the file's contents.
"""
import argparse
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
ASSETS = HERE.parent / "assets"
START = "/* ===== SUBJECT BLOCK START"
END = "/* ===== SUBJECT BLOCK END ===== */"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("subject")
    ap.add_argument("out")
    ap.add_argument("--title", help="<title> of the page")
    ap.add_argument("--heading", help='Foreground heading. For the full template use "Left|Right" for the two words.')
    args = ap.parse_args()

    subject_path = pathlib.Path(args.subject)
    if not subject_path.exists():
        subject_path = ASSETS / "subjects" / f"{args.subject}.js"
    if not subject_path.exists():
        sys.exit(f"subject not found: {args.subject}")
    subject = subject_path.read_text(encoding="utf-8")

    m = re.match(r"\s*//\s*@template\s+(\w+)", subject)
    template_name = m.group(1) if m else "full"
    template_path = ASSETS / f"template-{template_name}.html"
    if not template_path.exists():
        sys.exit(f"unknown template '{template_name}' (expected full, field or minimal)")
    html = template_path.read_text(encoding="utf-8")

    a = html.find(START)
    b = html.find(END)
    if a < 0 or b < 0:
        sys.exit(f"markers not found in {template_path.name}")
    b_end = b + len(END)
    body = subject.strip("\n")
    html = html[:a] + "/* ===== SUBJECT BLOCK START ===== */\n" + body + "\n" + END + html[b_end:]

    if args.title:
        html = re.sub(r"<title>.*?</title>", f"<title>{args.title}</title>", html, count=1)
    if args.heading:
        if template_name == "full":
            left, _, right = args.heading.partition("|")
            html = html.replace("<h1>Title</h1><h1>Here</h1>", f"<h1>{left}</h1><h1>{right or ''}</h1>")
        elif template_name == "minimal":
            left, _, right = args.heading.partition("|")
            html = html.replace("<span>Title</span><span>Here</span>", f"<span>{left}</span><span>{right or ''}</span>")
        else:
            html = re.sub(r'<div class="caption">.*?</div>', f'<div class="caption">{args.heading}</div>', html, count=1)

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out} ({template_name} template + {subject_path.name})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
