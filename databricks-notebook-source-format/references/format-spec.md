# Databricks Source Notebook — Complete Format Reference

Everything beyond the core rules in SKILL.md: the full magic vocabulary, all widget types,
the job-parameter mapping, how to edit existing notebooks, and CLI round-tripping.

## Contents

- [Structural markers](#structural-markers)
- [Magic commands (full list)](#magic-commands-full-list)
- [Widgets (all types)](#widgets-all-types)
- [Parameters from jobs (base_parameters ↔ widgets)](#parameters-from-jobs-base_parameters--widgets)
- [Editing an existing notebook](#editing-an-existing-notebook)
- [CLI export / import](#cli-export--import)
- [Execution model & gotchas](#execution-model--gotchas)

## Structural markers

| Marker | Rule |
|---|---|
| `# Databricks notebook source` | Exact text, **line 1 only**. Its presence is what makes the `.py` render as a notebook. |
| `# COMMAND ----------` | Cell separator: `# COMMAND`, one space, exactly ten dashes. Conventionally a blank line before and after. |
| `# MAGIC <content>` | One line of a non-Python cell (markdown/SQL/shell/etc.). Single space after `MAGIC`. |
| `# MAGIC` | A blank line **inside** a magic cell (e.g. a paragraph break in markdown). |
| `# DBTITLE <n>,<title>` | Cell title, at the top of the cell. `<n>` is the title level, virtually always `1`. Note: **no space** after the comma is required, but `# DBTITLE 1,My title` is the norm. |

A cell is either **all Python** (no `# MAGIC` lines) or **all `# MAGIC`** (a single magic
keyword on the first `# MAGIC` line, everything else `# MAGIC `-prefixed). Never mix them.

## Magic commands (full list)

Each is the first `# MAGIC` line of its cell. Multi-line bodies continue with `# MAGIC `.

- **`%md`** — markdown. Supports `#`..`######` headings, lists, tables, `code`, bold/italic,
  images `![alt](url)`, and links.
- **`%md-sandbox`** — markdown rendered in a sandboxed iframe; use when embedding raw HTML/CSS
  (e.g. an `<img style=...>` or styled block) that plain `%md` would strip.
  ```python
  # MAGIC %md-sandbox
  # MAGIC <img src="https://…/diagram.png" width="40%" style="float:left; padding-right:20px;">
  # MAGIC This diagram shows …
  ```
- **`%sql`** — a SQL cell. Results render as a table. Use `${widget_name}` to inject widget
  values, and `--` for SQL comments.
- **`%sh`** — shell commands on the driver.
  ```python
  # MAGIC %sh
  # MAGIC ls -la /Volumes/main/default/landing
  ```
- **`%pip`** — notebook-scoped library install; put it in an **early cell**, before imports.
  `# MAGIC %pip install dbldatagen faker==25.*` (pin versions for reproducibility).
- **`%run`** — run another notebook inline (its defined names become available here). Accepts
  relative (`./00_setup`), absolute (`/Workspace/Users/.../00_setup`), and `/Repos/...` paths,
  with `$param="value"` arguments. Path has **no** `.py` extension.
  ```python
  # MAGIC %run ./00_setup $mode="Batch" $rows=500000
  ```
- **`%fs`** — DBFS/Volumes filesystem shortcuts: `# MAGIC %fs ls /Volumes/main/default/landing`.
- **`%scala`, `%r`, `%python`** — run one cell in another language. Rare; a `%python` notebook
  is the default so those markers only appear when switching languages in a single cell.
- **`%environment`** — serverless environment declaration (base environment / client version).
  Rare; usually written by the UI, not by hand:
  ```python
  # MAGIC %environment
  # MAGIC "client": "1"
  # MAGIC "base_environment": ""
  ```

## Widgets (all types)

Widgets are the parameter mechanism. Declare once (an early cell), read with `.get()`.

```python
dbutils.widgets.text(name="path", defaultValue="/Volumes/x", label="1. Path")
dbutils.widgets.dropdown(name="mode", defaultValue="batch", choices=["batch", "streaming"], label="2. Mode")
dbutils.widgets.combobox(name="table", defaultValue="customers", choices=["customers", "orders"], label="3. Table")
dbutils.widgets.multiselect(name="regions", defaultValue="BR", choices=["BR", "US", "MX"], label="4. Regions")
```

- **Read:** `dbutils.widgets.get("mode")` → always a **string**; cast as needed
  (`int(...)`, `.split(",")` for multiselect).
- **Ordering** in the UI follows the numeric prefix in `label` (e.g. `"1. …"`, `"2. …"`).
- **Remove:** `dbutils.widgets.remove("mode")` / `dbutils.widgets.removeAll()`.
- Declare widgets **before** the cells that read them; the top-of-notebook widget bar is
  populated when the declaring cell runs.

## Parameters from jobs (base_parameters ↔ widgets)

A `notebook_task` passes `base_parameters` that bind **by name** to the notebook's widgets:

```yaml
notebook_task:
  notebook_path: /Workspace/Repos/org/repo/build_customers   # the .py notebook, no extension
  base_parameters:
    catalog: main            # -> dbutils.widgets.get("catalog")
    mode: batch              # -> dbutils.widgets.get("mode")
```

So a job-driven notebook needs a `dbutils.widgets.*("catalog", ...)` for each parameter it
expects. In `%sql` cells the same value is available as `${catalog}`. For the full job/bundle
setup use the **`databricks-jobs`** and **`databricks-dabs`** skills.

## Editing an existing notebook

- Preserve all existing markers exactly; only touch the cell(s) you're changing.
- To **add a cell**, insert `# COMMAND ----------` (blank line each side) then the cell body.
- To **add markdown/SQL**, remember every line needs the `# MAGIC ` prefix.
- Don't convert a working notebook to a plain script unless asked — dropping the header and
  markers changes how it runs in the workspace.

## CLI export / import

The format round-trips losslessly through the Databricks CLI (auth via `databricks-core`):

```bash
# Pull a workspace notebook down as source-format .py
databricks workspace export /Workspace/Users/me/nb --format SOURCE --file nb.py

# Push a local source-format .py up as a notebook
databricks workspace import /Workspace/Users/me/nb --format SOURCE --language PYTHON --file nb.py
```

`--format SOURCE` is what keeps the `# MAGIC` / `# COMMAND` markers; `--format JUPYTER`
produces `.ipynb` instead.

## Execution model & gotchas

- **Cells run top-to-bottom** and share one Python process, so state (variables, imports,
  `%pip`-installed packages) persists across cells within a run.
- **`%run` vs `import`:** `%run` executes another *notebook* inline and shares its globals;
  `import` pulls in a plain `.py` *module*. Use `%run` for notebooks, `import` for library
  modules on the path.
- **`display(df)`** renders an interactive, paginated table — no import; prefer it over
  `df.show()` for workspace output.
- `spark` and `dbutils` exist only in the workspace runtime; a pure `.py` module that must be
  unit-tested off-cluster should not reference them at import time.
