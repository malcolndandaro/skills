# Applying the transform pattern in streaming and SDP / Lakeflow

The same pure `DataFrame -> DataFrame` transforms plug into batch, Structured Streaming, and
Lakeflow Spark Declarative Pipelines unchanged. Define transforms once in a shared module;
call them everywhere.

> For anything beyond *calling transforms* inside a pipeline — pipeline configuration,
> expectations, Auto CDC / SCD, streaming tables, append flows, DABs deployment — use the
> **`databricks-pipelines`** skill. This file only covers how the transform pattern sits
> inside those pipelines.

## Contents

- [Naming: SDP / LDP / DLT](#naming-sdp--ldp--dlt)
- [Structured Streaming](#structured-streaming)
- [Modern SDP (`@dp`)](#modern-sdp-dp)
- [Legacy DLT (`@dlt`)](#legacy-dlt-dlt)
- [Medallion layering](#medallion-layering)

## Naming: SDP / LDP / DLT

**SDP = LDP = Lakeflow (Spark) Declarative Pipelines = (formerly) Delta Live Tables / DLT.**
All refer to the same product. The modern Python API is `from pyspark import pipelines as dp`
with `@dp.table()`. Older code uses `import dlt` with `@dlt.table()`; the decorator names
otherwise match. Write new code with `@dp`; recognize `@dlt` in existing code.

## Structured Streaming

Auto Loader in, transforms in the middle, `writeStream` out. The transforms are identical to
batch:

```python
from utils.spark_transform_functions import add_customer_age, add_age_group

df = (
    spark.readStream.format("cloudFiles")
    .option("cloudFiles.format", "json")
    .option("cloudFiles.schemaLocation", f"{volume_path}/schema")
    .load(volume_path)
)

processed = df.transform(add_customer_age).transform(add_age_group)

(
    processed.writeStream.format("delta")
    .option("checkpointLocation", f"{volume_path}/checkpoint")
    .trigger(availableNow=True)
    .outputMode("append")
    .toTable("customers_streaming")
)
```

`outputMode("append")` fits row-level (non-aggregating) transforms. If a transform aggregates
or uses windows, switch to `complete` / `update` output mode and add a watermark — see
[aggregations and window functions](advanced-patterns.md#aggregations-and-window-functions).

## Modern SDP (`@dp`)

Put the transform chain in the function body; keep the transforms in an imported module. The
decorator handles continuous processing — no `writeStream` needed.

```python
from pyspark import pipelines as dp
from utils.spark_transform_functions import add_customer_age, add_age_group

@dp.table()
def bronze_customers():
    return (
        spark.readStream.format("cloudFiles")
        .option("cloudFiles.format", "json")
        .option("cloudFiles.schemaLocation", f"{volume_path}/schema")
        .load(volume_path)
    )

@dp.table()
def silver_customers():
    return (
        spark.readStream.table("bronze_customers")   # streaming read → streaming table
        .transform(add_customer_age)
        .transform(add_age_group)
    )
```

The transform functions stay pure and pytest-testable exactly as in batch — the pipeline
only wraps them. Add data-quality checks with `@dp.expect_*` decorators (see
`databricks-pipelines`), not inside the transforms.

For a batch / gold layer that reads sibling tables, return the batch DataFrame from
`@dp.materialized_view()` — not `@dp.table()`, which expects a streaming DataFrame. Read with
`spark.read.table(...)`, not the legacy `dp.read(...)` / `dp.read_stream(...)`:

```python
@dp.materialized_view()
def gold_customer_summary():
    return spark.read.table("silver_customers").transform(add_age_group)   # batch read
```

## Legacy DLT (`@dlt`)

Recognizable in older repos; the body is the same pattern:

```python
import dlt
from utils.spark_transform_functions import add_customer_age, add_age_group

@dlt.table()
def silver_customers():
    return dlt.read_stream("bronze_customers").transform(add_customer_age).transform(add_age_group)
```

When modernizing, swap `import dlt` → `from pyspark import pipelines as dp` and `@dlt.` →
`@dp.` (note: `@dlt.view` → `@dp.temporary_view`). The transform functions do not change.

## Medallion layering

Map transforms to the bronze → silver → gold flow so each layer's intent is explicit:

- **Bronze** — raw ingest, minimal/no transforms (keep source fidelity).
- **Silver** — cleansing and conforming: `clean_column_names`, type casts, dedupe,
  standardization — one transform per concern, chained.
- **Gold** — business aggregates and derivations: `add_age_group`, KPIs, joins to dims.

Each layer reads the previous table and applies its own `.transform()` chain, so the logic
per layer stays small, named, and testable.
