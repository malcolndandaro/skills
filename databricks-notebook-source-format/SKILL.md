---
name: databricks-notebook-source-format
description: >-
  Author Databricks code that runs IN the workspace as source-format notebooks — plain
  `.py` files whose first line is `# Databricks notebook source` and whose cells, markdown,
  SQL, and %magics use `# COMMAND ----------` and `# MAGIC` comment markers — instead of
  ordinary Python scripts. Apply BY DEFAULT whenever writing, generating, or editing code
  meant to run in a Databricks workspace: notebooks, `notebook_task` jobs/workflows,
  interactive PySpark or Spark SQL, exploration/demo/repro code, medallion (bronze/silver/
  gold) logic, and streaming experiments. Triggers on "write/create a Databricks notebook",
  "notebook to do X", "a job that runs this", generating cells or `spark`/`dbutils`/
  `display()` code, or producing `.py` files destined for a Databricks workspace or a DAB.
  Use plain `.py` scripts (with `spark_python_task` / `python_wheel_task`) ONLY when the
  user explicitly asks for them; imported helper/library modules also stay plain `.py`.
---

# Databricks Notebook Source Format

Databricks renders a plain `.py` file as a notebook when its first line is
`# Databricks notebook source`. Cells, markdown, SQL, and `%magic` commands are encoded as
special comments, so the file is a normal Python file on disk (Git-friendly, diffable,
importable into the workspace) **and** a rich notebook in the Databricks UI. This is the
default authoring format for anything that runs in the workspace.

## When to use notebook format (default) vs plain `.py`

**Author as a source-format notebook by default** — the runnable artifact that a person or
a job executes in the workspace:

- Notebooks and exploration / demo / repro code.
- Jobs run as a `notebook_task` (the default job task type here).
- Interactive PySpark or Spark SQL, medallion logic, streaming experiments.

**Use a plain `.py` file (no notebook markers) only when:**

- The user **explicitly asks** for a plain script / `spark_python_task` / Python wheel
  (`python_wheel_task`), a `main.py` entry point, or a module run outside the workspace.
- The file is an **imported helper / library / transform module** (e.g. a `utils/` module,
  a DLT/pipeline transformations module, `__init__.py`). Notebooks `import` these or pull
  them in with `%run`; the module itself is plain Python. Keep pure, testable transforms in
  such modules — see the **`databricks-transform-pattern`** skill — and keep the notebook as
  the thin orchestration layer that does the I/O and calls them.

When unsure, default to the notebook format. Do not silently emit a plain `.py` script for
workspace code.

## The format (exact syntax — this is fragile, get it exact)

1. **Header — line 1, exactly:**
   ```python
   # Databricks notebook source
   ```
2. **Cell separator — exactly `# COMMAND` + one space + ten dashes,** with a blank line
   before and after:
   ```python

   # COMMAND ----------

   ```
3. **Python cell** — just write normal Python. `spark`, `dbutils`, and `display()` are
   pre-initialized globals; no `SparkSession.builder`, no imports for them.
   ```python
   df = spark.read.table("main.default.customers")
   display(df)
   ```
4. **Cell title** (optional) — `# DBTITLE <n>,<title>` on its own line at the **top** of the
   cell, before its content. `<n>` is almost always `1`:
   ```python
   # DBTITLE 1,Read customers
   df = spark.read.table("main.default.customers")
   ```
5. **Markdown cell** — `# MAGIC %md`, then every content line prefixed with `# MAGIC ` (note
   the single space). A blank line inside the markdown is `# MAGIC` **alone** (no trailing
   space needed):
   ```python
   # MAGIC %md
   # MAGIC ## Section title
   # MAGIC
   # MAGIC Prose, **bold**, `code`, [links](https://docs.databricks.com), and
   # MAGIC - bullet lists
   ```
6. **SQL cell** — `# MAGIC %sql`, then every SQL line prefixed with `# MAGIC `:
   ```python
   # MAGIC %sql
   # MAGIC SELECT count(*) FROM main.default.customers
   # MAGIC WHERE country = 'BR'
   ```
7. **Other magics** — same rule, one keyword line then `# MAGIC `-prefixed lines:
   ```python
   # MAGIC %run ./00_setup $mode="Batch" $rows=500000
   ```
   ```python
   # MAGIC %pip install dbldatagen faker
   ```
   ```python
   # MAGIC %sh
   # MAGIC ls /Volumes/main/default/landing
   ```

### The rule that catches most mistakes

**A magic cell is 100% `# MAGIC` lines.** Never mix a `# MAGIC %sql` / `%md` / `%sh` line
with raw, unprefixed code below it — every line of that cell must start with `# MAGIC `. Raw
Python belongs only in a plain Python cell (which has no `# MAGIC` lines at all).

## Parameters — use widgets

Declare parameters as widgets so the notebook is reusable and drivable from a job. `spark`
and `dbutils` are already available.

```python
dbutils.widgets.text(name="catalog", defaultValue="main", label="1. Catalog")
dbutils.widgets.dropdown(name="mode", defaultValue="batch", choices=["batch", "streaming"], label="2. Mode")

catalog = dbutils.widgets.get("catalog")
mode = dbutils.widgets.get("mode")          # widgets are strings; cast, e.g. int(...)
```

A job's `notebook_task.base_parameters` map by name onto these widgets. In a `%sql` cell,
reference a widget with `${widget_name}`. Widget types and edge cases:
[references/format-spec.md](references/format-spec.md).

## Typical notebook structure

Follow the ordering seen across the codebase (skip cells that don't apply):

1. `# Databricks notebook source`
2. Title / summary **markdown** cell (`# MAGIC %md` + `#`/`##` heading).
3. **Widgets** cell, then a cell that reads them with `dbutils.widgets.get(...)`.
4. **Imports** and any `spark.conf.set(...)`.
5. **Logic** — read → transform → write. Give heavy steps their own titled cells.
6. **Verify** — a `%sql` count / `display(...)` sanity check.

Start from [assets/notebook_template.py](assets/notebook_template.py) — a ready-to-copy
skeleton with all of the above.

## Jobs, bundles, and deployment

Jobs here run notebooks via `notebook_task`, not `spark_python_task`:

```yaml
tasks:
  - task_key: build_customers
    notebook_task:
      notebook_path: /Workspace/.../build_customers   # points at the .py notebook (no extension)
      base_parameters:
        catalog: ${var.catalog}                        # -> the notebook's `catalog` widget
```

For bundle/job wiring, deploying, or importing the file into a workspace, use the
**`databricks-dabs`** and **`databricks-jobs`** skills (and `databricks-core` for CLI/auth).
The Databricks CLI round-trips this exact format:
`databricks workspace export/import ... --format SOURCE`.

## Validate before handing off

After generating or editing a notebook, run the validator to catch header, separator,
`# MAGIC ` spacing, and mixed magic/code-cell mistakes:

```bash
scripts/validate_notebook_source.py path/to/notebook.py
```

## Checklist

- [ ] First line is exactly `# Databricks notebook source`.
- [ ] Cells separated by exactly `# COMMAND ----------` (blank line each side).
- [ ] Every magic/markdown line is `# MAGIC` or `# MAGIC ` + content; no `# MAGIC%md`.
- [ ] No magic cell mixes `# MAGIC` lines with raw code lines.
- [ ] `# DBTITLE <n>,<title>` sits at the top of its cell.
- [ ] Parameters are widgets; no `SparkSession` creation or `spark`/`dbutils` imports.
- [ ] Imported helper/transform modules are plain `.py` (this is the only non-explicit `.py`).
- [ ] `scripts/validate_notebook_source.py` passes.

## References

- [references/format-spec.md](references/format-spec.md) — complete magic vocabulary
  (all widget types, `%md-sandbox`, `%fs`, `%scala`/`%r`, `%environment`), the
  `base_parameters`↔widgets mapping, editing existing notebooks, and CLI export/import.
