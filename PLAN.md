# n8n Module Manager (Chrome extension): project plan

This is the original plan the project started from. Some decisions changed during the build. For example, the stack became plain JS without a build step instead of TypeScript, Vite and Preact. See the README, "Known limitations", for what was built.

## Goal
A Chrome side panel that, next to an open n8n instance, shows workflows as **cards, one card per module**. One button publishes or unpublishes a whole module, in the right dependency order.

UI prototype (sample data): https://claude.ai/artifact/LVS9QejVHpTSSovAJBrxGc

## Decisions made
- Chrome MV3 extension with `sidePanel`. It is only active on n8n instances the user allows (`optional_host_permissions`, per instance).
- Only the **official public API** (`<instance>/api/v1`, header `X-N8N-API-KEY`). No internal `/rest` endpoints.
- **Module = tag `mod:<name>`.** No manifest in v1.
- **Derive dependencies live** from the Execute Workflow nodes in the workflow JSON.
- **No database in v1.** A snapshot is a JSON file downloaded before an action. Only the API key and the instance URLs are kept in `chrome.storage.local`.
- Stack (a proposal; change it freely at the start): TypeScript, Vite, Preact, Vitest.

## Test first (unverified; do this in phase 0)
1. How activate/deactivate behaves on your n8n version (2.x: publish/unpublish).
2. `PUT /workflows/{id}` with `publishIfActive=false`: does the live version stay untouched?
3. How an Execute Workflow node stores its target workflow (parameter name, ID versus name, per version).
4. Whether the `tags` filter on `GET /workflows` expects a name or an ID.
5. Whether fetch from the extension works with host permission only (CORS), and how pagination and rate limits (429) behave.

## Structure
```
n8n-module-manager/
  CLAUDE.md
  PLAN.md
  docs/findings.md          # phase 0 results
  extension/
    manifest.json
    src/background.ts       # open the side panel on icon click
    src/panel/              # card UI
    src/lib/n8n.ts          # API client (pagination, backoff, errors)
    src/lib/modules.ts      # group by mod: tag
    src/lib/deps.ts         # dependency graph, cycles, order
    src/lib/snapshot.ts     # JSON export and import
  tests/fixtures/           # sample workflow JSON
```
`src/lib/*` is pure logic without Chrome APIs, so it can be tested with Vitest.

## Phases and acceptance criteria
**0. Spike** (separate Node scripts against a test instance, never production)
List workflows by tag, (de)activate one workflow, test `publishIfActive=false`, read Execute Workflow nodes. Done when `docs/findings.md` answers the five points above.

**1. Skeleton**
MV3 manifest, side panel opens from the icon, add an instance (URL + key), request host permission, connection test. Done when a valid and an invalid key both give a clear message.

**2. Cards, read-only**
Fetch workflows (paginated), group by `mod:` tag, one card per module with status and workflow list, a separate "no module" section. Done when this matches the list in n8n.

**3. Dependencies**
Graph from the nodes, cycle detection, a warning when a published workflow calls an unpublished subflow, "needs" and "used by" on the card. Unit tests for order and cycles.

**4. Actions**
Show the plan (dry run), download a snapshot, a confirmation dialog with the plan, execute in order with progress, stop at the first error with a clear state. Publish: subflows first. Unpublish: callers first. Rollback from a snapshot file.

**5. Finishing**
Switch between multiple instances, filters and search, backoff on 429, error states, a manual test checklist.

## Parking lot (later)
Migration via packages (n8n 2.27+, preview), executions per module, a manifest in an n8n data table, an MCP server with the same functions, scheduled release windows, staged rollout with `publishIfActive=false`.

## Safety
- Key only in `chrome.storage.local`, never logged, short expiry, a separate key per instance.
- Every action that changes something asks for confirmation with the plan.
- Test instance only at first.

## Sources
- n8n API authentication: https://docs.n8n.io/api/authentication/
- n8n Workflow API: https://docs.n8n.io/connect/n8n-api/workflow.md
- n8n CLI (same API, useful as a reference): https://docs.n8n.io/connect/n8n-cli.md
- Chrome Side Panel API: https://developer.chrome.com/docs/extensions/reference/api/sidePanel

---

## CLAUDE.md (copy to the project root)
```
# n8n Module Manager
Chrome MV3 extension (side panel) to publish/unpublish n8n workflows per module (tag `mod:<name>`).
Read PLAN.md for decisions, phases and what still needs testing.

## Rules
- Only the official n8n public API (/api/v1), no internal /rest.
- No database; only chrome.storage.local for instance URLs and keys.
- src/lib/* holds pure logic without chrome.* APIs; write Vitest tests for it.
- Work phase by phase; finish each phase with working tests and a short update in docs/findings.md.
- Never touch a production instance without my explicit confirmation.
- Don't invent API behavior: an uncertain point = test it in the spike and record it in docs/findings.md.
- Code and identifiers in English, explanations to me in Dutch, short.
```

## First prompt for Claude Code
```
Read PLAN.md and CLAUDE.md. Create the project structure and start phase 0:
write Node scripts that answer the five points from "Test first" against my
test instance. Use N8N_URL and N8N_API_KEY from a .env (in .gitignore).
Record the results in docs/findings.md, then stop for my approval.
```
