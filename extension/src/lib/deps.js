// Pure dependency logic: no chrome.* APIs.
import { isManualOnly } from './triggers.js';
import { t } from './i18n.js';
const EXEC_TYPE = 'n8n-nodes-base.executeWorkflow';

/** Target workflow id of an Execute Workflow node, or null. Handles string and resource-locator shapes. */
export function targetId(node) {
  if (!node || node.type !== EXEC_TYPE || node.disabled) return null;
  const p = node.parameters || {};
  if (p.source && p.source !== 'database') return null;
  let w = p.workflowId;
  if (w && typeof w === 'object') w = w.value;
  if (typeof w === 'string' && w.startsWith('=')) return null; // expression, not resolvable statically
  return w ? String(w) : null;
}

/** Build call graph. Edges only to workflows that exist in the list. */
export function buildGraph(workflows) {
  const known = new Set(workflows.map((w) => String(w.id)));
  const calls = new Map();
  const calledBy = new Map();
  for (const w of workflows) {
    calls.set(String(w.id), new Set());
    calledBy.set(String(w.id), new Set());
  }
  for (const w of workflows) {
    const id = String(w.id);
    for (const n of w.nodes || []) {
      const t = targetId(n);
      if (t && known.has(t) && t !== id) {
        calls.get(id).add(t);
        calledBy.get(t).add(id);
      }
    }
  }
  return { calls, calledBy };
}

/**
 * Post-order DFS over `ids`: sub-flows come before their callers.
 * Returns { order, cycles } (cycles = arrays of ids).
 */
export function orderSubflowsFirst(ids, graph) {
  const set = new Set(ids.map(String));
  const state = new Map(); // 1 = visiting, 2 = done
  const order = [];
  const cycles = [];
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      cycles.push(stack.slice(stack.indexOf(id)).concat(id));
      return;
    }
    state.set(id, 1);
    stack.push(id);
    // Traverse through workflows outside the set too, so indirect dependencies keep their order.
    for (const c of graph.calls.get(id) || []) visit(c);
    stack.pop();
    state.set(id, 2);
    if (set.has(id)) order.push(id);
  };
  for (const id of set) visit(id);
  return { order, cycles };
}

/**
 * Plan publish/unpublish for a set of workflow ids.
 * action: 'publish' | 'unpublish'
 */
export function planAction(action, memberIds, workflows, graph) {
  const byId = new Map(workflows.map((w) => [String(w.id), w]));
  const members = new Set(memberIds.map(String));
  const { order, cycles } = orderSubflowsFirst([...members], graph);
  const warnings = cycles.map(
    (c) => t('plan.cycle', { path: c.map((id) => byId.get(id)?.name ?? id).join(' → ') }),
  );
  const wantActive = action === 'publish';
  const sequence = wantActive ? order : [...order].reverse(); // unpublish: callers first
  // A workflow with only a manual trigger can't be published: leave it out of a publish plan, with a note.
  const manual = wantActive ? sequence.filter((id) => !byId.get(id).active && isManualOnly(byId.get(id))) : [];
  for (const id of manual) warnings.push(t('plan.manualOnly', { name: byId.get(id).name }));
  const steps = sequence
    .filter((id) => Boolean(byId.get(id).active) !== wantActive && !manual.includes(id))
    .map((id) => ({ id, name: byId.get(id).name, action }));
  const changing = new Set(steps.map((s) => s.id));
  const name = (id) => byId.get(id)?.name ?? id;

  if (wantActive) {
    for (const id of members) {
      for (const c of graph.calls.get(id) || []) {
        const callee = byId.get(c);
        if (callee && !callee.active && !changing.has(c) && !isManualOnly(callee)) {
          warnings.push(t('plan.calleeOff', { caller: name(id), callee: name(c) }));
        }
      }
    }
  } else {
    for (const id of changing) {
      for (const caller of graph.calledBy.get(id) || []) {
        if (!changing.has(caller) && byId.get(caller)?.active) {
          warnings.push(t('plan.callerOn', { caller: name(caller), callee: name(id) }));
        }
      }
    }
  }
  return { steps, warnings };
}

/** Plan to restore a set of target states: deactivations (callers first) then activations (sub-flows first). */
export function planRestore(desired, workflows, graph) {
  const byId = new Map(workflows.map((w) => [String(w.id), w]));
  const toOn = [];
  const toOff = [];
  const warnings = [];
  for (const [id, active] of Object.entries(desired)) {
    const w = byId.get(String(id));
    if (!w || Boolean(w.active) === Boolean(active)) continue;
    if (active && isManualOnly(w)) { warnings.push(t('plan.manualOnly', { name: w.name })); continue; }
    (active ? toOn : toOff).push(String(id));
  }
  const off = orderSubflowsFirst(toOff, graph).order.reverse();
  const on = orderSubflowsFirst(toOn, graph).order;
  const steps = [
    ...off.map((id) => ({ id, name: byId.get(id).name, action: 'unpublish' })),
    ...on.map((id) => ({ id, name: byId.get(id).name, action: 'publish' })),
  ];
  return { steps, warnings };
}
