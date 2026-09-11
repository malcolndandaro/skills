"""pytest suite for the transform functions (transform pattern).

Runs on a local SparkSession — no Databricks cluster needed:

    pip install pyspark pytest      # (chispa optional, for older runtimes)
    pytest -q

Uses ``pyspark.testing.assertDataFrameEqual`` (PySpark 3.5+ / Databricks Runtime 14.3 LTS+).
On older runtimes, install ``chispa`` and swap in ``assert_df_equality(..., ignore_row_order=True)``.
"""

from datetime import date

import pytest
from pyspark.sql import Row, SparkSession
from pyspark.testing import assertDataFrameEqual

from utils.spark_transform_functions import (
    add_age_group,
    add_customer_age,
    clean_column_names,
    require_columns,
)


@pytest.fixture(scope="session")
def spark():
    session = (
        SparkSession.builder.master("local[2]")
        .appName("transform-tests")
        .config("spark.sql.shuffle.partitions", "1")
        .getOrCreate()
    )
    yield session
    session.stop()


def test_add_customer_age_is_deterministic_with_as_of(spark):
    df = spark.createDataFrame([Row(id=1, birth_date=date(1990, 1, 1))])
    actual = df.transform(add_customer_age, as_of=date(2025, 1, 1))
    expected = spark.createDataFrame([Row(id=1, birth_date=date(1990, 1, 1), age=35)])
    assertDataFrameEqual(actual, expected)


def test_add_age_group_default_thresholds(spark):
    df = spark.createDataFrame([Row(id=1, age=20), Row(id=2, age=40), Row(id=3, age=80)])
    actual = df.transform(add_age_group)
    expected = spark.createDataFrame([
        Row(id=1, age=20, age_group="young_adult"),
        Row(id=2, age=40, age_group="adult"),
        Row(id=3, age=80, age_group="senior"),
    ])
    assertDataFrameEqual(actual, expected)


def test_add_age_group_custom_threshold(spark):
    df = spark.createDataFrame([Row(id=1, age=22)])
    actual = df.transform(add_age_group, young_max=21)  # 22 is now "adult"
    assert actual.first()["age_group"] == "adult"


def test_clean_column_names(spark):
    df = spark.createDataFrame([Row(**{"Customer ID": 1, "First-Name": "Ana"})])
    actual = clean_column_names(df)
    assert actual.columns == ["customer_id", "first_name"]


def test_require_columns_raises_on_missing(spark):
    df = spark.createDataFrame([Row(id=1)])
    with pytest.raises(ValueError, match="birth_date"):
        df.transform(require_columns, {"id", "birth_date"})


def test_end_to_end_pipeline(spark):
    df = spark.createDataFrame([Row(id=1, birth_date=date(1990, 1, 1))])
    actual = df.transform(add_customer_age, as_of=date(2025, 1, 1)).transform(add_age_group)
    assert set(actual.columns) >= {"age", "age_group"}
    assert actual.first()["age_group"] == "adult"
