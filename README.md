# skills

A collection of custom skills for [Claude Code](https://claude.com/claude-code). Each top-level folder is one skill:
a `SKILL.md` with instructions plus bundled `assets/`, `references/` and `scripts/`.

These are just the ones I keep here. My actual setup pulls skills from several sources —
[Databricks Agent Skills](https://github.com/databricks/databricks-agent-skills),
[Anthropic's skills](https://github.com/anthropics/skills), some of
[Matt Pocock's skills](https://github.com/mattpocock/skills), and some personal/private ones
that don't make sense to share — and I use those together with the skills in this repo to
complement my workflow.

| Skill | What it does |
|---|---|
| [`cinematic-web-animation/`](cinematic-web-animation/) | Builds cinematic, GPU-driven web animations and generative art scenes as zero-dependency single-file WebGL2 (galaxies, nebulae, auroras, flow fields, fireflies, flower fields, oceans, globes, text morphs, black holes…) with HDR bloom, film grain, pointer/scroll interaction, a propagated intro and `prefers-reduced-motion` built in. |
| [`databricks-transform-pattern/`](databricks-transform-pattern/) | Structures PySpark / Spark SQL ETL on Databricks as small, pure, chainable `DataFrame`-to-`DataFrame` functions composed with `DataFrame.transform()` — modular, reusable, and unit-testable. Covers batch, Structured Streaming, and Lakeflow Spark Declarative Pipelines (SDP, formerly DLT), with pytest guidance and copy-ready transform + test templates. |
| [`databricks-notebook-source-format/`](databricks-notebook-source-format/) | Authors Databricks code that runs in the workspace as source-format notebooks — plain `.py` files with `# Databricks notebook source`, `# COMMAND ----------`, and `# MAGIC` markers — by default, instead of ordinary scripts. Plain `.py` (and `spark_python_task` / wheels) only when explicitly asked; imported helper modules stay plain `.py`. Includes the exact format spec, a copy-ready notebook template, and a validator. Pairs with `databricks-transform-pattern` (notebook = orchestration, transforms = imported module). |

## Installing a skill

Copy the skill folder into your Claude Code skills directory:

```bash
# user-wide
git clone https://github.com/malcolndandaro/skills.git
cp -r skills/cinematic-web-animation ~/.claude/skills/

# or per project
cp -r skills/cinematic-web-animation <your-project>/.claude/skills/
```

Then ask Claude for "an animated hero background like the OpenAI galaxy", "a lavender field at sunset", "particles that
form our logo", and so on. The skill triggers on its own; you can also invoke it explicitly with `/cinematic-web-animation`.

## cinematic-web-animation at a glance

- `assets/template-full.html` — the engine: particles + optional background field + bloom pyramid + ACES composite +
  interaction + accessibility, ~10 KB, no dependencies. The subject (what is drawn) is a small pluggable block.
- `assets/subjects/*.js` — 17 drop-in subjects; `assets/examples/*.html` — each composed into a ready-to-open page
  (`assets/examples/index.html` is a gallery).
- `scripts/compose.py <subject> out.html` — template + subject → page; `scripts/build_examples.py` rebuilds all examples.
- `references/` — subject catalog, shader cookbook, interaction patterns, framework integration, performance and
  accessibility checklist, and console recipes for auditing any site's animation stack.

To browse the examples locally:

```bash
cd skills/cinematic-web-animation && python -m http.server 8765
# open http://localhost:8765/assets/examples/
```

## databricks-transform-pattern at a glance

- `SKILL.md` — core rules (pure `df -> df`, one responsibility, no side effects, separate I/O
  from logic), the pattern, chaining and parameterization, a review checklist, and pointers to
  the references. Triggers by default on any Databricks transformation / pipeline / SDP / ETL work.
- `references/testing.md` — pytest on a local SparkSession: fixture, `assertDataFrameEqual` /
  `chispa`, and making non-deterministic transforms testable.
- `references/sdp-lakeflow.md` — applying the pattern in Structured Streaming and Lakeflow SDP;
  modern `@dp` vs legacy `@dlt`, and the bronze/silver/gold mapping.
- `references/advanced-patterns.md` — kwargs vs closures, multi-DataFrame joins, dynamic
  pipelines with `functools.reduce`, stateful transforms, aggregations/windows, and performance.
- `assets/spark_transform_functions.py` + `assets/test_spark_transform_functions.py` — a
  ready-to-copy `utils/` transform module and its matching pytest suite.

Then ask Claude to "clean up / modularize this Spark pipeline", "make these transformations
testable", or just write PySpark ETL — the skill triggers on its own, or invoke it explicitly
with `/databricks-transform-pattern`.

## databricks-notebook-source-format at a glance

- `SKILL.md` — the decision rule (notebook by default vs plain `.py` only when explicitly
  asked), the exact source-notebook syntax (header, `# COMMAND ----------`, `# MAGIC` markdown /
  SQL / `%run` / `%pip`, `# DBTITLE`, widgets), the "a magic cell is 100% `# MAGIC` lines" rule
  that catches most mistakes, structure conventions, `notebook_task` wiring, and a checklist.
- `references/format-spec.md` — the complete magic vocabulary (`%md-sandbox`, `%fs`, `%sh`,
  `%scala`/`%r`, `%environment`), all widget types, the `base_parameters` ↔ widgets mapping,
  editing existing notebooks, and CLI `export`/`import --format SOURCE`.
- `assets/notebook_template.py` — a ready-to-copy source-format notebook skeleton.
- `scripts/validate_notebook_source.py` — lints a `.py` notebook for header, separator,
  `# MAGIC ` spacing, and mixed magic/code-cell mistakes.

Then just ask Claude to "write a notebook that…" or "a job that runs this" — the skill triggers
on its own, or invoke it explicitly with `/databricks-notebook-source-format`.
