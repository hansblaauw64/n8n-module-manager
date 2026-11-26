// Pure: decide which open browser tabs show n8n pages affected by a status change.
// tabs: [{ id, url }], baseUrl: the instance URL, ids: changed workflow ids.
export function tabsToRefresh(tabs, baseUrl, ids) {
  let base;
  try { base = new URL(baseUrl); } catch { return []; }
  const prefix = base.pathname.replace(/\/+$/, '');
  const wanted = new Set(ids.map(String));
  const out = [];
  for (const t of tabs) {
    let u;
    try { u = new URL(t.url); } catch { continue; }
    if (u.origin !== base.origin || !u.pathname.startsWith(prefix)) continue;
    const rest = u.pathname.slice(prefix.length) || '/';
    const m = rest.match(/^\/workflow\/([^/]+)/);
    const isWorkflowList = rest === '/' || rest.startsWith('/home');
    if ((m && wanted.has(decodeURIComponent(m[1]))) || isWorkflowList) out.push(t.id);
  }
  return out;
}
