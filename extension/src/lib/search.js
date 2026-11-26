// Pure: full-text search inside workflows (name, tags, nodes). No chrome.* APIs.
// Searches node name, node type and node parameters. Never credentials or pinned data.
import { t } from './i18n.js';

const cache = new WeakMap();

function nodeText(n) {
  let params = '';
  try { params = JSON.stringify(n.parameters ?? {}); } catch { /* circular: ignore */ }
  return {
    name: String(n.name ?? '').toLowerCase(),
    type: String(n.type ?? '').toLowerCase(),
    params: params.toLowerCase(),
  };
}

function index(w) {
  let idx = cache.get(w);
  if (!idx) {
    idx = {
      head: [w.name, ...(w.tags || []).map((t) => (typeof t === 'string' ? t : t.name))].join(' ').toLowerCase(),
      nodes: (w.nodes || []).map((n) => ({ node: n.name, ...nodeText(n) })),
    };
    cache.set(w, idx);
  }
  return idx;
}

export function words(query) {
  return String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Returns null when the workflow does not match, else { inName, hits }.
 * Every word must occur somewhere in the workflow (name/tags/nodes).
 * hits = [{ node, where }] for nodes that match at least one word; where = name, type and/or settings, in the interface language.
 */
export function searchWorkflow(w, query) {
  const ws = words(query);
  if (!ws.length) return { inName: true, hits: [] };
  const idx = index(w);
  const hits = [];
  for (const n of idx.nodes) {
    const found = new Set();
    for (const word of ws) {
      if (n.name.includes(word)) found.add(t('search.name'));
      else if (n.type.includes(word)) found.add(t('search.type'));
      else if (n.params.includes(word)) found.add(t('search.params'));
    }
    if (found.size) hits.push({ node: n.node, where: [...found].join(', ') });
  }
  const haystack = idx.head + ' ' + idx.nodes.map((n) => `${n.name} ${n.type} ${n.params}`).join(' ');
  if (!ws.every((word) => haystack.includes(word))) return null;
  return { inName: ws.every((word) => idx.head.includes(word)), hits };
}
