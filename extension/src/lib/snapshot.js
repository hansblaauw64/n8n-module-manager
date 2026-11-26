// Pure snapshot (JSON export/import) helpers.
import { t } from './i18n.js';
import { normalizeUrl } from './n8n.js';

export function makeSnapshot(instanceUrl, workflows, now = new Date()) {
  return {
    version: 1,
    instance: instanceUrl,
    takenAt: now.toISOString(),
    workflows: workflows.map((w) => ({ id: String(w.id), name: w.name, active: Boolean(w.active) })),
  };
}

export function parseSnapshot(text) {
  const s = JSON.parse(text);
  if (!s || s.version !== 1 || !Array.isArray(s.workflows)) throw new Error(t('snap.invalid'));
  return s;
}

/** Throws unless the snapshot was taken on this instance: workflow ids can be the same on a copied instance. */
export function checkSnapshotInstance(snapshot, instanceUrl) {
  let from = '';
  try { from = normalizeUrl(snapshot.instance); } catch { /* no or broken address */ }
  if (!from) throw new Error(t('snap.noInstance'));
  if (from.toLowerCase() !== normalizeUrl(instanceUrl).toLowerCase()) throw new Error(t('snap.otherInstance', { from }));
}

export function desiredStates(snapshot, onlyIds) {
  const only = onlyIds ? new Set(onlyIds.map(String)) : null;
  const out = {};
  for (const w of snapshot.workflows) if (!only || only.has(w.id)) out[w.id] = w.active;
  return out;
}
