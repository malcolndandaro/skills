# Databricks MCP servers: tools, arguments, status

Sources: `docs.databricks.com/aws/en/agents/mcp-tools/*` (pages last updated Sep 11–22, 2026). The
managed-servers page carries a Public Preview banner, while the Genie One MCP Service is GA. Confirm
tool names with `tools/list`: the docs don't list every tool, and names are per resource.

## Tool call arguments vs `_meta`

Managed servers separate two kinds of input. **Arguments** are what the LLM generates, such as
`query`. **`_meta`** carries configuration that your agent code presets deterministically, such as
`num_results`, `warehouse_id` or `filters`. Put policy in `_meta`, not in the prompt.

## Genie One: `/ai-gateway/mcp-services/system.ai.genie_one_mcp`

- A Databricks-provided MCP Service over Chat in Genie One. GA. OBO scope `ai-gateway`.
- "Account users hold `EXECUTE` on `system.ai` by default, so no extra grant is usually required."
- Tools: `genie_ask` (returns `conversation_id`, `response_id`, `status`; pass `conversation_id` to
  continue), `genie_poll_response`, `genie_get_query_result`, `genie_cancel_response`, and `view_ask`
  (offered instead of `genie_ask` to MCP Apps clients).
- Flow: `genie_ask` returns `status: in_progress`. Poll `genie_poll_response`, waiting for each poll to
  return before the next, until the status is `completed`, `incomplete` or `failed`. Pass `warehouse_id`
  as `_meta` on `genie_ask` to choose the warehouse.
- **Deprecation:** the Beta endpoint `/api/2.0/mcp/genie` (no space id, `genie` scope) "is deprecated
  and will be sunset on October 31, 2026".

## Genie Agent: `/api/2.0/mcp/genie/{genie_space_id}`

- One curated Genie Agent (formerly "Genie space"), up to 25 UC tables. Scope `genie`. The caller needs
  `CAN_RUN` on the space.
- The docs list two limitations: "Read-only" and "No conversation history" (the server calls Genie as a
  tool).
- Tools are per space. We observed `query_space_<id>` (argument `query`) and `poll_response_<id>`.
  A turn takes tens of seconds, so budget timeouts accordingly (a 180 s client timeout is reasonable)
  and keep Genie off latency-critical paths.

## AI Search: `/api/2.0/mcp/ai-search/{catalog}/{schema}/{index_name}`

- Formerly Vector Search: "The previous `/api/2.0/mcp/vector-search/` URL prefix and `vector-search`
  scope still work." The helpers `from_vector_search` in `databricks-openai` / `databricks-langchain`
  still build the legacy prefix.
- The index needs Databricks-managed embeddings. The caller needs `SELECT` on the index.
- Tool name `CATALOG__SCHEMA__INDEX_NAME`, argument `{"query": "..."}`.
- `_meta`: `columns` (comma-separated), `columns_to_rerank`, `filters` (a JSON **string**, for example
  `'{"updated_after": "2024-01-01"}'`), `include_score`, `num_results`, `query_type` (`ANN` or
  `HYBRID`), `score_threshold`.
- In our measurements the latency tail of AI Search over MCP was around 1.5 s at p95. It works for
  exploration and RAG, but not as a sub-200 ms context lookup.

## Databricks SQL: `/api/2.0/mcp/sql`

- Tool `execute_sql`, argument `{"query": "..."}`, `_meta` `warehouse_id`. Execution is asynchronous
  (start, then poll).
- The docs recommend the `system.ai.dbsql` MCP Service instead. To make it read-only, set
  `disallow_writes` to `true` in the built-in `system.ai.dbsql_policy` policy.
- Workspace rate limit: **10 QPS** (the other managed servers get 50).

## UC functions: `/api/2.0/mcp/functions/{catalog}/{schema}[/{function_name}]`

- Scope `unity-catalog`. The caller needs `EXECUTE`. Runs on serverless general compute.
- The docs show the per-function form and also use the schema-level form (`.../functions/system/ai`).
  The schema-level form exposes **every** function in the schema as a tool, so keep agent functions
  in their own schema, apart from governance functions.
- Built-in: `system.ai.python_exec` (tool `system__ai__python_exec`, argument `{"code": "..."}`) is a
  code interpreter. It needs serverless enabled in the workspace.
- A function that runs a SQL query over MCP measured about 2.5 s end to end in our tests (statement
  start-up dominates). For a hot path, precompute and serve the answer from an online store instead.

## Built-in MCP Services (`system.ai.<service>`)

URL: `/ai-gateway/mcp-services/system.ai.<service-name>`.

| Service | What | Status |
|---|---|---|
| `genie_one_mcp` | Genie One (above) | GA |
| `dbsql` | SQL on a warehouse with the caller's UC and warehouse permissions | Beta |
| `web_search` | Web search; not available with HIPAA/BAA compliance | Beta |
| `sandbox` | Runs Python, SQL or shell in isolation; no network egress | Beta |
| `slack`, `github`, `atlassian`, `google_drive`, `google_calendar`, `gmail`, `microsoft_365` | Connected apps | — |

For Google Drive, Gmail, Google Calendar and Microsoft 365, each user logs in once (Catalog Explorer,
then **Login**) before the first call. Until then, a call returns JSON-RPC `-32042` with a login URL in
`error.data.elicitations[]`.

List them:

```bash
databricks api get "/api/2.1/unity-catalog/mcp-services?parent=schemas/system.ai&page_size=100"
```

`page_size` is capped at 100. Follow `next_page_token` for more.

## Pricing

UC functions bill as serverless general compute, Genie as serverless SQL, Databricks SQL at DBSQL
rates, and AI Search at AI Search rates. Custom servers bill as Databricks Apps.
