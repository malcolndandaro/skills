# Limits, load testing and audit trails

## Limits (per workspace; all can be raised)

From `docs.databricks.com/aws/en/resources/limits` (Sep 15, 2026):

| Target | Limit |
|---|---|
| Managed MCP servers: UC functions, AI Search (listed as "VectorSearch"), Genie | 50 QPS |
| Managed MCP: Databricks SQL | 10 QPS |
| External MCP servers | 50 QPS |

The excess comes back as **HTTP 429**. The gateway limit protects the backend: in our closed-loop
test through the gateway, goodput stayed flat at about 50 rps (48–51) from 10 to 500 concurrent users,
with 86–88% of requests getting 429 at the high end, while the app behind it sat mostly idle. The
same app called directly handled about 200 rps with zero 5xx up to 500 users, and degraded by queueing
(latency grew), not by failing. Calling the `*.databricksapps.com` URL directly bypasses both the
limit and the gateway's audit record. That is a trade-off, not a free win. If you need more than the
ceiling through the gateway, ask for a limit increase.

## Load testing MCP routes

- **Measure where the agent runs.** From a laptop, the home network dominates: about 0.9 s against
  about 85 ms measured in-region for the same call. Measure per MCP call, end to end, per route.
- **"N users" is not "N rps".** In a closed loop, throughput = concurrency ÷ latency (Little's law).
  Without think time, N users hammer at N/latency rps, which measures the **ceiling**. To answer "how
  many concurrent agents", add think time per virtual agent (call, pause, call). Then
  `agents ≈ ceiling_rps × seconds_between_calls`: at one call per second a 50 rps gateway carries about
  50 agents, at one call every 10 s about 500.
- **Add jitter to think time.** Without it, virtual agents wake up in sync (a convoy) and p95 becomes an
  artifact. We saw p95 *drop* as agents doubled. Stagger start times and vary each pause by about ±50%.
- **Report goodput.** Put successes per second next to offered rps. A route passes only when p95 is on
  target **and** there are zero errors, because a good p95 with 88% 429s is not a pass.
- **Two engine bugs to avoid:**
  - A call that fails *synchronously* inside an asyncio loop spins without yielding and freezes the
    test. Add `await asyncio.sleep(0)` per iteration, and put a ceiling on each stage's cleanup.
  - If the driver runs in its own thread (asyncio), queue results and let the main thread persist
    them. Otherwise nothing is saved, and a 30-minute run dies with no evidence.

Latency by route in our measurements, via MCP, in-region, p95:

| Route | p95 |
|---|---|
| Precomputed context served from an online store behind a thin MCP proxy on Apps | about 120–220 ms |
| pgvector/BM25 retrieval in Lakebase with a pre-embedded query | about 105–120 ms |
| The same retrieval embedding the query per call | about 300 ms |
| UC function that runs SQL | about 2.5 s |
| AI Search (the tail) | about 1.5 s |
| Genie | tens of seconds |

For a sub-200 ms tool, precompute and serve. Treat Genie and SQL-backed functions as exploration
tools. The retrieval tail came from the embedding call, not the database: moving to a smaller
embedding model cut it several times over.

## Where each MCP call is audited

Each call type leaves its record somewhere different. We reconciled 420 of 420 calls per route this way:

| Call | Where | Count by |
|---|---|---|
| Serving endpoint (LLM, feature serving) | `system.serving.endpoint_usage`, one row per request | `served_entity_id` joined to `system.serving.served_entities` |
| AI Search / Vector Search | `system.access.audit` `vectorSearch.queryVectorIndex` | `request_params.name` |
| Genie | `system.access.audit` `aibiGenie.genieStartConversationMessage` | `request_params.space_id` (don't count polls, which log `genieGetConversationMessage`) |
| UC function | `system.access.audit` `unityCatalog.getFunction` | `request_params.full_name_arg` |
| Legacy `external/{conn}` | `system.access.audit` `ucHttpConnection.ucHttpConnectionProxiedRequest` | `request_params.connection_name` |
| MCP Service | `system.ai_gateway.usage` (`service_type = 'MCP_SERVICE'`), audit action `mcpCall` | per the docs (we didn't reconcile this one) |

```sql
-- Serving endpoint: the table has NO endpoint_name column; join to translate the name.
SELECT u.request_time, u.requester, u.status_code, u.input_token_count, u.output_token_count
FROM system.serving.endpoint_usage u
WHERE u.served_entity_id IN (
  SELECT served_entity_id FROM system.serving.served_entities
  WHERE endpoint_name = '<endpoint>')
ORDER BY u.request_time DESC;

-- Audit events: the table covers the whole ACCOUNT, so filter the workspace. unityCatalog events carry
-- workspace_id = 0 at the top level and the real id in request_params.workspace_id.
SELECT COUNT(*) AS calls
FROM system.access.audit
WHERE event_date >= DATE(TIMESTAMP '<start>')
  AND event_time >= TIMESTAMP '<start>' AND event_time < TIMESTAMP '<end>'
  AND (workspace_id = '<workspace-id>' OR request_params.workspace_id = '<workspace-id>')
  AND service_name = 'unityCatalog' AND action_name = 'getFunction'
  AND request_params.full_name_arg = '<catalog>.<schema>.<function>';
```

Things that produce false divergences:
- **Ingestion lag.** It measured about 76 minutes. Reconciling inside the same run returns
  `observed = 0`, which is lag, not a governance gap, so run the reconciliation as a later job.
- **Warm-up calls count.** Expected calls = `N × (warmup + repeats)`, not the number of attempts.
- **`tools/list` is audited too.** On the functions server it logs `listFunctions` plus one
  `getFunction` per function in the schema. On a connection it is one more proxied request. Add
  discovery to the expected count.
- **`commandText` arrives as `<REDACTED>`.** Audit MCP traffic by attribution (who, when, which
  object), never by statement text.
- **Use the same key on both sides.** Key the expected and observed counts by the same route name. A
  renamed route shows up as a false mismatch.

For payload-level evidence on a serving endpoint (request and response bodies), enable the AI Gateway
inference table (`serving-endpoints put-ai-gateway`: usage tracking plus an inference table named
`<prefix>_payload`). It is governed in UC, so restrict `SELECT` on it. AI Gateway guardrails (PII,
safety) apply to **LLM** endpoints only. They don't cover feature serving endpoints or MCP servers, so
keep PII out of what those tools return, with UC column masks.
