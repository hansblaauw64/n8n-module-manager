// Pure grouping logic: module = tag "mod:<name>".
import { isManualOnly } from './triggers.js';

const PREFIX = 'mod:';

export function moduleNames(workflow) {
  return (workflow.tags || [])
    .map((t) => (typeof t === 'string' ? t : t.name) || '')
    .filter((n) => n.toLowerCase().startsWith(PREFIX))
    .map((n) => n.slice(PREFIX.length).trim())
    .filter(Boolean);
}

/** Tag objects that define modules: Map(moduleName -> tag {id,name}), taken from the workflows' own tags. */
export function moduleTagMap(workflows, allTags = []) {
  const map = new Map();
  const add = (t) => {
    if (typeof t === 'string' || !t.name || !t.name.toLowerCase().startsWith(PREFIX)) return;
    const name = t.name.slice(PREFIX.length).trim();
    if (name && !map.has(name)) map.set(name, t);
  };
  for (const w of workflows) (w.tags || []).forEach(add);
  allTags.forEach(add); // includes tags no workflow carries (empty modules)
  return map;
}

/**
 * New list of tag ids for moving a workflow between modules, keeping all other tags.
 * from/to: module names or null ("Zonder module"). Returns null when nothing changes.
 */
export function retag(workflow, from, to, tagMap) {
  const current = (workflow.tags || []).filter((t) => typeof t !== 'string');
  const fromName = from && from.toLowerCase();
  let tags = fromName ? current.filter((t) => !(t.name.toLowerCase().startsWith(PREFIX) && t.name.slice(PREFIX.length).trim().toLowerCase() === fromName)) : [...current];
  if (to) {
    const target = tagMap.get(to);
    if (!target) return null;
    if (!tags.some((t) => t.id === target.id)) tags = [...tags, target];
  }
  const same = tags.length === current.length && tags.every((t) => current.some((c) => c.id === t.id));
  return same ? null : tags.map((t) => t.id);
}

/** Tag ids with ALL mod: tags of the workflow replaced by the target module's tag (other tags kept). Null if unchanged. */
export function retagAll(workflow, to, tagMap) {
  const current = (workflow.tags || []).filter((t) => typeof t !== 'string');
  const target = tagMap.get(to);
  if (!target) return null;
  const tags = [...current.filter((t) => !t.name.toLowerCase().startsWith(PREFIX)), target];
  const same = tags.length === current.length && tags.every((t) => current.some((c) => c.id === t.id));
  return same ? null : tags.map((t) => t.id);
}

/**
 * Subflows (transitive callees) that should move along when `workflow` moves to module `to`.
 * Each item: { id, name, from: [current modules], tagIds, sharedBy: [names of other callers outside the moved set],
 * checked }. A subflow that other workflows outside the moved set also call is shared: listed but not pre-checked.
 * Subflows that are already only in the target module are skipped.
 */
export function planSubflowMoves(workflow, to, workflows, graph, tagMap) {
  const byId = new Map(workflows.map((w) => [String(w.id), w]));
  const root = String(workflow.id);
  const moved = new Set([root]);
  const order = [];
  const queue = [root];
  while (queue.length) {
    const id = queue.shift();
    for (const c of graph.calls.get(id) || []) {
      if (!moved.has(c)) { moved.add(c); order.push(c); queue.push(c); }
    }
  }
  const items = [];
  for (const id of order) {
    const w = byId.get(id);
    if (!w) continue;
    const from = moduleNames(w);
    if (from.length === 1 && from[0].toLowerCase() === to.toLowerCase()) continue;
    const tagIds = retagAll(w, to, tagMap);
    if (!tagIds) continue;
    const sharedBy = [...(graph.calledBy.get(id) || [])].filter((x) => !moved.has(x)).map((x) => byId.get(x)?.name).filter(Boolean);
    items.push({ id, name: w.name, from, tagIds, sharedBy, checked: sharedBy.length === 0 });
  }
  return items;
}

/** Sort modules by a saved order (array of names). Unknown modules go last, alphabetically. */
export function applyOrder(modules, order = []) {
  const idx = new Map(order.map((n, i) => [n, i]));
  return [...modules].sort((a, b) => {
    const ia = idx.has(a.name) ? idx.get(a.name) : Infinity;
    const ib = idx.has(b.name) ? idx.get(b.name) : Infinity;
    if (ia !== ib && !(ia === Infinity && ib === Infinity)) return ia - ib;
    return a.name.localeCompare(b.name);
  });
}

/** Move `name` before/after `targetName` in `names`; returns the new array. */
export function moveInOrder(names, name, targetName, before) {
  const rest = names.filter((n) => n !== name);
  const i = rest.indexOf(targetName);
  if (i < 0) return names;
  rest.splice(before ? i : i + 1, 0, name);
  return rest;
}

/** Names of modules that exist as a tag in n8n (mod:<naam>), also when no workflow uses them yet. */
export function tagModuleNames(tags = []) {
  return tags
    .map((t) => (typeof t === 'string' ? t : t.name) || '')
    .filter((n) => n.toLowerCase().startsWith(PREFIX))
    .map((n) => n.slice(PREFIX.length).trim())
    .filter(Boolean);
}

/** Does a module name clash (case-insensitive) with an existing one? Returns the existing name or null. */
export function findModuleName(name, existing) {
  const n = String(name).trim().toLowerCase();
  return [...existing].find((e) => e.toLowerCase() === n) ?? null;
}

export function groupByModule(workflows, tags = []) {
  const map = new Map();
  const unassigned = [];
  for (const w of workflows) {
    const names = moduleNames(w);
    if (!names.length) unassigned.push(w);
    for (const n of names) {
      if (!map.has(n)) map.set(n, []);
      map.get(n).push(w);
    }
  }
  for (const n of tagModuleNames(tags)) if (!map.has(n)) map.set(n, []); // empty modules
  const modules = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => {
      // Workflows with only a manual trigger can't be published, so they don't count towards on/off.
      const switchable = list.filter((w) => !isManualOnly(w));
      const active = switchable.filter((w) => w.active).length;
      const status = active === 0 ? 'off' : active === switchable.length ? 'on' : 'partial';
      return { name, workflows: list, active, switchable: switchable.length, manual: list.length - switchable.length, status };
    });
  return { modules, unassigned };
}
