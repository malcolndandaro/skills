# Databricks notebook source
# MAGIC %md
# MAGIC # <Notebook Title>
# MAGIC
# MAGIC One-line summary of what this notebook does.
# MAGIC
# MAGIC **Inputs:** source tables / volumes / topics
# MAGIC **Outputs:** target table(s)
# MAGIC **Runs as:** interactive notebook / `notebook_task` in job `<name>`

# COMMAND ----------

# MAGIC %md
# MAGIC ## Configuration

# COMMAND ----------

# DBTITLE 1,Parameters (widgets)
# Declare parameters as widgets so the notebook is reusable and can be driven by a
# job's `base_parameters`. Delete this cell if the notebook takes no parameters.
dbutils.widgets.text(name="catalog", defaultValue="main", label="1. Catalog")
dbutils.widgets.text(name="schema", defaultValue="default", label="2. Schema")
dbutils.widgets.dropdown(
    name="mode", defaultValue="batch", choices=["batch", "streaming"], label="3. Mode"
)

# COMMAND ----------

# DBTITLE 1,Read parameters
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
mode = dbutils.widgets.get("mode")

# COMMAND ----------

# DBTITLE 1,Imports
import pyspark.sql.functions as F
from pyspark.sql import DataFrame

# COMMAND ----------

# MAGIC %md
# MAGIC ## Logic
# MAGIC
# MAGIC `spark`, `dbutils`, and `display()` are pre-initialized in the notebook — no
# MAGIC SparkSession creation or imports needed for them.

# COMMAND ----------

# DBTITLE 1,Read
df = spark.read.table(f"{catalog}.{schema}.source_table")
display(df)

# COMMAND ----------

# DBTITLE 1,Transform
# Prefer pure, importable transform functions (see the databricks-transform-pattern
# skill). Keep the notebook as the orchestration layer that does the I/O.
result = df  # .transform(...)

# COMMAND ----------

# DBTITLE 1,Write
(
    result.write.mode("overwrite").saveAsTable(f"{catalog}.{schema}.target_table")
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Verify

# COMMAND ----------

# DBTITLE 1,Row count check
# MAGIC %sql
# MAGIC SELECT count(*) AS rows FROM ${catalog}.${schema}.target_table
