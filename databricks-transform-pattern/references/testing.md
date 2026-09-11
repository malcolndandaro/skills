# Testing transform functions with pytest

Pure `DataFrame -> DataFrame` transforms are the payoff of this pattern: each one is a
plain function, unit-testable on a **local SparkSession** with no cluster. Keep tests small
and deterministic.

## Contents

- [SparkSession fixture](#sparksession-fixture)
- [Asserting DataFrame equality](#asserting-dataframe-equality)
- [A transform test](#a-transform-test)
- [End-to-end pipeline test](#end-to-end-pipeline-test)
- [Non-deterministic transforms](#non-deterministic-transforms)
- [Running tests](#running-tests)

## SparkSession fixture

Create one session per test session (`scope="session"`) — spinning up Spark is the slow
part. Put this in `conftest.py` so every test file shares it.

```python
# conftest.py
import pytest
from pyspark.sql import SparkSession

@pytest.fixture(scope="session")
def spark():
    session = (
        SparkSession.builder
        .master("local[2]")
        .appName("transform-tests")
        .config("spark.sql.shuffle.partitions", "1")   # tiny data → avoid 200 partitions
        .getOrCreate()
    )
    yield session
    session.stop()
```

Locally this needs `pyspark` installed (`pip install pyspark pytest`). To run tests against
real Databricks compute instead, use **Databricks Connect** — see the `databricks-connect`
guidance in the `databricks-python-sdk` skill.

## Asserting DataFrame equality

Prefer the built-in `assertDataFrameEqual` (PySpark 3.5+, i.e. Databricks Runtime 14.3 LTS
and later). It compares schema and rows and gives readable diffs:

```python
from pyspark.testing import assertDataFrameEqual
assertDataFrameEqual(actual, expected)                    # order-insensitive by default
assertDataFrameEqual(actual, expected, rtol=1e-3)         # float tolerance
```

On older runtimes, use [`chispa`](https://github.com/MrPowers/chispa) (`pip install chispa`):

```python
from chispa import assert_df_equality
assert_df_equality(actual, expected, ignore_row_order=True)
```

## A transform test

Build a tiny input inline, apply one transform, compare to the expected output:

```python
from pyspark.sql import Row
from pyspark.testing import assertDataFrameEqual
from utils.spark_transform_functions import add_age_group

def test_add_age_group(spark):
    df = spark.createDataFrame([Row(id=1, age=20), Row(id=2, age=40), Row(id=3, age=80)])

    actual = df.transform(add_age_group)

    expected = spark.createDataFrame([
        Row(id=1, age=20, age_group="young_adult"),
        Row(id=2, age=40, age_group="adult"),
        Row(id=3, age=80, age_group="senior"),
    ])
    assertDataFrameEqual(actual, expected)
```

Test parameters too: call `df.transform(add_age_group, young_max=21)` and assert the
boundary row moves.

## End-to-end pipeline test

Test the full chain on a small sample to catch column-ordering and inter-step assumptions:

```python
def test_pipeline(spark):
    df = spark.createDataFrame([Row(id=1, birth_date="1990-01-01")])
    actual = df.transform(add_customer_age).transform(add_age_group)
    assert set(actual.columns) >= {"age", "age_group"}
    assert actual.count() == 1
```

## Non-deterministic transforms

`current_date()`, `now()`, `rand()`, and random splits make outputs unstable. Options:

- **Inject the value** as a parameter: `def add_age(df, as_of: date) -> DataFrame` and pass
  a fixed date in the test. Preferred — keeps the transform pure and deterministic.
- **Seed randomness**: `df.randomSplit([0.8, 0.2], seed=42)`, `rand(seed=42)`.
- Assert on invariants (row count, value ranges, null rate) rather than exact rows.

## Running tests

```bash
pytest -q                      # all tests
pytest tests/test_transforms.py::test_add_age_group -q
```

Wire the same command into CI so transforms are validated on every push, independent of any
Databricks workspace.
