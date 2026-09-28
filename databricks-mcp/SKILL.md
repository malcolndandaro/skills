---
name: databricks-mcp
description: "Connect agents and MCP clients to Databricks MCP servers: managed servers (Genie One, Genie Agent, AI Search, Databricks SQL, UC functions), MCP Services (external MCP servers governed as Unity Catalog securables) and custom MCP servers on Databricks Apps. Use when writing agent code that calls Databricks MCP tools (DatabricksMCPClient, OpenAI Agents SDK McpServer, LangGraph DatabricksMultiServerMCPClient, a ResponsesAgent), pointing Claude Code, Cursor or Codex at a Databricks MCP URL, choosing OAuth scopes, declaring passthrough resources for a deployed agent, registering an external MCP server, building an MCP server on Apps, or debugging 401/403/429, SSE and session errors on /api/2.0/mcp or /ai-gateway/mcp-services. NOT for: asking data questions from the CLI (databricks-data-discovery), Supervisor Agent tools (databricks-agent-bricks), serving endpoint ops (databricks-model-serving)."
compatibility: Requires databricks CLI (>= v1.0.0). Agent code needs Python 3.12+ and databricks-mcp >= 0.9.2.
metadata:
  version: "0.1.0"
parent: databricks-core
---

# Databricks MCP

**FIRST**: Use the parent `databricks-core` skill for CLI basics, authentication, and profile selection.

How agents and MCP clients reach Databricks tools over the Model Context Protocol, and the
failure modes that the docs don't spell out. Checked on 2026-09-28 against docs.databricks.com
pages last updated Sep 11–22, 2026, `databricks-mcp` 0.9.2 and MLflow 3.12. Managed MCP servers
are in Public Preview and `DatabricksMCPClient` is marked `@experimental`, so names move: the docs
themselves say *"Do not hardcode server names, tool names, or argument shapes from memory; confirm
them from the workspace."* Run `tools/list` before you wire a tool name into code.

## When to Use

- Writing agent code (any framework) whose tools are Databricks MCP servers
- Connecting an IDE or coding agent (Claude Code, Cursor, Codex) or Claude/ChatGPT connectors to a workspace
- Deciding which MCP server type to expose, and what identity and OAuth scope each call runs as
- Deploying an agent that calls MCP tools (Databricks Apps or Model Serving) without `PERMISSION_DENIED`
- Registering a third-party MCP server as an MCP Service, or hosting your own MCP server on Apps
- Sizing, load testing, or auditing MCP traffic

## Pick the server

| Need | Server | URL (prefix `https://<workspace-host>`) | OBO scope |
|---|---|---|---|
| NL analytics across the workspace | Genie One (MCP Service, GA) | `/ai-gateway/mcp-services/system.ai.genie_one_mcp` | `ai-gateway` |
| NL analytics over one curated Genie Agent | Genie Agent | `/api/2.0/mcp/genie/{genie_space_id}` | `genie` |
| Retrieval over an index | AI Search (formerly Vector Search) | `/api/2.0/mcp/ai-search/{catalog}/{schema}/{index_name}` | `ai-search` |
| Run SQL you already wrote | Databricks SQL | `/api/2.0/mcp/sql` | `sql` |
| Deterministic SQL/Python logic as tools | UC functions | `/api/2.0/mcp/functions/{catalog}/{schema}[/{function_name}]` | `unity-catalog` |
| A third-party MCP server, governed in UC | MCP Service | `/ai-gateway/mcp-services/{catalog}.{schema}.{service}` | `ai-gateway` |
| Your own server code | Custom MCP server on Databricks Apps | `https://<app-url>/mcp` | (app OAuth) |

Legacy forms still answer, so recognize them in existing code but don't write new code on them:

| Legacy | Replacement |
|---|---|
| `/api/2.0/mcp/vector-search/{catalog}/{schema}` | `ai-search/...` ("the previous prefix and `vector-search` scope still work") |
| `/api/2.0/mcp/external/{connection}` over a UC HTTP connection with `is_mcp_connection 'true'` | MCP Services. The old path is no longer in the docs, but the SDK still maps it. |
| `/api/2.0/mcp/genie` with no space id (Beta) | Genie One MCP Service. **Sunset on 2026-10-31.** |

Per-server tools, argument shapes, `_meta` parameters and the built-in `system.ai.*` services are in
[references/servers.md](references/servers.md).

## Auth

| Server type | OAuth | PAT | Notes |
|---|---|---|---|
| Managed servers, MCP Services | yes | yes | OBO needs the scope from the table above |
| Custom server on Apps (`*.databricksapps.com`) | yes | **no** | `DatabricksMCPClient` raises `ValueError` up front on non-OAuth auth |
| Any, with Dynamic Client Registration | **no** | — | Inbound DCR is unsupported; clients that require DCR can't use OAuth |

Scope gotcha: a token is only as wide as the scopes it was minted with. An M2M token minted
with only `model-serving` can call a serving endpoint but not an Apps-hosted MCP server, and
an `all-apis` token was refused by a serving endpoint with `403 Invalid scope`. Mint one token
per target when the SP talks to both, and cache it until `expires_in − 60 s`. Minting a token
on every call adds a few hundred milliseconds.

## Call a server (smallest working calls)

Raw JSON-RPC over Streamable HTTP. The `Accept` header is mandatory, and the body can come back as SSE
(`data: {...}` lines), so strip the prefix before `json.loads`:

```bash
TOKEN=$(databricks auth token --profile <profile> | jq -r .access_token)
curl -s -X POST "https://<workspace-host>/api/2.0/mcp/functions/system/ai" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Python (`pip install -U "databricks-mcp>=0.9.2"`):

```python
from databricks.sdk import WorkspaceClient
from databricks_mcp import DatabricksMCPClient

ws = WorkspaceClient(profile="<profile>")
client = DatabricksMCPClient(server_url=f"{ws.config.host}/api/2.0/mcp/functions/system/ai",
                             workspace_client=ws)
print([t.name for t in client.list_tools()])            # sync: uses asyncio.run
result = client.call_tool("system__ai__python_exec", {"code": "print(1 + 1)"})
# in async code (FastAPI, Apps agent server, notebook top-level await) use the async pair:
# tools = await client.alist_tools(); result = await client.acall_tool(name, args)
# in sync code under a running loop, see gotcha 1
```

Each call opens its own MCP session (`initialize` is sent per call). That makes stateful servers work
without extra code, at the price of one round trip. Tool names map `.` to `__`
(`system.ai.python_exec` → `system__ai__python_exec`).

To point an IDE or coding agent at a server (Claude Code `claude mcp add-json`, `mcp-remote`, the
Unity Gateway CLI `ug`), see [references/clients.md](references/clients.md).

## Agent code: pick the hosting first

- **Databricks Apps (recommended for new agents).** The Model Serving deploy page carries this
  banner: *"For new use cases, Databricks recommends deploying agents on Databricks Apps."* Start from
  the agent templates (for example `agent-openai-agents-sdk`). Declare the resources in
  `databricks.yml`, and use `user_api_scopes` plus `get_user_workspace_client()` for on-behalf-of-user.
  For the app itself, use `databricks-apps-python` and `databricks-dabs`.
- **Model Serving (`databricks.agents.deploy`).** It still works and is the path with automatic
  passthrough via `log_model(resources=...)`. See `databricks-ml-training` → `references/genai-agents.md`
  for the ResponsesAgent/deploy mechanics.

Both patterns, including the one for keeping the end user's identity out of the LLM's reach, are in
[references/agent-code.md](references/agent-code.md).

### Passthrough resources (Model Serving)

`DatabricksMCPClient(url).get_databricks_resources()` takes **no argument** (the docs show one) and
recognizes exactly four legacy URL shapes. For anything else it logs an error and returns `[]`,
and the deployed agent then fails with `PERMISSION_DENIED` at call time. Declare the resources by hand:

| Server URL | What `get_databricks_resources()` returns | Declare instead (`mlflow.models.resources`) |
|---|---|---|
| `functions/{c}/{s}` | one `DatabricksFunction` per tool (calls `tools/list`) | — |
| `functions/{c}/{s}/{fn}` | `[]` | `DatabricksFunction(function_name="c.s.fn")` |
| `vector-search/{c}/{s}` | one `DatabricksVectorSearchIndex` per tool | — |
| `ai-search/{c}/{s}/{index}` | `[]` | `DatabricksVectorSearchIndex(index_name="c.s.index")` |
| `genie/{space_id}` | `DatabricksGenieSpace` | — |
| `sql` | `[]` | `DatabricksSQLWarehouse(warehouse_id=...)` |
| `external/{conn}` | `DatabricksUCConnection` | — |
| `/ai-gateway/mcp-services/...` | `[]` | No resource class exists (MLflow 3.12). Host on Apps with the `ai-gateway` scope, or run the endpoint as an SP holding `EXECUTE` |
| `https://<app>/mcp` | `[]` | `DatabricksApp(app_name=...)` |

Always add `DatabricksServingEndpoint(endpoint_name=<llm>)` for the LLM itself.

## Gotchas (field-tested)

1. **`asyncio.run() cannot be called from a running event loop`.** The sync `list_tools` / `call_tool`
   run their own loop, so they fail wherever a loop is already running. In async code (async handlers
   of an Apps agent server, a notebook cell with top-level `await`), await `alist_tools` /
   `acall_tool`. In *sync* code that can run under a loop, such as a `ResponsesAgent.predict` called
   from a notebook, `acall_tool` alone doesn't help, because you can't `await` there. Run the
   coroutine on a dedicated event-loop thread (`asyncio.run_coroutine_threadsafe`, where
   `asyncio.wait_for` really cancels a timed-out call), or hand the sync call to a worker thread.
2. **`403 User is missing privileges: USE CATALOG on system`** from a Model Serving agent calling a
   Foundation Model API LLM, with the passthrough identity. What fixed it: deploy the endpoint to run
   as an explicit service principal that holds the grants. Pass
   `environment_vars={"DATABRICKS_HOST": ..., "DATABRICKS_CLIENT_ID": "{{secrets/<scope>/<key>}}",
   "DATABRICKS_CLIENT_SECRET": "{{secrets/<scope>/<key>}}"}` to `agents.deploy`. From then on,
   `WorkspaceClient()` inside the endpoint authenticates as that SP, and `resources=` is bookkeeping.
3. **A schema-level functions URL exposes every function in the schema**, including governance
   helpers such as column-mask and row-filter functions. Keep agent tools in a dedicated schema, or use
   the per-function URL (and declare its resource by hand, see above).
4. **Argument shapes differ per server.** AI Search and Genie tools take `query`, not `query_text` or
   `question`. Genie Agent tools are per space (`query_space_<id>` to ask, `poll_response_<id>` to poll).
   Genie One uses `genie_ask` / `genie_poll_response`. Answers are asynchronous (start, then poll), and a
   Genie turn takes tens of seconds, so it is exploration, not a hot path.
5. **Stateful servers.** A raw client talking to a stateful MCP server must send `initialize`, keep
   the `mcp-session-id` response header, send `notifications/initialized`, and repeat the header on
   every call. `DatabricksMCPClient` does this for you (one session per call).
6. **Rate limits are per workspace.** 50 QPS to managed servers (UC functions, AI Search, Genie), 10 QPS
   to managed SQL and 50 QPS to external MCP servers. The excess comes back as HTTP 429. Under a
   closed-loop load test, goodput through the gateway stayed flat at about 50 rps however far
   concurrency went, while the backend app alone did about 4× that. Report successes per second next to
   offered rps. Details and sizing are in [references/limits-and-audit.md](references/limits-and-audit.md).
7. **Keep the end user's identity out of the tool schema.** If the LLM can pass an account id as a
   tool argument, a prompt can switch accounts. Take the id from `custom_inputs` (set by the
   authenticated app) and inject it when calling the MCP tool. The AI Playground and the Review App
   don't send `custom_inputs` unless you enable them (gear icon, then paste the JSON).
8. **Scale-to-zero behind a tool.** After an idle period, the first call can fail with "Upstream request
   timed out". Retry once in the agent, warm up before a demo, and turn scale-to-zero off for hot-path
   endpoints.
9. **Pin `mcp`.** mcp 2.x shipped on 2026-09-07, so an unpinned `mcp>=1.9` resolves to 2.x unless
   `databricks-openai` (which pins `<2`) is in the same environment. That breaks 1.x-style
   `streamablehttp_client(auth=...)` snippets. `databricks-mcp` 0.9.2 handles both versions.
10. **The docs' LangGraph snippet uses `async with mcp_client:`**, which current `langchain-mcp-adapters`
    rejects (`NotImplementedError`). Call `await mcp_client.get_tools()` directly.
11. **You can't register an App as an MCP Service** (documented). A UC HTTP connection pointing at an
    app URL is also outside documented support, even where it works. For your own server, call the
    app URL with OAuth, or keep the legacy `external/{conn}` route knowingly.
12. **Audit lands in several places.** Where each MCP call type is recorded, the SQL for it, and why
    reconciling inside the same run returns 0 (ingestion lag) are in
    [references/limits-and-audit.md](references/limits-and-audit.md).

## Reference

| Topic | File |
|---|---|
| Each server: tools, args, `_meta`, built-in `system.ai` services, deprecations | [references/servers.md](references/servers.md) |
| IDEs and coding agents: Claude Code, `mcp-remote`, Unity Gateway CLI, OAuth apps | [references/clients.md](references/clients.md) |
| Agent code on Apps and on Model Serving; identity via `custom_inputs`; smoke gates | [references/agent-code.md](references/agent-code.md) |
| MCP Services (register, grant, select tools) and custom servers on Apps | [references/services-and-custom-servers.md](references/services-and-custom-servers.md) |
| Limits, load testing, audit trails | [references/limits-and-audit.md](references/limits-and-audit.md) |

Related skills: `databricks-apps-python` (hosting the agent or server), `databricks-dabs` (bundles),
`databricks-ml-training` (ResponsesAgent, `agents.deploy`), `databricks-unity-catalog` (grants, audit
tables), `databricks-agent-bricks` (Supervisor Agent tools), `databricks-mlflow-evaluation` (evaluating the agent).
