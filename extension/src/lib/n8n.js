// n8n public API client (/api/v1). Uses global fetch; no chrome.* APIs.
import { t } from './i18n.js';

export class N8nError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function normalizeUrl(input) {
  let u = String(input || '').trim();
  if (!u) throw new Error(t('api.noUrl'));
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const url = new URL(u);
  let path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return url.origin + path;
}

/** The API key may only travel over https; plain http is allowed for local development hosts only. */
export function isSecureUrl(input) {
  let u;
  try { u = new URL(normalizeUrl(input)); } catch { return false; }
  if (u.protocol === 'https:') return true;
  const h = u.hostname;
  return u.protocol === 'http:' && (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost'));
}

export function originOf(input) {
  return new URL(normalizeUrl(input)).origin;
}

export function createClient({ url, key }, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxRetries = 4 } = {}) {
  const base = normalizeUrl(url) + '/api/v1';

  async function request(path, { method = 'GET', body } = {}) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(base + path, {
          method,
          headers: { 'X-N8N-API-KEY': key, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new N8nError(t('api.unreachable'), 0);
      }
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep((retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt));
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new N8nError(t('api.badKey'), res.status);
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).message || ''; } catch { /* ignore */ }
        throw new N8nError(t('api.status', { status: res.status, detail: detail ? ': ' + detail : '' }), res.status);
      }
      return res.status === 204 ? null : res.json();
    }
  }

  return {
    base,
    async listWorkflows() {
      const all = [];
      let cursor = '';
      do {
        const page = await request(`/workflows?limit=250${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
        all.push(...(page.data || []));
        cursor = page.nextCursor || '';
      } while (cursor);
      return all;
    },
    /** Latest executions of one workflow, newest first (no execution data). */
    async lastExecutions(workflowId, limit = 5) {
      const page = await request(`/executions?workflowId=${encodeURIComponent(workflowId)}&limit=${limit}`);
      return page.data || [];
    },
    /** One page of executions of a workflow, newest first: { data, nextCursor }. No execution data. */
    async listExecutions(workflowId, { limit = 20, cursor = '' } = {}) {
      const page = await request(`/executions?workflowId=${encodeURIComponent(workflowId)}&limit=${limit}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
      return { data: page.data || [], nextCursor: page.nextCursor || '' };
    },
    /** One execution. With includeData it also has `data` (run data and the error); that can be large. */
    getExecution: (id, { includeData = false } = {}) => request(`/executions/${encodeURIComponent(id)}${includeData ? '?includeData=true' : ''}`),
    /** All tags of the instance (also unused ones). */
    async listTags() {
      const all = [];
      let cursor = '';
      do {
        const page = await request(`/tags?limit=250${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
        all.push(...(page.data || []));
        cursor = page.nextCursor || '';
      } while (cursor);
      return all;
    },
    createTag: (name) => request('/tags', { method: 'POST', body: { name } }),
    deleteTag: (id) => request(`/tags/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    /** Replace ALL tags of a workflow (the API replaces, so always pass the full list of tag ids). */
    setTags: (workflowId, tagIds) => request(`/workflows/${encodeURIComponent(workflowId)}/tags`, { method: 'PUT', body: tagIds.map((id) => ({ id })) }),
    async ping() {
      await request('/workflows?limit=1');
      return true;
    },
    publish: (id) => request(`/workflows/${encodeURIComponent(id)}/activate`, { method: 'POST' }),
    unpublish: (id) => request(`/workflows/${encodeURIComponent(id)}/deactivate`, { method: 'POST' }),
  };
}
