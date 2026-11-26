// Pure: which panel view fits the n8n page that is open in the tab. No DOM, no chrome.* APIs.
//
// n8n editor routes (relative to the instance URL, which may have a path prefix):
//   /workflow/<id>                    a workflow is open (also /workflow/<id>/executions/<execId>, ?query, #hash)
//   /workflow/new                     a new, unsaved workflow (no id yet)
//   /workflows, /home/workflows, /assistant, /projects/…, …   everything else: the module overview
import { normalizeUrl } from './n8n.js';

/**
 * @returns {{ view: 'workflow', id: string } | { view: 'new-workflow' } | { view: 'overview' } | null}
 *          null when the tab is not on this instance.
 */
export function routeOf(tabUrl, instanceUrl) {
  let tab, base;
  try {
    tab = new URL(tabUrl);
    base = new URL(normalizeUrl(instanceUrl));
  } catch {
    return null;
  }
  if (tab.origin !== base.origin) return null;
  const prefix = base.pathname.replace(/\/+$/, ''); // '' or e.g. '/n8n'
  let path = tab.pathname;
  if (prefix) {
    if (path !== prefix && !path.startsWith(prefix + '/')) return { view: 'overview' };
    path = path.slice(prefix.length);
  }
  const m = path.match(/^\/workflow\/([^/]+)/);
  if (!m) return { view: 'overview' };
  let id;
  try { id = decodeURIComponent(m[1]); } catch { return { view: 'overview' }; }
  if (id === 'new') return { view: 'new-workflow' };
  return { view: 'workflow', id };
}

/** Same page for the panel? (so a navigation inside the same workflow doesn't refetch) */
export const sameRoute = (a, b) => (a?.view ?? null) === (b?.view ?? null) && (a?.id ?? null) === (b?.id ?? null);
