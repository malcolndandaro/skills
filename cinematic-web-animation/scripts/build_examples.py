#!/usr/bin/env python3
"""Regenerate every example page in assets/examples/ from assets/subjects/*.js and the templates.

    python scripts/build_examples.py

Run it after editing a template (engine change) or a subject file. Titles/headings live in the table below;
a subject without an entry gets a title derived from its file name.
"""
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
SUBJECTS = HERE.parent / "assets" / "subjects"
EXAMPLES = HERE.parent / "assets" / "examples"

META = {
    "galaxy": ("Galaxy", "Deep|Field"),
    "nebula": ("Nebula", "Stellar|Nursery"),
    "flow-field": ("Flow field", "Flow|Field"),
    "fireflies": ("Fireflies", "Summer|Night"),
    "lavender-field": ("Lavender field at dusk", "Lavender|Fields"),
    "lavender-sunflower-field": ("Lavender and sunflowers", "Golden|Hour"),
    "starfield-warp": ("Starfield", "Warp|Drive"),
    "text-morph": ("Text morph", "|"),
    "globe": ("Globe", "Blue|Marble"),
    "black-hole": ("Black hole", "Event|Horizon"),
    "dna-helix": ("DNA helix", "Double|Helix"),
    "snow": ("Snow", "Silent|Night"),
    "ocean-waves": ("Ocean", "Open|Water"),
    "path-trails": ("Attractor trails", "Strange|Attractor"),
    "aurora": ("Aurora", "Aurora"),
    "liquid-gradient": ("Liquid gradient", "Liquid"),
    "smoke-ink": ("Smoke", "Ink"),
}


def main() -> int:
    ok = True
    for js in sorted(SUBJECTS.glob("*.js")):
        name = js.stem
        title, heading = META.get(name, (name.replace("-", " ").title(), name.replace("-", " ").title()))
        cmd = [sys.executable, str(HERE / "compose.py"), name, str(EXAMPLES / f"{name}.html"), "--title", title, "--heading", heading]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            ok = False
            print(f"FAILED {name}: {r.stderr.strip() or r.stdout.strip()}")
        else:
            print(r.stdout.strip())
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
