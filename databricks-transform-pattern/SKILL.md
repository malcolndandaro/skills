---
name: databricks-transform-pattern
description: >-
  Structure PySpark and Spark SQL transformation code on Databricks as small, pure,
  chainable DataFrame-to-DataFrame functions composed with DataFrame.transform() — the
  "transform pattern" — so ETL is modular, reusable, and unit-testable. Use whenever
  writing, reviewing, or refactoring ANY transformation, ETL/ELT, or data-processing
  code on Databricks: batch or Structured Streaming jobs, notebooks, medallion
  (bronze/silver/gold) logic, and Lakeflow Spark Declarative Pipelines (SDP / LDP,
  formerly DLT) built with @dp.table / @dlt.table. Triggers on writing PySpark DataFrame
  transformations, long chained .withColumn / .select / .filter logic, column derivations
  and cleansing, "clean up / modularize / make this pipeline testable", reusable transform
  modules (utils), and unit-testing Spark transformations with pytest. Apply by default to
  transformation code on Databricks even when the user does not name the pattern.
---

# Databricks Transform Pattern

The transform pattern structures Spark ETL as small, single-purpose functions with the
signature `DataFrame -> DataFrame`, composed with the native
[`DataFrame.transform()`](https://spark.apache.org/docs/latest/api/python/reference/pyspark.sql/api/pyspark.sql.DataFrame.transform.html)
method. It turns long, nested `.withColumn().select().filter()` chains into modular,
reusable, unit-testable software — following single-responsibility and DRY.

Apply it by default when producing or reviewing transformation code on Databricks. Skip it
only for genuinely trivial one-line operations (see [When not to use it](#when-not-to-use-it)).

## Core rules

1. **Pure function, one responsibility.** Each transform takes a `DataFrame`, makes one
   logical change, returns a new `DataFrame`. Chain several rather than writing one
   function that does everything.
2. **No side effects inside a transform.** No reads, writes, `display()`, `dbutils`,
   widget lookups, or secret fetches. Those belong in the orchestration layer. This is
   what makes transforms testable. See [Separate I/O from logic](#separate-io-from-logic).
3. **Type hints + docstring on every transform.** `def f(df: DataFrame) -> DataFrame:` with
   a one-line docstring stating what it does.
4. **Compose with `.transform()`.** Chain transforms; parameterize with args/kwargs or
   closures instead of hardcoding.
5. **Prefer built-in column expressions over Python UDFs.** UDFs break Catalyst
   optimization and are slow; reach for `pyspark.sql.functions` first.

## The pattern

```python
from pyspark.sql import DataFrame
from pyspark.sql.functions import col, floor, datediff, current_date

def add_customer_age(df: DataFrame) -> DataFrame:
    """Add an `age` column derived from `birth_date`."""
    return df.withColumn("age", floor(datediff(current_date(), col("birth_date")) / 365.25))

df_customer = df.transform(add_customer_age)
```

## Chaining and parameterization

Chain transforms in one readable pipeline. `DataFrame.transform(func, *args, **kwargs)`
forwards extra arguments to the function (PySpark 3.3+; available on all current Databricks
runtimes), so parameterize instead of hardcoding:

```python
from pyspark.sql.functions import col, when, lit

def add_age_group(df: DataFrame, young_max: int = 25, senior_min: int = 65) -> DataFrame:
    """Bucket `age` into age groups using configurable thresholds."""
    return df.withColumn(
        "age_group",
        when(col("age") < young_max, "young_adult")
        .when(col("age") < senior_min, "adult")
        .otherwise("senior"),
    )

df_customer = (
    df
    .transform(add_customer_age)
    .transform(add_age_group, young_max=21)   # extra kwargs forwarded to the function
)
```

For pipelines assembled at runtime (list of steps from config), compose with
`functools.reduce` — see [references/advanced-patterns.md](references/advanced-patterns.md).

## Organize reusable transforms

Put shared transforms in an importable Python module — not inline in the notebook — so they
can be reused across jobs and tested outside Databricks:

```python
# utils/spark_transform_functions.py  (in a Git folder / repo)
from utils.spark_transform_functions import add_customer_age, add_age_group
```

A ready-to-copy starter module lives in
[`assets/spark_transform_functions.py`](assets/spark_transform_functions.py) (age, age
group, `clean_column_names`, `add_column_prefixes`, and parameterized examples). Copy it
into the project's `utils/` and extend it.

## Separate I/O from logic

Keep reads, writes, widgets, and secrets in the orchestration layer; keep transforms pure.
This is the single most important rule for testability and portability.

```python
# Orchestration (notebook / job entry point) — does I/O
catalog, schema, volume = "malcoln", "blog", "raw_data"
volume_path = f"/Volumes/{catalog}/{schema}/{volume}/"
df = spark.read.option("multiline", True).json(volume_path)

# Pure business logic — testable, no I/O
processed = df.transform(add_customer_age).transform(add_age_group)

# Orchestration — does I/O
processed.write.mode("overwrite").saveAsTable(f"{catalog}.{schema}.customers")
```

Because transforms are stateless and deterministic, the orchestration layer can safely re-run
the whole pipeline **idempotently** — write with `overwrite` mode, or a Delta `MERGE` /
`REPLACE WHERE` for partial updates.

## Where it applies

The same transform functions plug into every execution mode — read
[references/sdp-lakeflow.md](references/sdp-lakeflow.md) before writing pipeline code:

- **Batch** — `df.transform(...)` then `.write.saveAsTable(...)`.
- **Structured Streaming** — Auto Loader `readStream` → `.transform(...)` → `writeStream`.
- **Lakeflow Spark Declarative Pipelines (SDP / LDP, formerly DLT)** — call the same
  transforms inside `@dp.table()` (modern `from pyspark import pipelines as dp`) or legacy
  `@dlt.table()`. For anything beyond calling transforms — pipeline setup, expectations,
  CDC, streaming tables — use the **`databricks-pipelines`** skill.

## Testing

Pure transforms are unit-testable with **pytest** on a local `SparkSession` — no cluster
needed. See [references/testing.md](references/testing.md) for the SparkSession fixture,
DataFrame-equality assertions (`pyspark.testing.assertDataFrameEqual` / `chispa`), handling
non-deterministic functions, and a ready-to-copy
[`assets/test_spark_transform_functions.py`](assets/test_spark_transform_functions.py).

## When not to use it

- **Trivial single-line ops** — don't wrap a lone `.filter()` or rename in a function.
- **Steps that need a second DataFrame** — a join or lookup can't be expressed by the bare
  `df -> df` signature, which passes only one DataFrame. Use a closure that captures the
  other DataFrame, or the extra-args form `df.transform(join_dim, dim_df=...)` — see
  [multi-DataFrame steps](references/advanced-patterns.md#multi-dataframe-steps-joins-and-lookups).
- **Streaming stateful operations** — arbitrary per-key state (`applyInPandasWithState`,
  session windows) doesn't fit the simple wrapper; use the dedicated stateful APIs.
- **It organizes code, it doesn't change physics.** A wide shuffle (aggregation, window,
  join) costs the same inside a transform. Give each heavy shuffle its own named step.
  Aggregations also change the DataFrame's grain and, on streaming sources, require
  `complete` / `update` output mode — see
  [aggregations and windows](references/advanced-patterns.md#aggregations-and-window-functions).

## Review checklist

- [ ] Every transform is `df -> df` (or a callable object) with type hints + docstring.
- [ ] No side effects inside transforms (no read/write/`display`/`dbutils`/secrets).
- [ ] Configuration passed in as arguments, not hardcoded.
- [ ] Transforms live in an importable module, not inline in the notebook.
- [ ] Built-in column expressions preferred over Python UDFs.
- [ ] Pipeline composed via `.transform()` chaining (or `functools.reduce` for dynamic).
- [ ] Each transform has a pytest unit test; at least one end-to-end pipeline test exists.

## References

- [references/testing.md](references/testing.md) — pytest fixtures and DataFrame assertions.
- [references/sdp-lakeflow.md](references/sdp-lakeflow.md) — applying the pattern in SDP /
  Lakeflow pipelines and streaming; modern `@dp` vs legacy `@dlt`.
- [references/advanced-patterns.md](references/advanced-patterns.md) — parameterized and
  dynamic pipelines, stateful transforms, schema validation, performance.
