// Pure: list the trigger(s) of a workflow as short labels in the interface language. No chrome.* APIs.
import { describeSchedules } from './schedule.js';
import { t } from './i18n.js';

// Node type → message key (lib/messages.js).
const FIXED = {
  'n8n-nodes-base.manualTrigger': 'trg.manual',
  'n8n-nodes-base.start': 'trg.start',
  'n8n-nodes-base.executeWorkflowTrigger': 'trg.sub',
  'n8n-nodes-base.errorTrigger': 'trg.error',
  'n8n-nodes-base.formTrigger': 'trg.form',
  'n8n-nodes-base.emailReadImap': 'trg.imap',
  '@n8n/n8n-nodes-langchain.chatTrigger': 'trg.chat',
  '@n8n/n8n-nodes-langchain.mcpTrigger': 'trg.mcp',
  '@n8n/n8n-nodes-langchain.manualChatTrigger': 'trg.manualChat',
};

const SCHEDULE_TYPES = new Set(['n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.cron']);

function words(camel) {
  return camel.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

function webhookMethod(n) {
  const p = n.parameters || {};
  return Array.isArray(p.httpMethod) ? p.httpMethod.join('/') : p.httpMethod || 'GET';
}

function webhookLabel(n) {
  const path = n.parameters?.path ? '/' + String(n.parameters.path).replace(/^\/+/, '') : '';
  return `🪝 Webhook ${webhookMethod(n)}${path ? ' ' + path : ''}`;
}

/**
 * Production and test URL of a webhook node, or null when the path cannot be known up front
 * (an expression). With a route parameter in the path (":id") n8n puts the node's webhookId in front.
 */
export function webhookUrls(node, baseUrl) {
  const raw = node.parameters?.path;
  if (raw === undefined || raw === null || raw === '') {
    // No path set: n8n falls back to the node's webhookId.
    return node.webhookId ? build(baseUrl, String(node.webhookId)) : null;
  }
  const path = String(raw).replace(/^\/+/, '');
  if (path.startsWith('=') || path.includes('{{')) return null; // expression
  const dynamic = /(^|\/):/.test(path); // route parameter, e.g. users/:id
  return build(baseUrl, dynamic && node.webhookId ? `${node.webhookId}/${path}` : path);
}

function build(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return { url: `${base}/webhook/${path}`, testUrl: `${base}/webhook-test/${path}` };
}

/**
 * Trigger items for display: [{ text, copy? }]. `copy` ({url, testUrl}) is set for webhooks with a known URL;
 * `copyUnavailable` is set for webhooks whose path is an expression. Identical items are merged (×N).
 */
export function triggerItems(workflow, baseUrl = '') {
  const merged = new Map();
  const push = (key, item) => {
    const hit = merged.get(key);
    if (hit) hit.count++;
    else merged.set(key, { ...item, count: 1 });
  };
  for (const n of workflow.nodes || []) {
    if (n.disabled) continue;
    if (SCHEDULE_TYPES.has(n.type)) continue; // handled below, with their interval
    if (n.type === 'n8n-nodes-base.webhook') {
      const urls = webhookUrls(n, baseUrl);
      const text = webhookLabel(n);
      push(text + (urls?.url ?? ''), urls ? { text, copy: urls } : { text, copyUnavailable: true });
    } else if (FIXED[n.type]) {
      const text = t(FIXED[n.type]);
      push(text, { text });
    } else if (/Trigger$/.test(n.type || '')) {
      const text = t('trg.generic', { name: words(n.type.split('.').pop().replace(/Trigger$/, '')) });
      push(text, { text });
    }
  }
  const others = [...merged.values()].map(({ count, ...item }) => (count > 1 ? { ...item, text: `${item.text} ×${count}` } : item));
  const schedules = describeSchedules(workflow).map((s) => ({ text: `⏱ ${s}` }));
  return [...schedules, ...others];
}

const MANUAL_TYPES = new Set(['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.start']);
const isTriggerNode = (n) => SCHEDULE_TYPES.has(n.type) || n.type === 'n8n-nodes-base.webhook' || Boolean(FIXED[n.type]) || /Trigger$/.test(n.type || '');

/**
 * True when the only (enabled) trigger of a workflow is a manual one. n8n can't publish (activate) such a
 * workflow: there is nothing that would start it. Workflows without any trigger node return false (unknown).
 */
export function isManualOnly(workflow) {
  const triggers = (workflow?.nodes || []).filter((n) => !n.disabled && isTriggerNode(n));
  return triggers.length > 0 && triggers.every((n) => MANUAL_TYPES.has(n.type));
}

/** Readable trigger labels only (deduplicated, with ×N for repeats). Empty if there is no trigger node. */
export function describeTriggers(workflow) {
  return triggerItems(workflow).map((i) => i.text);
}
