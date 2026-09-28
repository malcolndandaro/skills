# MCP Services and custom MCP servers on Databricks Apps

Sources: `docs.databricks.com/aws/en/agents/mcp-tools/mcp-services` (Sep 11, 2026),
`/aws/en/ai-gateway/register-mcp-service` (Sep 17), `/aws/en/agents/mcp-tools/custom-mcp` (Sep 11).

## MCP Services: an external MCP server as a UC securable

An MCP Service puts a third-party or self-hosted MCP server (Streamable HTTP only) behind Unity
Catalog. Callers get `EXECUTE` on the service. Databricks runs a managed proxy that holds the
credentials, so none go into agent code. You also get tool allowlists, service policies and usage and
audit tables. It is invoked at `https://<workspace-host>/ai-gateway/mcp-services/<catalog>.<schema>.<service>`
(OBO scope `ai-gateway`).

**What can't be registered:** "You can register only external MCP servers as your own MCP Service.
Registering Genie, Apps, or Unity Catalog entity sources as an MCP Service is not currently supported."
There is no SQL DDL (`CREATE MCP SERVICE` doesn't exist). Use the UI, REST, CLI, SDKs, Terraform or
DABs.

### Privileges

| To | Needs |
|---|---|
| Create the HTTP connection | `CREATE CONNECTION` on the schema (schema-level connections are recommended; metastore-level still works) |
| Create the service | `USE CATALOG`, `USE SCHEMA`, `CREATE SERVICE` on the schema, `USE CONNECTION` on the connection |
| Invoke the service | `EXECUTE` on the service, `USE CATALOG`, `USE SCHEMA`, and workspace assignment |

> "Don't grant `USE CONNECTION` to end users: it lets them call the external server directly through
> the connection, or register their own MCP Service on it, bypassing the tool selection, service
> policies, and auditing of your MCP Service."

### 1. Connection

Catalog → Connections → Create connection → **HTTP** → server URL → auth type: bearer token, OAuth
M2M, OAuth U2M (shared or per-user), or Dynamic Client Registration. DCR is supported here, for the
*upstream* server, even though inbound clients can't use DCR. Glean, GitHub, Atlassian and Slack have
managed OAuth. Marketplace has curated servers with the connection preconfigured.

The server must be reachable from the serverless compute plane. Under a restricted serverless network
policy its FQDN must be allowlisted. Otherwise calls fail with "Access to <fqdn> is denied because of
serverless network policy".

### 2. Service

```bash
databricks ai-gateway create-mcp-service schemas/main.default my_mcp --json '{
  "comment": "External MCP server",
  "config": {
    "source_connection": {
      "name": "connections/main.default.my_connection"
    }
  }
}'
```

`source_connection.name` is the **resource name** `connections/<catalog>.<schema>.<connection>`. A
bare connection name is rejected. The same call over REST is
`POST /api/2.1/unity-catalog/mcp-services?parent=schemas/<c>.<s>&mcp_service_id=<name>`, and in Python
it is `w.ai_gateway.create_mcp_service(...)`. As a bundle resource (Beta):

```yaml
resources:
  mcp_services:
    my_mcp:
      parent: schemas/main.default
      mcp_service_id: my_mcp
      comment: External MCP server
      config:
        source_connection:
          name: connections/main.default.my_connection
      grants:
        - principal: data-team
          privileges: [EXECUTE]
```

Update with `databricks ai-gateway update-mcp-service mcp-services/<c>.<s>.<name> <update_mask> --json ...`
and delete with `delete-mcp-service mcp-services/<c>.<s>.<name>`. The service name can't be changed
after creation.

### 3. Tool allowlist

```bash
databricks api patch \
  "/api/2.1/unity-catalog/mcp-services/main.default.my_mcp?update_mask=config.include_tool_selectors" \
  --json '{"config": {"include_tool_selectors": ["get_*"]}}'
```

A selector is a prefix (`get_*`) or an exact name. There are no exclusion patterns. Omit the list to
expose everything. Calling a tool outside the list returns
`{"code": -32003, "message": "Tool not allowed by MCP service configuration."}`.

### 4. Grant and invoke

```bash
databricks grants update mcp_service main.default.my_mcp \
  --json '{"changes": [{"principal": "data-team", "add": ["EXECUTE"]}]}'

TOKEN=$(databricks auth token --profile <profile> | jq -r .access_token)
curl -s -X POST "https://<workspace-host>/ai-gateway/mcp-services/main.default.my_mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

- Per-user OAuth connections: each user logs in once (Catalog Explorer, then **Login**). Before that, a
  call returns JSON-RPC `-32042` with the login URL in `error.data.elicitations[]`.
- Result parsing: prefer `structuredContent` when present, else `json.loads(result.content[0].text)`.
- Usage lands in `system.ai_gateway.usage` (`service_type = 'MCP_SERVICE'`), and the audit action is
  `mcpCall`.

## Legacy route: UC HTTP connection with `is_mcp_connection`

Older code (and the Supervisor Agent `uc_connection` tool) wraps an MCP server in a UC HTTP connection
and calls `/api/2.0/mcp/external/<connection>`. It still answers, and `DatabricksMCPClient` still
maps it to a `DatabricksUCConnection` resource, but it is gone from the current docs. Use it knowingly:

```sql
CREATE CONNECTION my_mcp_conn TYPE HTTP
OPTIONS (
  host 'https://<app-or-server-host>',
  port '443',
  base_path '/mcp',
  client_id '<sp-client-id>',
  client_secret secret('<scope>', '<key>'),
  oauth_scope 'all-apis',
  token_endpoint 'https://<workspace-host>/oidc/v1/token',
  is_mcp_connection 'true'
);
GRANT USE CONNECTION ON CONNECTION my_mcp_conn TO `<caller-sp>`;
```

Things that cost time on this route:
- **Use underscores in the connection name.** A hyphen breaks the unquoted `CREATE CONNECTION`.
- **The update syntax is `ALTER CONNECTION c OPTIONS (...)`, with no `SET`.** `SET OPTIONS` is a parse
  error, and it only shows up on the second run, once the connection exists.
- **`execute_statement` doesn't raise on SQL errors.** It returns `FAILED`, so always check
  `status.state`, or a realignment step fails silently.
- **Calls through the connection are audited** as `ucHttpConnection.ucHttpConnectionProxiedRequest`,
  one per request, including `tools/list`.

## Custom MCP server on Databricks Apps

Documented basics:
- The app name must start with `mcp-` for AI Playground to recognize it.
- The endpoint is `https://<app-url>/mcp` (Streamable HTTP).
- It is OAuth-only: PATs are not accepted.
- Start from the "MCP Server - Hello World" template.

```toml
# pyproject.toml
[project.scripts]
custom-server = "server.main:main"
```

```yaml
# app.yaml
command: ['uv', 'run', 'custom-server']   # must match a script in pyproject.toml; serve on port 8000
```

```bash
databricks apps create mcp-my-server
databricks sync . "/Users/<you>/mcp-my-server"
databricks apps deploy mcp-my-server --source-code-path "/Workspace/Users/<you>/mcp-my-server"
```

### A FastMCP server that holds up under load

Tested with fastmcp 3.1.1: `/livez` returns 200, and `/mcp` answers `tools/list` / `tools/call` as
`text/event-stream`.

```python
from contextlib import asynccontextmanager

import anyio.to_thread
from fastapi import FastAPI
from fastmcp import FastMCP

MAX_CONCURRENCY = 24                      # per worker; sizes the DB pool AND the thread limiter
mcp = FastMCP("my-server")

@mcp.tool()
def get_entity_context(entity_id: str) -> str:
    """Precomputed context for one entity. Describe when NOT to use the tool, too."""
    ...

mcp_app = mcp.http_app(path="/mcp", stateless_http=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Sync tools run on anyio's thread pool (default 40 threads): align it with your own ceiling,
    # or a load test measures anyio's default instead of your system.
    anyio.to_thread.current_default_thread_limiter().total_tokens = MAX_CONCURRENCY
    async with mcp_app.lifespan(app):     # mandatory: starts the Streamable HTTP session manager
        yield

app = FastAPI(lifespan=lifespan)

@app.get("/livez")                        # NOT /healthz (see below)
def livez() -> dict:
    return {"status": "ok"}

app.mount("/", mcp_app)                   # catch-all: mount AFTER your own routes
```

Lessons from load-testing a server like this:
- **`stateless_http=True` is only the transport.** A single shared DB connection behind a
  `threading.Lock` still serializes every call (head-of-line blocking). Use a real connection pool, and
  reuse one HTTP client for downstream calls such as embeddings.
- **Set concurrency in one place.** Connections to the backend = `workers × MAX_CONCURRENCY`. Run a few
  uvicorn workers when tools do CPU work (JSON, vector literals). Fail fast when the pool is exhausted
  (a short pool timeout and a statement timeout) rather than hang.
- **The Apps front door intercepts `/healthz`.** It answers 200 with an empty body without reaching
  your process, so a liveness check there stays green with the process dead. Use `/livez` (no backend
  access) and `/readyz` (touches the backend and reports pool state).
- **Identity inside the app.** By default, calls run as the app's service principal. For
  on-behalf-of-user, read the `x-forwarded-access-token` header. The inbound `Authorization` header is
  the Apps gateway's token and was refused (403) by a serving endpoint. To call a serving endpoint
  with M2M, mint a token with the `model-serving` scope.
- **Deploying through a bundle:** `bundle deploy` creates the app stopped, and the app's `config`
  (command, env) takes effect on `bundle run <app>`. An app that depends on a resource created later
  shouldn't declare it under `resources:`. Resolve it at runtime with a lazy pool, so the app doesn't
  crash-loop at boot.
- **Granting callers:** custom `mcp-*` apps are "not yet supported as bundle resources". Grant callers
  `Can Use` with `databricks apps update-permissions`.
