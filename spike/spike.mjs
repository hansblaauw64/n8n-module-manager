// Phase 0 spike. Run: node --env-file=.env spike/spike.mjs   (TEST instance only)
import { writeFileSync } from 'node:fs';

const base = (process.env.N8N_URL || '').replace(/\/+$/, '').replace(/\/api\/v1$/, '') + '/api/v1';
const key = process.env.N8N_API_KEY;
const wid = process.env.SPIKE_WORKFLOW_ID;
if (!process.env.N8N_URL || process.env.N8N_URL.includes('example.com') || !key) {
  console.error('Vul N8N_URL en N8N_API_KEY in .env');
  process.exit(1);
}
const out = { n8nBase: base, at: new Date().toISOString() };

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'X-N8N-API-KEY': key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, headers: Object.fromEntries(res.headers), json };
}
const brief = (r) => ({ status: r.status, message: r.json?.message });

// --- 5a. Listing + pagination
const first = await call('/workflows?limit=2');
out.pagination = { status: first.status, count: first.json?.data?.length, nextCursor: first.json?.nextCursor ?? null, topLevelKeys: Object.keys(first.json || {}) };
const all = [];
let cursor = '';
do {
  const p = await call(`/workflows?limit=250${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
  if (p.status !== 200) { out.listError = brief(p); break; }
  all.push(...p.json.data);
  cursor = p.json.nextCursor || '';
} while (cursor);
out.workflowCount = all.length;
out.workflowKeys = all[0] ? Object.keys(all[0]) : [];
out.listIncludesNodes = Boolean(all[0]?.nodes);

// --- 4. tags filter: name or id?
const tagged = all.find((w) => w.tags?.length);
if (tagged) {
  const t = tagged.tags[0];
  const byName = await call('/workflows?tags=' + encodeURIComponent(t.name));
  const byId = await call('/workflows?tags=' + encodeURIComponent(t.id));
  out.tagsFilter = { tag: t, byName: { status: byName.status, n: byName.json?.data?.length }, byId: { status: byId.status, n: byId.json?.data?.length } };
} else out.tagsFilter = 'geen workflow met tags gevonden: maak er een aan (bv. mod:test) en draai opnieuw';

// --- 3. Execute Workflow node shape
const execNodes = all.flatMap((w) => (w.nodes || []).filter((n) => n.type === 'n8n-nodes-base.executeWorkflow').map((n) => ({ workflow: w.name, typeVersion: n.typeVersion, parameters: n.parameters, disabled: n.disabled })));
out.executeWorkflowNodes = execNodes.length ? execNodes.slice(0, 5) : 'geen Execute Workflow-node gevonden: maak er een aan en draai opnieuw';

// --- 1. activate / deactivate
if (wid) {
  const before = await call('/workflows/' + wid);
  const wasActive = before.json?.active;
  out.activation = { id: wid, wasActive, versionKeys: Object.keys(before.json || {}).filter((k) => /version|active/i.test(k)) };
  const off = await call(`/workflows/${wid}/deactivate`, { method: 'POST' });
  const afterOff = await call('/workflows/' + wid);
  const on = await call(`/workflows/${wid}/activate`, { method: 'POST' });
  const afterOn = await call('/workflows/' + wid);
  out.activation.steps = { deactivate: brief(off), activeAfterDeactivate: afterOff.json?.active, activate: brief(on), activeAfterActivate: afterOn.json?.active };
  if (!wasActive) await call(`/workflows/${wid}/deactivate`, { method: 'POST' }); // restore

  // --- 2. PUT with publishIfActive=false
  if (process.env.SPIKE_PUT === '1') {
    if (!wasActive) await call(`/workflows/${wid}/activate`, { method: 'POST' });
    const live = (await call('/workflows/' + wid)).json;
    const body = { name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {} };
    const put = await call(`/workflows/${wid}?publishIfActive=false`, { method: 'PUT', body });
    const after = (await call('/workflows/' + wid)).json;
    const pick = (w) => Object.fromEntries(Object.entries(w).filter(([k]) => /version|active|updatedAt/i.test(k)));
    out.putPublishIfActive = { put: brief(put), before: pick(live), after: pick(after), note: 'Live-versie ongemoeid als activeVersionId/versionId gelijk blijft en active true' };
    if (!wasActive) await call(`/workflows/${wid}/deactivate`, { method: 'POST' }); // restore original state
  }
} else out.activation = 'SPIKE_WORKFLOW_ID niet gezet: activate/deactivate en PUT niet getest';

// --- 5b. CORS preflight from an extension-like origin + rate limit burst
const pre = await fetch(base + '/workflows', { method: 'OPTIONS', headers: { Origin: 'chrome-extension://spike', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-n8n-api-key' } });
out.corsPreflight = { status: pre.status, allowOrigin: pre.headers.get('access-control-allow-origin'), note: 'Server-side CORS is alleen relevant zonder host-permission; echte check = panel in Chrome' };
const burst = await Promise.all(Array.from({ length: 40 }, () => call('/workflows?limit=1')));
out.rateLimit = { sent: 40, status429: burst.filter((r) => r.status === 429).length, retryAfter: burst.find((r) => r.status === 429)?.headers['retry-after'] ?? null };

writeFileSync(new URL('../docs/findings-raw.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
