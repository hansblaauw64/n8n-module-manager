# Phase 0 findings (2026-11-23)

Instance: n8n.example.com (176 workflows). First read-only calls. Later, with approval, write tests on one workflow (a harmless test workflow): activate/deactivate, PUT and tags.

| # | Point | Result |
|---|-------|--------|
| 1 | activate/deactivate | `POST /workflows/{id}/deactivate` and `/activate` return 200, and `active` flips immediately. In the 2.x version model, every switch writes a `workflowPublishHistory` entry (activated/deactivated, per version). |
| 2 | `PUT ...?publishIfActive=false` | A PUT (name, nodes, connections, settings) on an **active** workflow returned 200. `activeVersionId` and `versionId` stayed the same, so the live version was untouched. Only `updatedAt` and `versionCounter` (86→87) went up. Not tested: a PUT with actually changed content. |
| 3 | Execute Workflow target | Two forms, both seen. The old node (typeVersion 1) uses a plain string; typeVersion 1.1+ uses a resource locator `{__rl, mode: list/id, value}`. An expression `={{ $workflow.id }}` also occurs, which can't be resolved statically. The parameter is called `workflowId`. The target is an **ID**, with `cachedResultName` as the name. |
| 4 | `tags` filter | Expects the **name**: `?tags=vending@work` gave 2 results, the tag ID gave 0. |
| 5a | Pagination | `limit` plus `nextCursor` (base64); the top level is `{data, nextCursor}`. The list includes the full `nodes` and also `isArchived`. |
| 5b | CORS | The preflight returns 200 without `Access-Control-Allow-Origin`, so without host permission a fetch from the extension would be blocked. With host permission it should work, but only Chrome can confirm that. |
| 5c | Rate limit | 40 simultaneous requests gave no 429. The backoff stays in place, but it hasn't been needed. |

## Tested later (for last run and module management)

| Point | Result |
|-------|--------|
| `GET /executions` | 200, `{data, nextCursor}`. Per run: `id, status (success/error/…), mode, startedAt, stoppedAt, workflowId, finished`; no execution data. `?workflowId=<id>&limit=5` works. A global list of the 250 newest runs held only 7 different workflows, so the extension queries per workflow. |
| `POST /tags` | 201, `{id, name}`. Creates an (unused) tag: the basis for an empty module. |
| `PUT /workflows/{id}/tags` | 200, body `[{id}, …]`. **Replaces the whole tag list.** Doesn't change `versionId` or `active`. That's why the extension always sends the existing tags along. |
| `DELETE /tags/{id}` | 200. The tag is then gone from `GET /tags`. |
| Tag name limit | Not tested; n8n may have a maximum length. The extension shows n8n's error message. |

## Error details of a failed execution (tested 2026-11-26, read-only)

| Point | Result |
|-------|--------|
| `GET /executions?status=error` | 200; only failed executions. |
| `GET /executions/{id}` | 200; the same fields as in the list, **no error information**. |
| `GET /executions/{id}?includeData=true` | 200; adds `data` (`startData`, `resultData`, `executionData`) and `workflowData`. Size in the test: ~10 KB, but it contains all run data, so it can be much bigger. |
| `data.resultData` | `error`, `runData`, `pinData`, `lastNodeExecuted` (name of the node where it stopped). |
| `resultData.error`, simple error | `message`, `stack`, `level`, `tags`, `extra`, `shouldReport`. No `node`. Example: "Credentials could not be decrypted…". |
| `resultData.error`, `NodeApiError` | Also `name`, `description` (e.g. the response of the called API), `httpCode`, `node` (`name`, `type`), `context` (`itemIndex`, `request`), `messages`, `timestamp`, `functionality`. |
| `runData[node][i].error` | The same error, on the node that failed. |

The panel shows `message`, `description`, `httpCode`, the node (from `error.node`, else `lastNodeExecuted`) and the stack. It never shows `context`: `context.request` can contain request headers, which may hold credentials. It only fetches the data when you open the error of one execution, and keeps nothing else of it.

## Changes based on the spike
- `deps.js`: expression targets (`=...`) are ignored.
- Panel: archived workflows (`isArchived`) are hidden.
- The tags filter isn't used: we fetch everything and group by `mod:` ourselves.

## Incident during the spike
Test on a harmless test workflow, which was originally off. A bug in the spike script left it **active** after the PUT test (schedule every 5 minutes, POST to the dashboard). It was deactivated manually right away and checked (`active: false`), and the script was fixed. The workflow may have been on for about a minute; if needed, check the executions around 19:17 UTC.

### Second incident (tags)
During the tag test, my script set the tags of that workflow to `[]` afterwards, instead of back to the tags from before the test. In the meantime, the workflow had been given `mod:dashboard` (by the user, at 19:44 UTC). This was restored right away with `PUT ... [{id: "ipEvXbkUEnhA1ITe"}]` and checked. The temporary tag `mod:spike-tmp` was deleted.

Lesson: in tests, always read the original state and restore exactly that. Don't assume it.

## Still to do
- A PUT with changed content and `publishIfActive=false` (does the draft really leave the live version alone?). This is outside v1, which only uses activate/deactivate.
- Confirm in Chrome that fetching from the extension works with host permission.
