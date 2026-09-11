"""Reusable PySpark transform functions (transform pattern).

Copy this module into a project's ``utils/`` (inside a Databricks Git folder / repo) and
import the functions into notebooks, jobs, and Lakeflow pipelines:

    from utils.spark_transform_functions import add_customer_age, add_age_group

Conventions
-----------
- Every function is pure: ``DataFrame -> DataFrame``, one responsibility, no I/O and no
  side effects (no reads/writes, ``display``, ``dbutils``, widgets, or secrets).
- Type hints + docstrings on everything.
- Configuration is passed as arguments (forwarded by ``df.transform(func, **kwargs)``),
  never read from the environment inside the function.
- Compose with ``df.transform(a).transform(b)``.
"""

from __future__ import annotations

from datetime import date

from pyspark.sql import DataFrame
from pyspark.sql.functions import (
    col,
    current_date,
    datediff,
    floor,
    lit,
    when,
)


def add_customer_age(df: DataFrame, as_of: date | None = None) -> DataFrame:
    """Add an ``age`` column derived from ``birth_date``.

    Pass ``as_of`` to make the result deterministic (recommended in tests); defaults to the
    current date.
    """
    reference = lit(as_of) if as_of is not None else current_date()
    return df.withColumn("age", floor(datediff(reference, col("birth_date")) / 365.25))


def add_age_group(df: DataFrame, young_max: int = 25, senior_min: int = 65) -> DataFrame:
    """Bucket ``age`` into ``young_adult`` / ``adult`` / ``senior`` using thresholds."""
    return df.withColumn(
        "age_group",
        when(col("age") < young_max, "young_adult")
        .when(col("age") < senior_min, "adult")
        .otherwise("senior"),
    )


def clean_column_names(df: DataFrame) -> DataFrame:
    """Lowercase column names and replace spaces/hyphens with underscores.

    Uses a single ``select`` with aliases rather than a per-column ``withColumnRenamed``
    loop, so wide schemas don't build a deep chain of Project nodes.
    """

    def clean(name: str) -> str:
        return name.lower().replace(" ", "_").replace("-", "_")

    return df.select([col(f"`{c}`").alias(clean(c)) for c in df.columns])


def add_column_prefixes(df: DataFrame) -> DataFrame:
    """Prefix column names by data type (``dt_``, ``str_``, ``num_``, ``bool_``).

    Single ``select`` with aliases (avoids a deep plan on wide schemas).
    """
    prefix_mapping = {
        "date": "dt_",
        "timestamp": "dt_",
        "string": "str_",
        "int": "num_",
        "double": "num_",
        "float": "num_",
        "boolean": "bool_",
    }

    def prefixed(name: str) -> str:
        data_type = df.schema[name].dataType.simpleString().lower()
        prefix = next((v for k, v in prefix_mapping.items() if k in data_type), "")
        return f"{prefix}{name}" if prefix and not name.startswith(prefix) else name

    return df.select([col(f"`{c}`").alias(prefixed(c)) for c in df.columns])


def cast_columns(df: DataFrame, casts: dict[str, str]) -> DataFrame:
    """Cast columns per a ``{column: spark_type}`` mapping. Example of parameterization."""
    for name, dtype in casts.items():
        df = df.withColumn(name, col(name).cast(dtype))
    return df


def require_columns(df: DataFrame, required: set[str]) -> DataFrame:
    """Fail fast if expected columns are missing (boundary validation)."""
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")
    return df
