# Connecting IDEs, coding agents and chat clients

Source: `docs.databricks.com/aws/en/agents/mcp-tools/connect-clients` (Sep 22, 2026). "Every client
connects to Databricks MCPs the same way: add the server URL to the client's MCP configuration,
authenticate with OAuth or a personal access token, and the client calls tools over Streamable HTTP."

## Fastest: Unity Gateway CLI (coding agents)

It authenticates through your Databricks CLI login and configures the agent and its MCP servers in one
command, with no OAuth app, client id or secret to manage.

```bash
uv tool install git+https://github.com/databricks/unity-gateway
ug mcp add --agents claude --names <catalog>.<schema>.<service>   # or --agents codex / cursor
ug claude                                                         # or: ug codex / ug cursor
```

## Claude Code with a token from the Databricks CLI (no secret on disk)

The Claude Code `headersHelper` runs a command and uses its stdout (a JSON object) as request headers,
so the token is minted fresh from your CLI login:

```python
import json, shlex

def headers_helper(profile: str) -> str:
    """Shell command whose stdout is {"Authorization": "Bearer <fresh token>"}."""
    py = ("import json,sys;print(json.dumps({'Authorization':"
          "'Bearer '+json.load(sys.stdin)['access_token']}))")
    return f"databricks auth token --profile {shlex.quote(profile)} | python3 -c {shlex.quote(py)}"

host = "https://<workspace-host>"
servers = {
    "uc-tools": {"type": "http", "url": f"{host}/api/2.0/mcp/functions/<catalog>/<schema>",
                 "headersHelper": headers_helper("<profile>"), "timeout": 60000},
    # A Genie turn takes tens of seconds: give it a longer tool timeout.
    "genie": {"type": "http", "url": f"{host}/api/2.0/mcp/genie/<space_id>",
              "headersHelper": headers_helper("<profile>"), "timeout": 180000},
}
open("mcp.json", "w").write(json.dumps({"mcpServers": servers}, indent=2))
```

Run it headless from an empty temporary directory, so the session doesn't inherit a `CLAUDE.md` or
other MCP servers:

```bash
claude -p "<prompt>" --mcp-config mcp.json --strict-mcp-config \
  --allowedTools mcp__uc-tools mcp__genie \
  --output-format stream-json --verbose
```

Only `stream-json` records each `tool_use` / `tool_result`, which you need as evidence that the agent
really called the tools. Plain `json` output does not.

## Claude Code with OAuth (documented form)

```bash
claude mcp add-json databricks-mcp-server \
  '{"type":"http","url":"https://<your-workspace-hostname>/api/2.0/mcp/functions/{catalog_name}/{schema_name}","oauth":{"clientId":"<your-client-id>","callbackPort":8080}}' \
  --client-secret <your-client-secret>
```

The redirect URL to register is `http://localhost:8080/callback`, and the port must match
`callbackPort`.

## OAuth app for a client (account level)

`custom-app-integration` is an account-level command. Log in to the account console first with
`databricks auth login --host <account-console-url> --account-id <account-id>`.

```bash
databricks account custom-app-integration create --json '{
  "name": "mcp-public-oauth-app",
  "redirect_urls": ["https://<your-client-redirect-url>"],
  "confidential": false,
  "scopes": ["ai-gateway", "offline_access"],
  "token_access_policy": {
    "access_token_ttl_in_minutes": 60,
    "refresh_token_ttl_in_minutes": 10080
  }
}'
```

The narrow scopes above are the least-privilege option for MCP Services. The docs also show
`"scopes": ["all-apis"]`.

Redirect URLs by client:

| Client | Redirect URL |
|---|---|
| Claude connectors | `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback` |
| Claude Code | `http://localhost:8080/callback` |
| MCP Inspector | `http://localhost:6274/oauth/callback` (and `/oauth/callback/debug`) |
| ChatGPT | `https://chatgpt.com/connector_platform_oauth_redirect` |

**No Dynamic Client Registration:** "External clients and IDEs that mandate Dynamic Client
Registration are not supported using OAuth authentication."

## stdio-only clients: `mcp-remote`

```json
{
  "mcpServers": {
    "databricks-mcp-server": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<your-workspace-hostname>/api/2.0/mcp/functions/system/ai",
        "--static-oauth-client-info",
        "{ \"client_id\": \"$MCP_REMOTE_CLIENT_ID\", \"client_secret\": \"$MCP_REMOTE_CLIENT_SECRET\" }"
      ]
    }
  }
}
```

With a PAT (managed servers and MCP Services only, never Apps-hosted servers), use
`"--header", "Authorization: Bearer <YOUR_TOKEN>"` instead of `--static-oauth-client-info`.

Config file locations: Cursor `~/.cursor/mcp.json`; Windsurf `~/.codeium/windsurf/mcp_config.json`;
Claude Desktop `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows).

## Checking M2M credentials

```bash
DATABRICKS_CLIENT_ID=<your-client-id> DATABRICKS_CLIENT_SECRET=<your-client-secret> databricks auth describe
```
