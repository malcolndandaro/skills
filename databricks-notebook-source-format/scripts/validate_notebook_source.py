#!/usr/bin/env python3
"""Validate that a .py file is a well-formed Databricks source-format notebook.

Checks the fragile, easy-to-get-wrong parts of the format:
  * the mandatory `# Databricks notebook source` header (line 1)
  * cell separators are exactly `# COMMAND ----------`
  * every MAGIC line is `# MAGIC` or `# MAGIC ` + content (correct spacing)
  * a magic cell (%md, %sql, %sh, %run, %pip, ...) does not mix `# MAGIC`
    lines with raw code lines — the most common generation bug
  * `# DBTITLE` lines are `# DBTITLE <n>,<title>`

Usage:
    validate_notebook_source.py <file.py> [<file2.py> ...]

Exit code 0 if all files are valid, 1 if any file has errors.
Warnings do not affect the exit code.
"""
from __future__ import annotations

import re
import sys

HEADER = "# Databricks notebook source"
SEPARATOR = "# COMMAND ----------"
# `# MAGIC` alone (blank magic line) or `# MAGIC ` followed by content.
MAGIC_RE = re.compile(r"^# MAGIC(?: .*)?$")
# A line that looks like a botched magic prefix we should flag.
BAD_MAGIC_RE = re.compile(r"^\s*#\s?MAGIC")
DBTITLE_RE = re.compile(r"^# DBTITLE \d+,")
MAGIC_KEYWORD_RE = re.compile(r"^# MAGIC %(\w[\w-]*)")


def validate(path: str) -> tuple[list[str], list[str]]:
    """Return (errors, warnings) for one file, each as 'line N: message'."""
    errors: list[str] = []
    warnings: list[str] = []
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError as exc:
        return ([f"cannot read file: {exc}"], [])

    if not lines:
        return (["file is empty (missing the notebook header)"], [])

    # 1. Header must be the very first line.
    if lines[0] != HEADER:
        errors.append(f"line 1: first line must be exactly '{HEADER}', got '{lines[0]}'")

    # 2. Split into cells on the separator line.
    cell_start = 0  # line index where the current cell's body begins
    cells: list[tuple[int, list[str]]] = []  # (1-based start line, body lines)
    body: list[str] = []
    for i, line in enumerate(lines):
        if i == 0:
            continue  # header line
        stripped = line.rstrip()
        # Flag near-miss separators (e.g. wrong dash count) before the exact test.
        if stripped != SEPARATOR and re.match(r"^#\s*COMMAND\s*-+\s*$", stripped):
            errors.append(
                f"line {i + 1}: malformed cell separator '{stripped}' — must be exactly '{SEPARATOR}'"
            )
        if stripped == SEPARATOR:
            cells.append((cell_start + 2, body))
            body = []
            cell_start = i
        else:
            body.append(line)
    cells.append((cell_start + 2, body))

    # 3. Validate each cell.
    for start_line, cell in cells:
        content = [ln for ln in cell if ln.strip()]
        if not content:
            continue

        magic_line_nums = []
        code_line_nums = []
        for offset, ln in enumerate(cell):
            abs_line = start_line + offset
            if not ln.strip():
                continue
            if ln.startswith("# MAGIC") or ln == "# MAGIC":
                if not MAGIC_RE.match(ln):
                    errors.append(
                        f"line {abs_line}: bad MAGIC line — must be '# MAGIC' or '# MAGIC <content>' "
                        f"(note the single space after MAGIC), got '{ln}'"
                    )
                magic_line_nums.append(abs_line)
            elif BAD_MAGIC_RE.match(ln) and not ln.startswith("# MAGIC"):
                errors.append(
                    f"line {abs_line}: malformed MAGIC prefix '{ln.strip()}' — must start with '# MAGIC '"
                )
                magic_line_nums.append(abs_line)
            elif DBTITLE_RE.match(ln):
                continue  # a valid title line, allowed in any cell
            elif ln.lstrip().startswith("# DBTITLE"):
                errors.append(
                    f"line {abs_line}: malformed DBTITLE — must be '# DBTITLE <n>,<title>', got '{ln}'"
                )
            else:
                code_line_nums.append(abs_line)

        # A magic cell must be entirely MAGIC lines (a magic keyword was declared).
        is_magic_cell = any(
            MAGIC_KEYWORD_RE.match(lines[n - 1]) for n in magic_line_nums if 0 < n <= len(lines)
        )
        if is_magic_cell and code_line_nums:
            errors.append(
                f"line {code_line_nums[0]}: raw code line inside a %magic cell — every line of a "
                f"magic cell must be prefixed with '# MAGIC ' (cell starts at line {start_line})"
            )

    return errors, warnings


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2

    any_errors = False
    for path in argv[1:]:
        errors, warnings = validate(path)
        if errors:
            any_errors = True
            print(f"✗ {path}: {len(errors)} error(s)")
            for msg in errors:
                print(f"    ERROR {msg}")
        for msg in warnings:
            print(f"    WARN  {msg}")
        if not errors:
            print(f"✓ {path}: valid Databricks source notebook")

    return 1 if any_errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
