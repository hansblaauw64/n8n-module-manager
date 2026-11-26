// Pure: summarize and describe executions of a workflow, in the interface language. No chrome.* APIs.
import { t } from './i18n.js';

const FAIL = new Set(['error', 'crashed']);
const RUNNING = new Set(['running', 'new', 'waiting']);

/** execs: executions of ONE workflow, newest first (as returned by GET /executions). */
export function summarizeRuns(execs) {
  if (!execs || !execs.length) return { kind: 'none' };
  const last = execs[0];
  const kind = last.status === 'success' ? 'ok' : FAIL.has(last.status) ? 'fail' : RUNNING.has(last.status) ? 'running' : 'other';
  return {
    kind,
    status: last.status,
    at: last.startedAt,
    mode: last.mode,
    recentFails: execs.filter((e) => FAIL.has(e.status)).length,
    sample: execs.length,
  };
}

/** Relative time ("zojuist", "5 min geleden" / "just now", "5 min ago"). */
export function relativeTime(iso, now = new Date()) {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const sec = Math.max(0, Math.round((now.getTime() - ms) / 1000));
  if (sec < 60) return t('rel.now');
  if (sec < 3600) return t('rel.min', { n: Math.floor(sec / 60) });
  if (sec < 86400) return t('rel.hour', { n: Math.floor(sec / 3600) });
  return t('rel.day', { n: Math.floor(sec / 86400) });
}

export function describeRun(sum, now = new Date()) {
  const when = relativeTime(sum.at, now);
  switch (sum.kind) {
    case 'none': return { cls: 'none', text: t('run.none') };
    case 'ok': return { cls: 'ok', text: t('run.ok', { when }) };
    case 'fail': {
      const more = sum.recentFails > 1 ? t('run.failMore', { n: sum.recentFails, of: sum.sample }) : '';
      return { cls: 'fail', text: t('run.fail', { when, more }) };
    }
    case 'running': return { cls: 'running', text: t('run.running', { when }) };
    default: return { cls: 'other', text: t('run.other', { status: sum.status, when }) };
  }
}

// ---- execution list for one workflow (the "This workflow" view) ----

const STATUS_CLASS = { success: 'ok', error: 'fail', crashed: 'fail', running: 'running', new: 'running', waiting: 'running', canceled: 'other' };

/** Display class and label of an execution status; unknown statuses are shown as they are. */
export function executionStatus(status) {
  if (STATUS_CLASS[status]) return { cls: STATUS_CLASS[status], label: t(`st.${status}`) };
  return { cls: 'other', label: status ? String(status) : t('st.unknown') };
}

/** Filter group of an execution: 'ok', 'fail', 'running' or 'other'. */
export const executionKind = (e) => executionStatus(e?.status).cls;

const MODES = new Set(['trigger', 'webhook', 'manual', 'retry', 'integrated', 'error', 'cli', 'internal', 'evaluation', 'chat']);

/** How the execution was started (unknown modes are shown as they are). */
export const modeLabel = (mode) => (MODES.has(mode) ? t(`mode.${mode}`) : mode ? String(mode) : '');

/** Duration between two ISO times: "0,4 s", "12 s", "3 min 5 s", "1 u 2 min" (English: "0.4 s", "1 h 2 min"). Empty if unknown. */
export function durationText(startIso, stopIso) {
  const a = new Date(startIso).getTime();
  const b = new Date(stopIso).getTime();
  if (!startIso || !stopIso || Number.isNaN(a) || Number.isNaN(b) || b < a) return '';
  const ms = b - a;
  if (ms < 10000) return t('dur.seconds', { n: (Math.round(ms / 100) / 10).toFixed(1).replace('.', t('decimal')) });
  const sec = Math.round(ms / 1000);
  if (sec < 60) return t('dur.seconds', { n: sec });
  if (sec < 3600) return sec % 60 ? t('dur.minSec', { m: Math.floor(sec / 60), s: sec % 60 }) : t('dur.min', { m: sec / 60 });
  const m = Math.round(sec / 60);
  return m % 60 ? t('dur.hourMin', { h: Math.floor(m / 60), m: m % 60 }) : t('dur.hour', { h: m / 60 });
}

/** Counts per filter group: { all, ok, fail, running, other }. */
export function countExecutions(execs) {
  const c = { all: 0, ok: 0, fail: 0, running: 0, other: 0 };
  for (const e of execs || []) {
    c.all++;
    c[executionKind(e)]++;
  }
  return c;
}

/** Link to an execution in the n8n editor: <base>/workflow/<workflowId>/executions/<executionId>. */
export const executionUrl = (base, workflowId, executionId) =>
  `${String(base).replace(/\/+$/, '')}/workflow/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(executionId)}`;

/**
 * The error of one execution fetched with includeData=true, reduced to what the panel shows:
 * { message, description, httpCode, node, nodeType, kind, stack } or null when the execution holds no error
 * (e.g. its data was pruned). Deliberately leaves out error.context: context.request can contain request
 * headers, which may hold credentials. Shapes seen in n8n: see docs/findings.md.
 */
export function executionError(execution) {
  const rd = execution?.data?.resultData;
  if (!rd) return null;
  let err = rd.error;
  let node = null;
  if (!err) {
    // No workflow-level error: take the first node that has one.
    for (const [name, runs] of Object.entries(rd.runData || {})) {
      const hit = (Array.isArray(runs) ? runs : []).find((r) => r?.error);
      if (hit) { err = hit.error; node = name; break; }
    }
  }
  if (!err || typeof err !== 'object') return null;
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  return {
    message: text(err.message) || text(err.name) || '',
    description: text(err.description),
    httpCode: err.httpCode != null && String(err.httpCode).trim() ? String(err.httpCode) : '',
    node: text(err.node?.name) || node || text(rd.lastNodeExecuted),
    nodeType: text(err.node?.type),
    kind: text(err.name),
    stack: text(err.stack),
  };
}
