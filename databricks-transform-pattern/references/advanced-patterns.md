# Advanced transform patterns

Techniques beyond the basic chain. Reach for these when transforms need configuration,
runtime assembly, state, or schema guarantees.

## Contents

- [Parameterization: kwargs vs closures](#parameterization-kwargs-vs-closures)
- [Multi-DataFrame steps: joins and lookups](#multi-dataframe-steps-joins-and-lookups)
- [Dynamic pipelines with functools.reduce](#dynamic-pipelines-with-functoolsreduce)
- [Stateful transforms](#stateful-transforms)
- [Aggregations and window functions](#aggregations-and-window-functions)
- [Schema validation at boundaries](#schema-validation-at-boundaries)
- [Performance notes](#performance-notes)

## Parameterization: kwargs vs closures

`DataFrame.transform(func, *args, **kwargs)` forwards extra arguments (PySpark 3.3+), so pass
config as keyword arguments directly. This is the default form used by every function in
`assets/spark_transform_functions.py`:

```python
df.transform(add_age_group, young_max=21, senior_min=60)
df.transform(cast_columns, casts={"amount": "double", "ts": "timestamp"})
```

Use a **closure / factory** when you want to preconfigure a step once and reuse it, or build a
step from config where a direct call site would be awkward:

```python
def scale_column(column: str, factor: float):
    """Return a transform that scales `column` by `factor` (closure over config)."""
    def _transform(df: DataFrame) -> DataFrame:
        return df.withColumn(column, col(column) * lit(factor))
    return _transform

df.transform(scale_column("amount", 1.1))
```

Both keep the transform pure — config comes in as data, never read from `dbutils`/widgets
inside the function.

## Multi-DataFrame steps: joins and lookups

`df.transform(func)` passes exactly one DataFrame, so a join or lookup against a second
DataFrame (a dimension, a reference table) can't use the bare `df -> df` signature. Two clean
adaptations, both chainable and testable:

**Extra-args form** — forward the second DataFrame as a keyword argument:

```python
from pyspark.sql import DataFrame
from pyspark.sql.functions import broadcast

def join_region(df: DataFrame, region_df: DataFrame) -> DataFrame:
    """Enrich with region name from a small dimension (broadcast the lookup)."""
    return df.join(broadcast(region_df), on="region_id", how="left")

df.transform(join_region, region_df=regions)
```

**Closure form** — capture the second DataFrame in a factory when preconfiguring or reusing:

```python
def join_region(region_df: DataFrame):
    def _transform(df: DataFrame) -> DataFrame:
        return df.join(broadcast(region_df), on="region_id", how="left")
    return _transform

df.transform(join_region(regions))
```

Broadcast small dimensions. For large-to-large joins, give the join its own named transform so
its shuffle cost is visible in the query plan. In tests, build both DataFrames inline and
assert the joined result.

## Dynamic pipelines with functools.reduce

When the list of steps is data-driven (from config), compose with `reduce` instead of a
fixed `.transform()` chain:

```python
from functools import reduce
from pyspark.sql import DataFrame

def run_pipeline(df: DataFrame, steps: list) -> DataFrame:
    """Apply a list of df -> df callables in order."""
    return reduce(lambda acc, step: step(acc), steps, df)

steps = [
    clean_column_names,
    lambda d: add_age_group(d, young_max=cfg["young_max"]),
    cast_columns(cfg["casts"]),
]
result = run_pipeline(df, steps)
```

Keep the pipeline *builder* (which reads config) separate from the pure transforms it
assembles, so the transforms stay independently testable.

## Stateful transforms

Prefer pure functions. When a step needs fitted state (a scaler, a lookup, means), wrap it in
a callable object and pass the state in from orchestration — never fetch it inside the
transform:

```python
class CenterAmount:
    def __init__(self, mean: float):
        self.mean = mean
    def __call__(self, df: DataFrame) -> DataFrame:
        return df.withColumn("amount_centered", col("amount") - lit(self.mean))

# orchestration computes/loads the state, then:
df.transform(CenterAmount(mean=computed_mean))
```

The object is still testable: construct it with a known mean and assert the output.

## Aggregations and window functions

A `groupBy().agg()` or window step fits the `df -> df` signature but **changes the grain** of
the DataFrame — each output row now means something different from the input. Give each such
step its own named transform, and be deliberate about ordering it relative to column-level
transforms:

```python
from pyspark.sql.functions import sum as sum_, to_date

def daily_revenue_by_region(df: DataFrame) -> DataFrame:
    """Aggregate order-grain rows to one row per (region, day). Changes the grain."""
    return (
        df.withColumn("order_date", to_date("order_ts"))
        .groupBy("region", "order_date")
        .agg(sum_("amount").alias("revenue"))
    )
```

**Streaming caveat.** On a streaming DataFrame, an aggregating transform requires
`outputMode("complete")` or `outputMode("update")` — not `append` (append works only for
non-aggregating, row-level transforms). Windowed aggregations on streams also need a watermark
(`df.withWatermark("event_ts", "10 minutes")`) to bound state. Arbitrary per-key state
(`applyInPandasWithState`, `mapGroupsWithState`) is outside the transform pattern — use the
dedicated stateful API.

## Schema validation at boundaries

Document each transform's expected input/output columns in its docstring, and validate at
pipeline boundaries (after ingest, before write) rather than inside every transform:

```python
def require_columns(df: DataFrame, required: set[str]) -> DataFrame:
    """Fail fast if expected columns are missing."""
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")
    return df

df.transform(require_columns, {"id", "birth_date"})
```

For raw JSON/CSV ingestion, enforce an explicit schema (`from_json`, `.schema(...)`) at read
time so downstream transforms get stable types. In SDP, prefer `@dp.expect_*` for row-level
data quality (see `databricks-pipelines`).

## Performance notes

The pattern organizes code; it does not change Spark's execution cost. Within transforms:

- **Prefer built-in column expressions over Python UDFs** — UDFs are opaque to Catalyst and
  serialize row-by-row. Use `pyspark.sql.functions`; if a UDF is unavoidable, prefer a
  `pandas_udf` (vectorized).
- **Filter and project early** so predicate/column pushdown reduces data before wide steps.
- **Broadcast small lookups**: `df.join(broadcast(small_df), "key")`.
- **Cache only** when a DataFrame is reused multiple times and recomputation is expensive.
- **Avoid `.collect()` / `.toPandas()` / row-by-row loops** inside transforms.
- Put each wide shuffle (aggregation, window, join) in its own named transform so the cost is
  visible and the step is easy to profile with the query plan.
