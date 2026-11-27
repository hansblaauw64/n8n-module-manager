import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, planAction, planRestore, orderSubflowsFirst, targetId } from '../extension/src/lib/deps.js';
import { groupByModule, applyOrder, moveInOrder, moduleTagMap, retag, tagModuleNames, findModuleName, planSubflowMoves } from '../extension/src/lib/modules.js';
import { describeSchedules, cronToText } from '../extension/src/lib/schedule.js';
import { describeTriggers, triggerItems, webhookUrls, isManualOnly } from '../extension/src/lib/triggers.js';
import { envInfo } from '../extension/src/lib/env.js';
import { parseRss, isAllowedLink } from '../extension/src/lib/rss.js';
import { expandCron, ruleOccurrence, cronItemOccurrence, buildAgenda, weekDays, timeLabel } from '../extension/src/lib/agenda.js';
import { executionError } from '../extension/src/lib/executions.js';
import { summarizeRuns, describeRun, relativeTime, executionStatus, executionKind, modeLabel, durationText, countExecutions, executionUrl } from '../extension/src/lib/executions.js';
import { routeOf, sameRoute } from '../extension/src/lib/route.js';
import { readSettings, openLinkTitle, OPEN_LINKS, DEFAULT_SETTINGS } from '../extension/src/lib/settings.js';
import { t, setLanguage, resolveLanguage, getLanguage } from '../extension/src/lib/i18n.js';
import { MESSAGES } from '../extension/src/lib/messages.js';
import { describeInterval, describeCronItem } from '../extension/src/lib/schedule.js';
import { executionStatus as exStatus, durationText as durText, relativeTime as relTime } from '../extension/src/lib/executions.js';
import { searchWorkflow } from '../extension/src/lib/search.js';
import { tabsToRefresh } from '../extension/src/lib/tabs.js';
import { createClient, normalizeUrl, isSecureUrl } from '../extension/src/lib/n8n.js';

const exec = (id) => ({ type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { __rl: true, value: id, mode: 'id' } } });
const wf = (id, name, active, nodes = [], tags = []) => ({ id, name, active, nodes, tags: tags.map((name) => ({ name })) });
const wfs = [
  wf('1', 'main', false, [exec('2')], ['mod:crm']),
  wf('2', 'sub', false, [exec('3')], ['mod:crm']),
  wf('3', 'leaf', false, [], ['mod:crm']),
  wf('4', 'other', true, [exec('3')], []),
];

test('targetId handles string, locator, disabled', () => {
  assert.equal(targetId({ type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: '9' } }), '9');
  assert.equal(targetId(exec('5')), '5');
  assert.equal(targetId({ ...exec('5'), disabled: true }), null);
  assert.equal(targetId({ type: 'x' }), null);
});

test('publish: sub-flows first', () => {
  const g = buildGraph(wfs);
  const { steps } = planAction('publish', ['1', '2', '3'], wfs, g);
  assert.deepEqual(steps.map((s) => s.id), ['3', '2', '1']);
});

test('unpublish: callers first, warns about outside callers', () => {
  const act = wfs.map((w) => ({ ...w, active: true }));
  const g = buildGraph(act);
  const { steps, warnings } = planAction('unpublish', ['1', '2', '3'], act, g);
  assert.deepEqual(steps.map((s) => s.id), ['1', '2', '3']);
  assert.ok(warnings.some((w) => w.includes('other')));
});

test('publish also publishes unpublished sub-workflows, sub-flows first', () => {
  // n8n refuses to publish a workflow whose sub-workflow isn't published (docs/findings.md).
  const list = [wf('1', 'a', false, [exec('2')], ['mod:x']), wf('2', 'b', false, [exec('3')]), wf('3', 'c', false), wf('4', 'd', true, [exec('3')])];
  const { steps, warnings } = planAction('publish', ['1'], list, buildGraph(list));
  assert.deepEqual(steps.map((s) => [s.id, s.action]), [['3', 'publish'], ['2', 'publish'], ['1', 'publish']]);
  assert.equal(warnings.length, 2); // one note per added sub-workflow
  assert.ok(warnings.some((w) => w.includes('"b"') && w.includes('"a"')));
  assert.ok(warnings.some((w) => w.includes('"c"') && w.includes('"b"')));
  // an already published sub-workflow is not added
  const on = list.map((w) => (w.id === '2' || w.id === '3' ? { ...w, active: true } : w));
  const p2 = planAction('publish', ['1'], on, buildGraph(on));
  assert.deepEqual(p2.steps.map((s) => s.id), ['1']);
  assert.equal(p2.warnings.length, 0);
  // unpublish never adds anything
  const act = list.map((w) => ({ ...w, active: true }));
  assert.deepEqual(planAction('unpublish', ['1'], act, buildGraph(act)).steps.map((s) => s.id), ['1']);
});

test('cycles detected', () => {
  const list = [wf('1', 'a', false, [exec('2')]), wf('2', 'b', false, [exec('1')])];
  assert.equal(orderSubflowsFirst(['1', '2'], buildGraph(list)).cycles.length, 1);
});

test('restore order', () => {
  const g = buildGraph(wfs);
  const { steps } = planRestore({ '1': true, '3': true }, wfs, g);
  assert.deepEqual(steps.map((s) => s.id), ['3', '1']);
});

test('groupByModule', () => {
  const { modules, unassigned } = groupByModule(wfs);
  assert.equal(modules.length, 1);
  assert.equal(modules[0].name, 'crm');
  assert.equal(modules[0].status, 'off');
  assert.equal(unassigned.length, 1);
});

test('describeSchedules', () => {
  const sched = (rule) => ({ nodes: [{ type: 'n8n-nodes-base.scheduleTrigger', parameters: { rule: { interval: [rule] } } }] });
  assert.deepEqual(describeSchedules(sched({ field: 'minutes' })), ['elke 5 minuten']);
  assert.deepEqual(describeSchedules(sched({ field: 'minutes', minutesInterval: 1 })), ['elke minuut']);
  assert.deepEqual(describeSchedules(sched({ field: 'hours', hoursInterval: 2, triggerAtMinute: 15 })), ['elke 2 uur op minuut 15']);
  assert.deepEqual(describeSchedules(sched({ field: 'days', triggerAtHour: 8 })), ['dagelijks om 08:00']);
  assert.deepEqual(describeSchedules(sched({ field: 'weeks', triggerAtDay: [1, 5], triggerAtHour: 9 })), ['wekelijks op maandag, vrijdag om 09:00']);
  assert.deepEqual(describeSchedules(sched({ field: 'cronExpression', expression: '0 7 * * *' })), ['om 07:00 (cron 0 7 * * *)']);
  // Shapes found in a real instance: n8n omits defaults, so "field" is often missing (default = days).
  assert.deepEqual(describeSchedules(sched({})), ['dagelijks om 00:00']);
  assert.deepEqual(describeSchedules(sched({ triggerAtHour: 14 })), ['dagelijks om 14:00']);
  assert.deepEqual(describeSchedules(sched({ triggerAtHour: 9, triggerAtMinute: 30 })), ['dagelijks om 09:30']);
  assert.deepEqual(describeSchedules(sched({ triggerAtMinute: 55 })), ['dagelijks om 00:55']);
  assert.deepEqual(describeSchedules(sched({ field: 'hours' })), ['elk uur op het hele uur']);
  assert.deepEqual(describeSchedules(sched({ field: 'seconds', secondsInterval: 2 })), ['elke 2 seconden']);
  assert.deepEqual(describeSchedules({ nodes: [{ type: 'n8n-nodes-base.scheduleTrigger', parameters: { rule: { interval: [{}, {}] } } }] }), ['dagelijks om 00:00 ×2']);
  assert.deepEqual(describeSchedules({ nodes: [{ type: 'n8n-nodes-base.scheduleTrigger', parameters: { rule: { interval: [{ triggerAtHour: 16 }, { triggerAtHour: 16, triggerAtMinute: 5 }] } } }] }), ['dagelijks om 16:00', 'dagelijks om 16:05']);
  assert.deepEqual(describeSchedules({ nodes: [{ type: 'n8n-nodes-base.scheduleTrigger', parameters: {} }] }), ['schema (niet uit te lezen)']);
  // Legacy Cron node, default unit is minutes
  assert.deepEqual(describeSchedules({ nodes: [{ type: 'n8n-nodes-base.cron', parameters: { triggerTimes: { item: [{ mode: 'everyX', value: 12 }] } } }] }), ['elke 12 minuten']);
  assert.deepEqual(describeSchedules({ nodes: [{ type: 'n8n-nodes-base.scheduleTrigger', disabled: true, parameters: {} }] }), []);
  assert.deepEqual(describeSchedules({ nodes: [] }), []);
});

test('searchWorkflow', () => {
  const w = wf('9', 'Dashboard sync', false, [
    { name: 'Stuur naar dashboard', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'https://api.example.com/update' } },
    { name: 'Code', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return items' }, credentials: { x: { name: 'geheimekey' } } },
  ], ['mod:crm']);
  assert.ok(searchWorkflow(w, ''));
  assert.equal(searchWorkflow(w, 'dashboard sync').inName, true);
  const r = searchWorkflow(w, 'example.com');
  assert.equal(r.inName, false);
  assert.deepEqual(r.hits, [{ node: 'Stuur naar dashboard', where: 'instellingen' }]);
  assert.equal(searchWorkflow(w, 'httprequest').hits[0].where, 'type');
  assert.ok(searchWorkflow(w, 'crm'));
  assert.ok(searchWorkflow(w, 'jscode items'));
  assert.equal(searchWorkflow(w, 'geheimekey'), null); // credentials are not searched
  assert.equal(searchWorkflow(w, 'dashboard nietbestaand'), null);
});

test('tabsToRefresh', () => {
  const tabs = [
    { id: 1, url: 'https://n8n.x.io/workflow/abc' },
    { id: 2, url: 'https://n8n.x.io/workflow/other' },
    { id: 3, url: 'https://n8n.x.io/home/workflows' },
    { id: 4, url: 'https://elders.nl/workflow/abc' },
    { id: 5, url: 'https://n8n.x.io/workflow/abc/executions' },
    { id: 6, url: 'chrome://extensions' },
    { id: 7, url: 'https://n8n.x.io/settings/api' },
  ];
  assert.deepEqual(tabsToRefresh(tabs, 'https://n8n.x.io', ['abc']), [1, 3, 5]);
  assert.deepEqual(tabsToRefresh([{ id: 1, url: 'https://h.io/n8n/workflow/abc' }, { id: 2, url: 'https://h.io/andere/workflow/abc' }], 'https://h.io/n8n', ['abc']), [1]);
  assert.deepEqual(tabsToRefresh(tabs, 'geen url', ['abc']), []);
});

test('applyOrder and moveInOrder', () => {
  const mods = ['a', 'b', 'c', 'd'].map((name) => ({ name }));
  assert.deepEqual(applyOrder(mods, ['c', 'a']).map((m) => m.name), ['c', 'a', 'b', 'd']);
  assert.deepEqual(applyOrder(mods, []).map((m) => m.name), ['a', 'b', 'c', 'd']);
  assert.deepEqual(applyOrder(mods, ['x', 'd']).map((m) => m.name), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveInOrder(['a', 'b', 'c'], 'c', 'a', true), ['c', 'a', 'b']);
  assert.deepEqual(moveInOrder(['a', 'b', 'c'], 'a', 'c', false), ['b', 'c', 'a']);
  assert.deepEqual(moveInOrder(['a', 'b'], 'a', 'nope', true), ['a', 'b']);
});

test('cronToText', () => {
  assert.equal(cronToText('*/2 0-6 * * *'), 'elke 2 min tussen 00:00 en 06:59');
  assert.equal(cronToText('*/4 7-17 * * *'), 'elke 4 min tussen 07:00 en 17:59');
  assert.equal(cronToText('* * * * *'), 'elke minuut');
  assert.equal(cronToText('*/15 * * * *'), 'elke 15 min');
  assert.equal(cronToText('30 * * * *'), 'elk uur op minuut 30');
  assert.equal(cronToText('0 */6 * * *'), 'elke 6 uur op het hele uur');
  assert.equal(cronToText('0 8,12,17 * * *'), 'om 08:00, 12:00, 17:00');
  assert.equal(cronToText('0 9 * * 1-5'), 'om 09:00 van maandag t/m vrijdag');
  assert.equal(cronToText('0 9 * * 1,3'), 'om 09:00 op maandag, woensdag');
  assert.equal(cronToText('0 6 1 * *'), 'om 06:00 op dag 1 van de maand');
  assert.equal(cronToText('0 0 0 1 * *'), null); // 6 fields: not understood
  assert.equal(cronToText('0 0 * JAN *'), null);
  assert.equal(cronToText('={{ $json.cron }}'), null);
  assert.equal(cronToText(''), null);
});

test('describeTriggers', () => {
  const n = (type, parameters = {}, extra = {}) => ({ type, parameters, ...extra });
  const w = { nodes: [
    n('n8n-nodes-base.webhook', { httpMethod: 'POST', path: 'orders' }),
    n('n8n-nodes-base.webhook', { path: '/status' }),
    n('n8n-nodes-base.scheduleTrigger', { rule: { interval: [{ field: 'hours', hoursInterval: 2 }] } }),
    n('n8n-nodes-base.manualTrigger'),
    n('n8n-nodes-base.gmailTrigger'),
    n('n8n-nodes-base.googleSheetsTrigger'),
    n('n8n-nodes-base.executeWorkflowTrigger'),
    n('n8n-nodes-base.slackTrigger', {}, { disabled: true }),
    n('n8n-nodes-base.set'),
  ] };
  assert.deepEqual(describeTriggers(w), [
    '⏱ elke 2 uur op het hele uur',
    '🪝 Webhook POST /orders',
    '🪝 Webhook GET /status',
    '🖐 Handmatig',
    '⚡ Gmail-trigger',
    '⚡ Google Sheets-trigger',
    '↪ Subworkflow (aangeroepen door een andere workflow)',
  ]);
  assert.deepEqual(describeTriggers({ nodes: [n('n8n-nodes-base.webhook', { path: 'a' }), n('n8n-nodes-base.webhook', { path: 'a' })] }), ['🪝 Webhook GET /a ×2']);
  assert.deepEqual(describeTriggers({ nodes: [n('n8n-nodes-base.set')] }), []);
});

test('summarizeRuns / describeRun', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  const ex = (status, iso) => ({ status, startedAt: iso, mode: 'trigger' });
  assert.equal(summarizeRuns([]).kind, 'none');
  assert.equal(describeRun(summarizeRuns([]), now).text, 'nog niet gedraaid');
  const ok = summarizeRuns([ex('success', '2026-11-23T09:00:00Z'), ex('error', '2026-11-22T09:00:00Z')]);
  assert.equal(ok.kind, 'ok');
  assert.equal(describeRun(ok, now).text, 'laatste run geslaagd · 3 u geleden');
  const bad = summarizeRuns([ex('error', '2026-11-23T11:55:00Z'), ex('crashed', '2026-11-23T11:00:00Z'), ex('success', '2026-11-22T00:00:00Z')]);
  assert.equal(bad.kind, 'fail');
  assert.equal(describeRun(bad, now).text, 'laatste run mislukt · 5 min geleden (2 van laatste 3 mislukt)');
  assert.equal(summarizeRuns([ex('running', '2026-11-23T11:59:59Z')]).kind, 'running');
  assert.equal(relativeTime('2026-11-20T12:00:00Z', now), '3 d geleden');
});

test('retag keeps other tags and moves between modules', () => {
  const crm = { id: 't1', name: 'mod:crm' }, mail = { id: 't2', name: 'mod:mail' }, other = { id: 't3', name: 'vending@work' };
  const all = [{ tags: [crm, other] }, { tags: [mail] }];
  const map = moduleTagMap(all);
  assert.equal(map.get('crm').id, 't1');
  const w = { tags: [crm, other] };
  assert.deepEqual(retag(w, 'crm', 'mail', map), ['t3', 't2']); // moved, other tag kept
  assert.deepEqual(retag(w, 'crm', null, map), ['t3']); // out of every module
  assert.deepEqual(retag({ tags: [other] }, null, 'crm', map), ['t3', 't1']); // into a module
  assert.equal(retag(w, 'crm', 'crm', map), null); // same module: nothing to do
  assert.equal(retag(w, 'crm', 'bestaatniet', map), null); // unknown target tag
  assert.deepEqual(retag({ tags: [crm, mail] }, 'crm', 'mail', map), ['t2']); // already in target: just remove source
});

test('empty modules come from tags', () => {
  const tags = [{ id: 't1', name: 'mod:crm' }, { id: 't9', name: 'mod:leeg' }, { id: 't5', name: 'andere' }];
  const { modules } = groupByModule([{ id: '1', name: 'a', active: true, tags: [tags[0]] }], tags);
  assert.deepEqual(modules.map((m) => [m.name, m.workflows.length, m.status]), [['crm', 1, 'on'], ['leeg', 0, 'off']]);
  assert.equal(moduleTagMap([], tags).get('leeg').id, 't9');
  assert.equal(tagModuleNames(tags).length, 2);
  assert.equal(findModuleName(' LEEG ', ['crm', 'leeg']), 'leeg');
  assert.equal(findModuleName('nieuw', ['crm']), null);
  // an empty module can receive a workflow
  assert.deepEqual(retag({ tags: [] }, null, 'leeg', moduleTagMap([], tags)), ['t9']);
});

test('webhookUrls and triggerItems', () => {
  const hook = (parameters, extra = {}) => ({ type: 'n8n-nodes-base.webhook', parameters, ...extra });
  const base = 'https://n8n.x.io/';
  assert.deepEqual(webhookUrls(hook({ path: 'orders' }), base), { url: 'https://n8n.x.io/webhook/orders', testUrl: 'https://n8n.x.io/webhook-test/orders' });
  assert.equal(webhookUrls(hook({ path: '/status' }), base).url, 'https://n8n.x.io/webhook/status'); // leading slash stripped
  assert.equal(webhookUrls(hook({ path: 'users/:id' }, { webhookId: 'abc-1' }), base).url, 'https://n8n.x.io/webhook/abc-1/users/:id'); // route parameter
  assert.equal(webhookUrls(hook({ path: '' }, { webhookId: 'abc-1' }), base).url, 'https://n8n.x.io/webhook/abc-1'); // no path: webhookId
  assert.equal(webhookUrls(hook({ path: '={{ $json.p }}' }), base), null); // expression
  assert.equal(webhookUrls(hook({}), base), null);
  const items = triggerItems({ nodes: [hook({ path: 'a', httpMethod: 'POST' }), hook({ path: 'a', httpMethod: 'POST' }), hook({ path: '=x' })] }, base);
  assert.equal(items[0].text, '🪝 Webhook POST /a ×2');
  assert.equal(items[0].copy.url, 'https://n8n.x.io/webhook/a');
  assert.equal(items[1].copyUnavailable, true);
  assert.equal(items.length, 2);
});

test('parseRss', () => {
  const xml = `<?xml version="1.0"?><rss><channel><title>x</title><item>
    <title>Tip &amp; trucks: Bruno&apos;s gids</title><link>https://things.io/posts/a/</link>
    <description>Eerste &lt;b&gt;tip&lt;/b&gt; met &#233; en &#x41;</description><category>API&apos;s</category></item>
    <item><title>Zonder beschrijving</title><link>https://things.io/posts/b/</link></item>
    <item><title>Vreemde link</title><link>https://evil.example/x</link><description>nee</description></item>
    <item><title>Javascript link</title><link>javascript:alert(1)</link></item>
    <item><title></title><link>https://things.io/posts/c/</link></item>
    <item><title><![CDATA[Met CDATA]]></title><link>https://things.io/posts/d/</link><description>d</description></item>
  </channel></rss>`;
  const items = parseRss(xml);
  assert.deepEqual(items.map((i) => i.title), ["Tip & trucks: Bruno's gids", 'Zonder beschrijving', 'Vreemde link', 'Met CDATA']); // non-https links and empty titles dropped
  assert.equal(items[0].description, 'Eerste tip met é en A'); // entities decoded, markup stripped
  assert.equal(items[0].category, "API's");
  assert.equal(items[1].description, '');
  assert.equal(parseRss(xml, 1).length, 1);
  assert.deepEqual(parseRss('geen xml'), []);
  const ok = (u) => isAllowedLink(u, 'things.io');
  assert.equal(ok('https://things.io/x'), true);
  assert.equal(ok('https://www.things.io/x'), true);
  assert.equal(ok('http://things.io/x'), false);
  assert.equal(ok('https://things.io.evil.com/x'), false);
  assert.equal(ok('https://evilthings.io/x'), false);
  assert.equal(ok('https://evil.example/x'), false);
  assert.equal(isAllowedLink('https://things.io/x', ''), false); // no host configured: nothing allowed
  assert.equal(isAllowedLink('https://blog.example.com/x', 'example.com'), true);
});

test('agenda: expandCron and rule placement', () => {
  const tue = new Date(2026, 10, 24, 12); // Tuesday 24 Nov 2026
  assert.deepEqual(expandCron('0 14 * * *').hours, [14]);
  assert.deepEqual(expandCron('*/15 8-9 * * 1-5').minutes, [0, 15, 30, 45]);
  assert.deepEqual(expandCron('0 8-18/5 * * *').hours, [8, 13, 18]);
  assert.deepEqual(expandCron('0 0 * * 7').dows, [0]); // 7 = Sunday
  assert.equal(expandCron('0 0 * JAN *'), null);
  assert.equal(expandCron('0 0 0 1 * *'), null);
  assert.equal(expandCron('0 61 * * *'), null);
  const occ = (rule, d = tue) => ruleOccurrence(rule, d);
  assert.deepEqual(occ({ triggerAtHour: 14 }), { kind: 'fixed', times: [840] }); // field omitted = days
  assert.deepEqual(occ({}), { kind: 'fixed', times: [0] });
  assert.equal(occ({ field: 'minutes' }).kind, 'continuous');
  assert.equal(occ({ field: 'seconds' }).kind, 'continuous');
  assert.deepEqual(occ({ field: 'hours' }), { kind: 'recurring', minute: 0, hours: Array.from({ length: 24 }, (_, h) => h) });
  assert.deepEqual(occ({ field: 'hours', hoursInterval: 6, triggerAtMinute: 30 }), { kind: 'fixed', times: [30, 390, 750, 1110] });
  assert.equal(occ({ field: 'weeks', triggerAtDay: [2], triggerAtHour: 9 }).kind, 'fixed'); // Tuesday
  assert.equal(occ({ field: 'weeks', triggerAtDay: [1], triggerAtHour: 9 }).kind, 'none'); // Monday only
  assert.equal(occ({ field: 'months', triggerAtDayOfMonth: 24 }).kind, 'fixed');
  assert.equal(occ({ field: 'months', triggerAtDayOfMonth: 1 }).kind, 'none');
  assert.equal(occ({ field: 'days', daysInterval: 2, triggerAtHour: 8 }).kind, 'none'); // days 1,3,5..: the 24th is not one of them
  assert.equal(occ({ field: 'days', daysInterval: 2, triggerAtHour: 8 }, new Date(2026, 10, 25, 12)).kind, 'fixed');
  assert.equal(occ({ field: 'cronExpression', expression: '*/2 0-6 * * *' }).kind, 'continuous');
  assert.deepEqual(occ({ field: 'cronExpression', expression: '0 7,19 * * *' }), { kind: 'fixed', times: [420, 1140] });
  assert.equal(occ({ field: 'cronExpression', expression: '0 7 * * 1' }).kind, 'none'); // Monday only
  assert.equal(occ({ field: 'cronExpression', expression: '={{ x }}' }).kind, 'unknown');
  assert.equal(occ({ field: 'wat' }).kind, 'unknown');
  assert.deepEqual(cronItemOccurrence({ mode: 'everyDay', hour: 8, minute: 15 }, tue), { kind: 'fixed', times: [495] });
  assert.equal(cronItemOccurrence({ mode: 'everyX', value: 12 }, tue).kind, 'continuous');
  assert.equal(cronItemOccurrence({ mode: 'everyHour', minute: 5 }, tue).kind, 'recurring');
});

test('agenda: buildAgenda groups per hour and flags simultaneous runs', () => {
  const tue = new Date(2026, 10, 24, 12);
  const sched = (id, name, active, ...rules) => ({ id, name, active, nodes: [{ type: 'n8n-nodes-base.scheduleTrigger', parameters: { rule: { interval: rules } } }] });
  const wfs = [
    sched('a', 'A daily 14:00', true, { triggerAtHour: 14 }),
    sched('b', 'B daily 14:00', true, { triggerAtHour: 14 }),
    sched('c', 'C daily 14:05', false, { triggerAtHour: 14, triggerAtMinute: 5 }),
    sched('d', 'D hourly', true, { field: 'hours' }),
    sched('e', 'E every 5 min', true, { field: 'minutes' }),
    sched('f', 'F monday only', true, { field: 'weeks', triggerAtDay: [1], triggerAtHour: 9 }),
    sched('g', 'G bad cron', true, { field: 'cronExpression', expression: '={{x}}' }),
    sched('h', 'H twice same time', true, { triggerAtHour: 3 }, { triggerAtHour: 3 }),
    { id: 'z', name: 'no schedule', active: true, nodes: [{ type: 'n8n-nodes-base.webhook', parameters: {} }] },
  ];
  const ag = buildAgenda(wfs, tue);
  assert.deepEqual(ag.slots.map((s) => timeLabel(s.t)), ['03:00', '14:00', '14:05']);
  const s1400 = ag.slots.find((s) => s.t === 840);
  assert.equal(s1400.multi, true);
  assert.deepEqual(s1400.entries.map((e) => e.wf.id), ['a', 'b', 'd']); // hourly D runs at 14:00 too
  assert.equal(s1400.entries.find((e) => e.wf.id === 'd').recurring, true);
  assert.deepEqual(ag.slots.find((s) => s.t === 180).entries.map((e) => e.wf.id), ['d', 'h']); // H twice at 03:00 = one entry; hourly D coincides
  assert.equal(ag.slots.find((s) => s.t === 180).multi, true);
  assert.deepEqual(ag.hours.map((h) => h.hour), [3, 14]);
  assert.equal(ag.heat[14], 4);
  assert.equal(ag.collisions, 2); // 03:00 (H + hourly D) and 14:00
  assert.equal(s1400.activeCount, 3);
  assert.equal(ag.slots.find((s) => s.t === 845).activeCount, 0); // C is switched off
  assert.equal(ag.activeCollisions, 2);
  assert.deepEqual(ag.recurring.map((r) => r.wf.id), ['d']);
  assert.deepEqual(ag.continuous.map((r) => r.wf.id), ['e']);
  assert.deepEqual(ag.unknown.map((r) => r.wf.id), ['g']);
  assert.equal(ag.workflowCount, 8); // incl. F: it has a schedule, only not today
  assert.equal(ag.slots.some((s) => s.entries.some((e) => e.wf.id === 'f')), false);
  // only active
  const act = buildAgenda(wfs, tue, { onlyActive: true });
  assert.equal(act.slots.find((s) => s.t === 845), undefined);
  // Monday shows F
  const mon = buildAgenda(wfs, new Date(2026, 10, 23, 12));
  assert.ok(mon.slots.some((s) => s.t === 540 && s.entries.some((e) => e.wf.id === 'f')));
  // only exact times: no hourly, continuous or unreadable schedules
  const ex = buildAgenda(wfs, tue, { exactOnly: true });
  assert.deepEqual(ex.slots.map((s) => timeLabel(s.t)), ['03:00', '14:00', '14:05']);
  assert.deepEqual(ex.slots.find((s) => s.t === 840).entries.map((e) => e.wf.id), ['a', 'b']); // hourly D left out
  assert.equal(ex.slots.find((s) => s.t === 180).multi, false);
  assert.deepEqual([ex.recurring.length, ex.continuous.length, ex.unknown.length], [0, 0, 0]);
  assert.equal(ex.workflowCount, 5); // A, B, C, F (not today), H
  const exCron = buildAgenda([sched('k', 'K cron 9 and 17', true, { field: 'cronExpression', expression: '0 9,17 * * *' }), sched('l', 'L every 6h', true, { field: 'hours', hoursInterval: 6 })], tue, { exactOnly: true });
  assert.deepEqual(exCron.slots.map((s) => s.entries[0].wf.id), ['k', 'k']);
});

test('weekDays: Monday first, marks today', () => {
  const days = weekDays(new Date(2026, 10, 25, 9)); // Wednesday
  assert.deepEqual(days.map((d) => d.label), ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']);
  assert.deepEqual(days.map((d) => d.date.getDate()), [23, 24, 25, 26, 27, 28, 29]);
  assert.equal(days.filter((d) => d.isToday).length, 1);
  assert.equal(days[2].isToday, true);
  assert.equal(days[6].weekday, 0); // Sunday
});

test('envInfo', () => {
  assert.equal(envInfo('productie').color, 'var(--color-brand)'); // brand color from brand/brand.css
  assert.equal(envInfo('test').label, 'Test');
  assert.equal(envInfo('productie').solid, true); // only production is a solid badge
  assert.equal(envInfo('test').solid, false);
  assert.equal(envInfo('acceptatie').solid, false);
  assert.equal(envInfo('').color, null);
  assert.equal(envInfo(undefined).label, 'Geen label');
  assert.equal(envInfo('onbekend').color, null);
});

test('planSubflowMoves: subflows move along, shared ones are not pre-checked', () => {
  const tx = { id: 'tx', name: 'mod:x' }, ty = { id: 'ty', name: 'mod:y' }, other = { id: 'to', name: 'vending@work' };
  const call = (id) => ({ type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: id } });
  const wfs = [
    { id: 'A', name: 'A', active: true, tags: [], nodes: [call('B')] },
    { id: 'B', name: 'B', active: true, tags: [other], nodes: [call('C')] },
    { id: 'C', name: 'C', active: true, tags: [tx], nodes: [] },
    { id: 'D', name: 'D', active: true, tags: [], nodes: [call('C'), call('E')] },
    { id: 'E', name: 'E', active: true, tags: [ty], nodes: [] },
  ];
  const map = moduleTagMap(wfs);
  const items = planSubflowMoves(wfs[0], 'y', wfs, buildGraph(wfs), map);
  assert.deepEqual(items.map((i) => i.id), ['B', 'C']); // E is not a subflow of A
  const b = items.find((i) => i.id === 'B'), c = items.find((i) => i.id === 'C');
  assert.deepEqual(b.tagIds, ['to', 'ty']); // other tag kept, module tag added
  assert.equal(b.checked, true);
  assert.deepEqual(c.tagIds, ['ty']); // old module tag replaced
  assert.deepEqual(c.from, ['x']);
  assert.deepEqual(c.sharedBy, ['D']); // D also calls C
  assert.equal(c.checked, false);
  // already in the target module: skipped
  const again = planSubflowMoves(wfs[3], 'y', wfs, buildGraph(wfs), map).map((i) => i.id);
  assert.deepEqual(again, ['C']); // E already only in y
  // cycle does not hang
  const cyc = [{ id: '1', name: '1', tags: [], nodes: [call('2')] }, { id: '2', name: '2', tags: [], nodes: [call('1')] }, { id: '3', name: '3', tags: [ty], nodes: [] }];
  assert.deepEqual(planSubflowMoves(cyc[0], 'y', cyc, buildGraph(cyc), moduleTagMap(cyc)).map((i) => i.id), ['2']);
});

test('isSecureUrl: https only, http just for local hosts', () => {
  assert.equal(isSecureUrl('https://n8n.example.com'), true);
  assert.equal(isSecureUrl('n8n.example.com'), true); // no scheme -> https
  assert.equal(isSecureUrl('http://n8n.example.com'), false);
  assert.equal(isSecureUrl('http://localhost:5678'), true);
  assert.equal(isSecureUrl('http://127.0.0.1:5678'), true);
  assert.equal(isSecureUrl('http://n8n.localhost'), true);
  assert.equal(isSecureUrl('http://192.168.1.10:5678'), false);
  assert.equal(isSecureUrl('http://localhost.evil.com'), false);
  assert.equal(isSecureUrl(''), false);
});

test('normalizeUrl', () => {
  assert.equal(normalizeUrl('n8n.example.com/'), 'https://n8n.example.com');
  assert.equal(normalizeUrl('http://localhost:5678/api/v1'), 'http://localhost:5678');
});

test('client paginates, retries 429, maps 401', async () => {
  const calls = [];
  const resp = (status, body, headers = {}) => ({ status, ok: status < 300, headers: { get: (k) => headers[k] }, json: async () => body });
  const queue = [resp(429, {}, { 'retry-after': '0' }), resp(200, { data: [1], nextCursor: 'c' }), resp(200, { data: [2] })];
  const c = createClient({ url: 'https://x.io', key: 'k' }, { fetchImpl: async (u) => { calls.push(u); return queue.shift(); }, sleep: async () => {} });
  assert.deepEqual(await c.listWorkflows(), [1, 2]);
  assert.equal(calls.length, 3);
  const bad = createClient({ url: 'https://x.io', key: 'k' }, { fetchImpl: async () => resp(401, {}) });
  await assert.rejects(bad.ping(), /API-key/);
});

test('routeOf: which view fits the n8n page', () => {
  const base = 'https://n8n.example.com';
  assert.deepEqual(routeOf('https://n8n.example.com/workflow/FMxJRRJyJW0fcH9P', base), { view: 'workflow', id: 'FMxJRRJyJW0fcH9P' });
  assert.deepEqual(routeOf('https://n8n.example.com/workflow/abc/executions/123?x=1#y', base), { view: 'workflow', id: 'abc' });
  assert.deepEqual(routeOf('https://n8n.example.com/workflow/abc?projectId=p1', base), { view: 'workflow', id: 'abc' });
  assert.deepEqual(routeOf('https://n8n.example.com/workflow/new', base), { view: 'new-workflow' });
  for (const p of ['/workflows', '/home/workflows', '/assistant', '/', '/executions', '/projects/p1/workflows', '/workflow', '/workflowsx/abc']) {
    assert.deepEqual(routeOf('https://n8n.example.com' + p, base), { view: 'overview' }, p);
  }
  assert.equal(routeOf('https://other.example.com/workflow/abc', base), null);
  assert.equal(routeOf('http://n8n.example.com/workflow/abc', base), null); // different origin (scheme)
  assert.equal(routeOf('chrome://newtab/', base), null);
  assert.equal(routeOf('not a url', base), null);
  // instance under a path prefix
  const sub = 'https://example.com/n8n/';
  assert.deepEqual(routeOf('https://example.com/n8n/workflow/abc', sub), { view: 'workflow', id: 'abc' });
  assert.deepEqual(routeOf('https://example.com/n8n/workflows', sub), { view: 'overview' });
  assert.deepEqual(routeOf('https://example.com/workflow/abc', sub), { view: 'overview' }); // outside the prefix
  assert.deepEqual(routeOf('https://example.com/n8nx/workflow/abc', sub), { view: 'overview' });
  assert.equal(sameRoute({ view: 'workflow', id: 'a' }, { view: 'workflow', id: 'a' }), true);
  assert.equal(sameRoute({ view: 'workflow', id: 'a' }, { view: 'workflow', id: 'b' }), false);
  assert.equal(sameRoute({ view: 'overview' }, null), false);
});

test('executions: status, mode, duration, counts and link', () => {
  assert.deepEqual(executionStatus('success'), { cls: 'ok', label: 'Geslaagd' });
  assert.deepEqual(executionStatus('error'), { cls: 'fail', label: 'Mislukt' });
  assert.equal(executionStatus('crashed').cls, 'fail');
  assert.equal(executionStatus('waiting').cls, 'running');
  assert.equal(executionStatus('canceled').label, 'Geannuleerd');
  assert.deepEqual(executionStatus('weird'), { cls: 'other', label: 'weird' });
  assert.equal(executionStatus(undefined).label, 'Onbekend');
  assert.equal(executionKind({ status: 'error' }), 'fail');
  assert.equal(modeLabel('manual'), 'handmatig');
  assert.equal(modeLabel('integrated'), 'subworkflow');
  assert.equal(modeLabel('somethingNew'), 'somethingNew');
  assert.equal(modeLabel(undefined), '');
  const t = (s) => new Date(Date.UTC(2026, 10, 26, 12, 0, 0) + s * 1000).toISOString();
  assert.equal(durationText(t(0), t(0.42)), '0,4 s');
  assert.equal(durationText(t(0), t(9.96)), '10,0 s');
  assert.equal(durationText(t(0), t(12)), '12 s');
  assert.equal(durationText(t(0), t(185)), '3 min 5 s');
  assert.equal(durationText(t(0), t(120)), '2 min');
  assert.equal(durationText(t(0), t(3720)), '1 u 2 min');
  assert.equal(durationText(t(0), t(7200)), '2 u');
  assert.equal(durationText(t(0), null), ''); // still running
  assert.equal(durationText(t(10), t(0)), '');
  assert.deepEqual(countExecutions([{ status: 'success' }, { status: 'error' }, { status: 'crashed' }, { status: 'running' }, { status: 'canceled' }]),
    { all: 5, ok: 1, fail: 2, running: 1, other: 1 });
  assert.deepEqual(countExecutions(undefined), { all: 0, ok: 0, fail: 0, running: 0, other: 0 });
  assert.equal(executionUrl('https://n8n.example.com/', 'wf 1', '42'), 'https://n8n.example.com/workflow/wf%201/executions/42');
});

test('client.listExecutions: one page with cursor', async () => {
  const calls = [];
  const resp = (body) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => body });
  const c = createClient({ url: 'https://x.io', key: 'k' }, { fetchImpl: async (u) => { calls.push(u); return resp({ data: [{ id: '9' }], nextCursor: 'abc=' }); } });
  assert.deepEqual(await c.listExecutions('w1', { limit: 20 }), { data: [{ id: '9' }], nextCursor: 'abc=' });
  await c.listExecutions('w1', { limit: 20, cursor: 'abc=' });
  assert.deepEqual(calls, ['https://x.io/api/v1/executions?workflowId=w1&limit=20', 'https://x.io/api/v1/executions?workflowId=w1&limit=20&cursor=abc%3D']);
});

test('settings: defaults, validation and link titles', () => {
  assert.deepEqual(readSettings(undefined), { openLinksIn: 'window', language: 'auto' });
  assert.deepEqual(readSettings('nonsense'), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings({ openLinksIn: 'tab', language: 'en' }), { openLinksIn: 'tab', language: 'en' });
  assert.deepEqual(readSettings({ openLinksIn: 'current', other: 1 }), { openLinksIn: 'current', language: 'auto' }); // unknown keys dropped
  assert.deepEqual(readSettings({ openLinksIn: 'popup', language: 'fr' }), { openLinksIn: 'window', language: 'auto' }); // unknown value -> default
  assert.deepEqual(OPEN_LINKS.map((o) => o.id), ['window', 'tab', 'current']);
  assert.equal(openLinkTitle({ openLinksIn: 'tab' }), 'Open in n8n (nieuw tabblad)');
  assert.equal(openLinkTitle({}, 'Open uitvoering'), 'Open uitvoering (nieuw venster)');
  assert.equal(openLinkTitle({ openLinksIn: 'current' }), 'Open in n8n (dit tabblad)');
});

test('manual-only workflows: recognised, not switchable, left out of publish plans', () => {
  const node = (type, extra = {}) => ({ type, name: type, parameters: {}, ...extra });
  const manual = { id: 'm', name: 'Handmatig', active: false, tags: [{ id: 't', name: 'mod:x' }], nodes: [node('n8n-nodes-base.manualTrigger'), node('n8n-nodes-base.set')] };
  const legacyStart = { id: 's', name: 'Start', active: false, nodes: [node('n8n-nodes-base.start')] };
  const both = { id: 'b', name: 'Beide', active: true, tags: [{ id: 't', name: 'mod:x' }], nodes: [node('n8n-nodes-base.manualTrigger'), node('n8n-nodes-base.scheduleTrigger', { parameters: { rule: { interval: [{}] } } })] };
  const disabledSchedule = { id: 'd', name: 'Uitgezet schema', active: false, nodes: [node('n8n-nodes-base.manualTrigger'), node('n8n-nodes-base.scheduleTrigger', { disabled: true })] };
  const noTrigger = { id: 'n', name: 'Geen trigger', active: false, nodes: [node('n8n-nodes-base.set')] };
  const sub = { id: 'sub', name: 'Sub', active: false, nodes: [node('n8n-nodes-base.executeWorkflowTrigger')] };
  assert.equal(isManualOnly(manual), true);
  assert.equal(isManualOnly(legacyStart), true);
  assert.equal(isManualOnly(both), false);
  assert.equal(isManualOnly(disabledSchedule), true); // a disabled trigger doesn't count
  assert.equal(isManualOnly(noTrigger), false);
  assert.equal(isManualOnly(sub), false);
  assert.equal(isManualOnly({}), false);
  // module counts ignore manual-only workflows
  const { modules } = groupByModule([manual, both]);
  assert.deepEqual({ active: modules[0].active, switchable: modules[0].switchable, manual: modules[0].manual, status: modules[0].status }, { active: 1, switchable: 1, manual: 1, status: 'on' });
  // publish plan: manual-only member skipped with a warning; not warned about as an unpublished callee
  const caller = { id: 'c', name: 'Aanroeper', active: false, nodes: [node('n8n-nodes-base.webhook'), { type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: 'm' } }] };
  const wfs = [manual, both, caller];
  const g = buildGraph(wfs);
  const plan = planAction('publish', ['m', 'c'], wfs, g);
  assert.deepEqual(plan.steps.map((st) => st.id), ['c']);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /alleen een handmatige trigger/);
  // restore: a snapshot that says "on" for a manual-only workflow is skipped with a warning
  const r = planRestore({ m: true, b: false }, wfs, g);
  assert.deepEqual(r.steps.map((st) => [st.id, st.action]), [['b', 'unpublish']]);
  assert.equal(r.warnings.length, 1);
});

test('i18n: every message has Dutch and English of the same kind', () => {
  for (const [key, pair] of Object.entries(MESSAGES)) {
    assert.ok(Array.isArray(pair) && pair.length === 2, key);
    assert.equal(typeof pair[0], typeof pair[1], key);
    assert.equal(Array.isArray(pair[0]), Array.isArray(pair[1]), key);
    if (typeof pair[0] === 'string') {
      const holes = (x) => [...x.matchAll(/{(w+)}/g)].map((m) => m[1]).sort().join();
      assert.equal(holes(pair[0]), holes(pair[1]), 'placeholders differ: ' + key);
      assert.ok(pair[1].length > 0, key);
    }
  }
});

test('i18n: language choice, placeholders, and English output of the lib', () => {
  assert.equal(resolveLanguage('nl', 'en-US'), 'nl');
  assert.equal(resolveLanguage('en', 'nl-NL'), 'en');
  assert.equal(resolveLanguage('auto', 'nl-BE'), 'nl');
  assert.equal(resolveLanguage('auto', 'nl'), 'nl');
  assert.equal(resolveLanguage('auto', 'de-DE'), 'en');
  assert.equal(resolveLanguage(undefined, ''), 'en');
  assert.equal(t('noSuchKey'), 'noSuchKey'); // a gap is visible
  try {
    setLanguage('en');
    assert.equal(getLanguage(), 'en');
    assert.equal(t('moduleActive', { active: 2, total: 3 }), '2/3 active');
    assert.equal(t('rememberOn', { n: 1 }), 'Switching on turns 1 workflow back on');
    assert.equal(t('rememberOn', { n: 3 }), 'Switching on turns 3 workflows back on');
    assert.equal(describeInterval({ triggerAtHour: 14 }), 'daily at 14:00');
    assert.equal(describeInterval({ field: 'hours' }), 'every hour on the hour');
    assert.equal(describeInterval({ field: 'minutes', minutesInterval: 15 }), 'every 15 minutes');
    assert.equal(describeInterval({ field: 'weeks', triggerAtDay: [1, 5], triggerAtHour: 9, triggerAtMinute: 30 }), 'weekly on Monday, Friday at 09:30');
    assert.equal(describeInterval({ field: 'cronExpression', expression: '0 9 * * 1-5' }), 'at 09:00 from Monday to Friday (cron 0 9 * * 1-5)');
    assert.equal(describeCronItem({ mode: 'everyX', unit: 'seconds', value: 1 }), 'every second');
    assert.deepEqual(exStatus('error'), { cls: 'fail', label: 'Failed' });
    const at = (sec) => new Date(Date.UTC(2026, 0, 1, 12, 0, 0) + sec * 1000).toISOString();
    assert.equal(durText(at(0), at(0.42)), '0.4 s');
    assert.equal(durText(at(0), at(3720)), '1 h 2 min');
    assert.equal(relTime(at(0), new Date(Date.UTC(2026, 0, 1, 15, 0, 0))), '3 h ago');
    assert.equal(openLinkTitle({ openLinksIn: 'tab' }), 'Open in n8n (new tab)');
    assert.deepEqual(weekDays(new Date(2026, 10, 25)).map((d) => d.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    assert.equal(OPEN_LINKS[0].label, 'New window');
  } finally {
    setLanguage('nl'); // the other tests expect Dutch
  }
  assert.equal(describeInterval({ triggerAtHour: 14 }), 'dagelijks om 14:00');
});

test('executionError: the shapes n8n returns (see docs/findings.md)', () => {
  // NodeApiError: everything except context
  const api = { data: { resultData: { lastNodeExecuted: 'HTTP Request', error: {
    name: 'NodeApiError', message: 'Bad request - please check your parameters', description: '400 - {"isok":false}', httpCode: '400',
    node: { name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest' }, context: { request: { headers: { Authorization: 'Bearer SECRET' } } }, stack: 'NodeApiError: Bad request (stack trace)',
  } } } };
  const e = executionError(api);
  assert.deepEqual(e, { message: 'Bad request - please check your parameters', description: '400 - {"isok":false}', httpCode: '400', node: 'HTTP Request', nodeType: 'n8n-nodes-base.httpRequest', kind: 'NodeApiError', stack: 'NodeApiError: Bad request (stack trace)' });
  assert.equal(JSON.stringify(e).includes('SECRET'), false); // context (request headers) is never passed on
  // simple error: no node in the error, so lastNodeExecuted
  const simple = { data: { resultData: { lastNodeExecuted: 'MySQL', error: { message: 'Credentials could not be decrypted.', level: 'warning', stack: 'Error: x' } } } };
  assert.equal(executionError(simple).node, 'MySQL');
  assert.equal(executionError(simple).httpCode, '');
  // only a node-level error in runData
  const nodeOnly = { data: { resultData: { runData: { Set: [{}], Code: [{ error: { message: 'boom' } }] } } } };
  assert.deepEqual([executionError(nodeOnly).message, executionError(nodeOnly).node], ['boom', 'Code']);
  // nothing to show
  assert.equal(executionError({}), null);
  assert.equal(executionError({ data: { resultData: { runData: {} } } }), null);
  assert.equal(executionError(null), null);
});

test('checkSnapshotInstance: only a snapshot of this instance', async () => {
  const { makeSnapshot, checkSnapshotInstance } = await import('../extension/src/lib/snapshot.js');
  const snap = makeSnapshot('https://n8n.example.com', [{ id: '1', name: 'A', active: true }]);
  // the same instance, written differently
  checkSnapshotInstance(snap, 'n8n.example.com/');
  checkSnapshotInstance(snap, 'https://N8N.example.com/api/v1');
  assert.throws(() => checkSnapshotInstance(snap, 'https://test.example.com'), /test|other|andere/i);
  assert.throws(() => checkSnapshotInstance({ ...snap, instance: undefined }, 'https://n8n.example.com'));
  assert.throws(() => checkSnapshotInstance({ ...snap, instance: 'https://n8n.example.com/sub' }, 'https://n8n.example.com'));
});

test('executionsByHour: counts per local start hour, split by outcome', async () => {
  const { executionsByHour, executionHour } = await import('../extension/src/lib/executions.js');
  const at = (h, m = 0) => new Date(2026, 10, 27, h, m).toISOString(); // local time, so the test works in any time zone
  const stop = (iso, sec) => new Date(new Date(iso).getTime() + sec * 1000).toISOString();
  const execs = [
    { status: 'success', startedAt: at(14, 1), stoppedAt: stop(at(14, 1), 2) },
    { status: 'error', startedAt: at(14, 59), stoppedAt: stop(at(14, 59), 6) },
    { status: 'running', startedAt: at(9) },
    { status: 'success', startedAt: at(0) },
    { status: 'success', startedAt: 'not a date' },
    { status: 'success' },
  ];
  const hours = executionsByHour(execs);
  assert.equal(hours.length, 24);
  assert.deepEqual(hours[14], { all: 2, ok: 1, fail: 1, running: 0, other: 0, timed: 2, avgMs: 4000 });
  assert.deepEqual(hours[9], { all: 1, ok: 0, fail: 0, running: 1, other: 0, timed: 0, avgMs: null }); // running: no duration yet
  assert.equal(hours[0].ok, 1);
  assert.equal(hours.reduce((n, h) => n + h.all, 0), 4); // the two without a valid start time are left out
  assert.equal(executionHour({ startedAt: at(23, 30) }), 23);
  assert.equal(executionHour({}), null);
  const { averageDurationMs, formatDuration } = await import('../extension/src/lib/executions.js');
  assert.equal(averageDurationMs(execs), 4000);
  assert.equal(averageDurationMs([{ status: 'running', startedAt: at(1) }]), null);
  assert.match(formatDuration(4000), /^4[.,]0 s$/);
  assert.equal(formatDuration(null), '');
});

test('messages: no key is defined twice (a later duplicate silently wins)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../extension/src/lib/messages.js', import.meta.url), 'utf8');
  const keys = [...src.matchAll(/^ {2}'?([\w.]+)'?:/gm)].map((m) => m[1]);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual(dupes, []);
  assert.ok(keys.length > 100);
});
