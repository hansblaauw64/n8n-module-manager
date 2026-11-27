// "Deze workflow" / "This workflow": shown when the tab has a workflow open (/workflow/<id>). Lists the executions of that workflow,
// newest first, 20 at a time, with a filter on status. Data comes from GET /executions (no execution data).
import { isManualOnly } from '../lib/triggers.js';
import { t, locale } from '../lib/i18n.js';
import { executionStatus, executionKind, modeLabel, durationText, countExecutions, executionUrl, relativeTime, executionError, executionsByHour, executionHour, averageDurationMs, formatDuration } from '../lib/executions.js';

const PAGE = 20;
let loadToken = 0; // a newer render cancels the results of an older one
let filter = 'all'; // kept while the panel is open

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.includes('-')) e.setAttribute(k, v); // aria-*, data-*: attributes, not properties
    else e[k] = v;
  }
  e.append(...kids.filter((k) => k != null));
  return e;
}

const absTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/**
 * root: the <section>. ctx: {
 *   route: { view: 'workflow', id } | { view: 'new-workflow' },
 *   workflow: the workflow from the loaded list, or null (unknown, archived or no access),
 *   client, base (instance URL), modulesOf(workflow), openUrl(url), linkTitle(what), setStatus(text, cls)
 * }
 */
export function renderWorkflowView(root, ctx) {
  const token = ++loadToken;
  root.textContent = '';

  if (ctx.route.view === 'new-workflow') {
    root.append(h('div', { className: 'card col' },
      h('div', { className: 'eyebrow' }, h('span', { textContent: t('wf') })),
      h('p', { className: 'muted', textContent: t('wfNew') })));
    ctx.setStatus(t('wfNewStatus'));
    return;
  }

  const id = ctx.route.id;
  const w = ctx.workflow;
  const mods = w ? ctx.modulesOf(w) : [];
  const head = h('div', { className: 'card col wf-head' },
    h('div', { className: 'eyebrow' }, h('span', { textContent: t('wf') })),
    h('strong', { className: 'modname', textContent: w ? w.name : t('wfUnknownName', { id }) }),
    h('div', { className: 'wf-meta' },
      w ? (isManualOnly(w) && !w.active
        ? h('span', { className: 'badge off', textContent: t('manual'), title: t('manualTitle') })
        : h('span', { className: 'badge ' + (w.active ? 'on' : 'off'), textContent: w.active ? t('on') : t('off') })) : null,
      ...mods.map((m) => h('span', { className: 'chip', textContent: m })),
      w ? null : h('span', { className: 'muted', textContent: t('wfNotInList') })));
  const summary = h('p', { className: 'muted ex-summary', textContent: t('exLoading') });
  const chart = h('div', { className: 'ex-chart' });
  const filters = h('div', { className: 'ex-filters', role: 'group', 'aria-label': t('exFilter') });
  const list = h('ul', { className: 'ex-list' });
  const more = h('button', { type: 'button', className: 'ex-more', textContent: t('exMore'), hidden: true });
  const box = h('div', { className: 'card col' }, h('div', { className: 'eyebrow' }, h('span', { textContent: t('executions') })), summary, chart, filters, list, more);
  root.append(head, box);

  let execs = [];
  let cursor = '';
  const errors = new Map(); // execution id -> Promise of the reduced error (fetched once, when first opened)
  const openErrors = new Set(); // execution ids whose error section is open (kept when the filter redraws the list)

  /** Collapsible "Foutmelding" under a failed execution. The details are fetched only when it is opened. */
  const errorSection = (e) => {
    const body = h('div', { className: 'ex-error-body' });
    const box = h('details', { className: 'ex-error', open: openErrors.has(e.id) },
      h('summary', { textContent: t('exError'), title: t('exErrorTitle') }), body);
    const fill = async () => {
      if (body.dataset.state) return;
      body.dataset.state = 'loading';
      body.append(h('p', { className: 'muted', textContent: t('exErrorLoading') }));
      if (!errors.has(e.id)) errors.set(e.id, ctx.client.getExecution(e.id, { includeData: true }).then(executionError));
      let err;
      try {
        err = await errors.get(e.id);
      } catch (x) {
        errors.delete(e.id); // try again next time
        body.dataset.state = '';
        body.textContent = '';
        body.append(h('p', { className: 'err', textContent: t('exErrorFailed', { msg: x.message }) }));
        return;
      }
      body.dataset.state = 'done';
      body.textContent = '';
      if (!err) { body.append(h('p', { className: 'muted', textContent: t('exErrorNone') })); return; }
      // Everything as text (textContent): error texts come from n8n and the called services.
      const meta = [err.node && t('exErrorNode', { node: err.node + (err.nodeType ? ` (${err.nodeType.split('.').pop()})` : '') }), err.httpCode && t('exErrorHttp', { code: err.httpCode })].filter(Boolean).join(' · ');
      const copy = h('button', { type: 'button', className: 'ex-error-copy', textContent: t('exErrorCopy') });
      copy.onclick = async () => {
        const text = [err.message, err.description, meta, err.stack].filter(Boolean).join('\n\n');
        try { await navigator.clipboard.writeText(text); copy.textContent = t('exErrorCopied'); setTimeout(() => { copy.textContent = t('exErrorCopy'); }, 1500); } catch { /* clipboard refused */ }
      };
      body.append(
        h('p', { className: 'ex-error-msg', textContent: err.message || err.kind || '?' }),
        ...(meta ? [h('p', { className: 'ex-error-meta', textContent: meta })] : []),
        ...(err.description ? [h('pre', { className: 'ex-error-pre', textContent: err.description })] : []),
        ...(err.stack ? [h('details', { className: 'ex-error-stack' }, h('summary', { textContent: t('exErrorStack') }), h('pre', { className: 'ex-error-pre', textContent: err.stack }))] : []),
        copy);
    };
    box.addEventListener('toggle', () => {
      if (box.open) { openErrors.add(e.id); fill(); } else openErrors.delete(e.id);
    });
    if (box.open) fill();
    return box;
  };

  const row = (e) => {
    const st = executionStatus(e.status);
    const href = executionUrl(ctx.base, id, e.id);
    const link = h('a', { className: 'wf-link', href, textContent: `#${e.id}`, title: ctx.linkTitle ? ctx.linkTitle(t('exOpen')) : t('exOpen'), onclick: (ev) => { ev.preventDefault(); ctx.openUrl(href); } });
    const dur = st.cls === 'running' ? (e.status === 'waiting' ? t('exWaiting') : t('exRunning')) : durationText(e.startedAt, e.stoppedAt);
    const details = [dur, modeLabel(e.mode) && t('exVia', { mode: modeLabel(e.mode) }), absTime(e.startedAt)].filter(Boolean).join(' · ');
    return h('li', { className: 'ex ' + st.cls },
      h('div', { className: 'ex-line' },
        h('span', { className: 'ex-dot ' + st.cls, 'aria-hidden': 'true' }),
        h('span', { className: 'ex-status', textContent: st.label }),
        link,
        h('span', { className: 'ex-when', textContent: relativeTime(e.startedAt), title: absTime(e.startedAt) })),
      h('div', { className: 'ex-details', textContent: details }),
      ...(st.cls === 'fail' ? [errorSection(e)] : []));
  };

  let hourFilter = null; // a clicked bar in the chart: only executions that started in that hour
  let chartMode = 'count'; // 'count': number of executions per hour; 'duration': their average duration

  /** Bars per hour of the day, like the day agenda: when the loaded executions started, failed ones in red. */
  const drawChart = () => {
    chart.textContent = '';
    chart.hidden = !execs.length;
    if (!execs.length) return;
    const byHour = executionsByHour(execs);
    const byDuration = chartMode === 'duration';
    const max = byDuration ? Math.max(1, ...byHour.map((x) => x.avgMs || 0)) : Math.max(1, ...byHour.map((x) => x.all));
    const hh = (hr) => String(hr).padStart(2, '0');
    const avg = (ms) => (ms == null ? t('exAvgNone') : formatDuration(ms));

    // Switch: number of executions per hour, or their average duration.
    const modes = h('div', { className: 'ex-chart-modes', role: 'group', 'aria-label': t('exChartShow') });
    for (const [key, label] of [['count', t('exChartCount')], ['duration', t('exChartDuration')]]) {
      const b = h('button', { type: 'button', className: 'ag-day' + (chartMode === key ? ' sel' : ''), textContent: label });
      b.setAttribute('aria-pressed', String(chartMode === key));
      b.onclick = () => { chartMode = key; draw(); };
      modes.append(b);
    }
    const caption = h('div', { className: 'ex-chart-cap muted' });
    if (hourFilter == null) {
      caption.append(byDuration ? t('exByHourDuration') : t('exByHour'), ' · ',
        h('strong', { textContent: t('exAvgAll', { avg: avg(averageDurationMs(execs)) }) }));
    } else {
      const x = byHour[hourFilter];
      caption.append(t('exHourOnly', { from: `${hh(hourFilter)}:00`, to: `${hh(hourFilter)}:59` }), ' ',
        h('strong', { textContent: t('exAvgAll', { avg: avg(x.avgMs) }) }), ' · ');
      caption.append(h('button', { type: 'button', className: 'linkish', textContent: t('exHourClear'), onclick: () => { hourFilter = null; draw(); } }));
    }
    const bars = h('div', { className: 'ag-heat ex-heat' + (hourFilter != null ? ' picked' : ''), role: 'group' });
    bars.setAttribute('aria-label', t('exByHourAria'));
    byHour.forEach((x, hr) => {
      const cell = h('button', {
        type: 'button',
        className: 'ag-cell' + (x.all ? '' : ' empty') + (hourFilter === hr ? ' sel' : ''),
        title: t('exHourCell', { from: `${hh(hr)}:00`, to: `${hh(hr)}:59`, n: x.all, fail: x.fail }) + (x.all ? ' · ' + t('exAvgAll', { avg: avg(x.avgMs) }) : ''),
      });
      cell.setAttribute('aria-pressed', String(hourFilter === hr));
      const value = byDuration ? x.avgMs || 0 : x.all;
      const stack = h('span', { className: 'ex-stack', style: `height:${value ? Math.max(10, Math.round((value / max) * 100)) : x.all ? 3 : 0}%` });
      if (byDuration) {
        // One bar: the average duration; a bar with failures gets a red cap.
        if (x.avgMs != null) stack.append(h('span', { className: 'ex-seg dur', style: 'flex-grow:1' }));
        if (x.fail && x.avgMs != null) stack.append(h('span', { className: 'ex-seg fail cap' }));
      } else {
        // Stacked from the bottom: succeeded, running/other, failed.
        for (const [cls, n] of [['ok', x.ok], ['busy', x.running + x.other], ['fail', x.fail]]) if (n) stack.append(h('span', { className: 'ex-seg ' + cls, style: `flex-grow:${n}` }));
      }
      cell.append(x.all ? stack : h('span', { className: 'ag-bar' }), h('span', { className: 'ag-hr', textContent: hr % 3 === 0 ? hh(hr) : '' }));
      if (x.all) cell.onclick = () => { hourFilter = hourFilter === hr ? null : hr; draw(); };
      else cell.disabled = true;
      bars.append(cell);
    });
    chart.append(modes, caption, bars);
  };

  const draw = () => {
    const c = countExecutions(execs);
    const shown = (filter === 'all' ? execs : execs.filter((e) => executionKind(e) === filter))
      .filter((e) => hourFilter == null || executionHour(e) === hourFilter);
    drawChart();
    list.textContent = '';
    for (const e of shown) list.append(row(e));
    if (!execs.length) list.append(h('li', { className: 'muted empty', textContent: t('exNone') }));
    else if (!shown.length) list.append(h('li', { className: 'muted empty', textContent: t('exNoneFiltered') }));

    const lastFail = execs.find((e) => executionKind(e) === 'fail');
    summary.textContent = !execs.length ? '' : t('exSummary', { n: c.all, ok: c.ok, fail: c.fail })
      + (c.running ? t('exSummaryRunning', { n: c.running }) : '')
      + (lastFail ? t('exSummaryLastFail', { when: relativeTime(lastFail.startedAt) }) : '');
    summary.hidden = !execs.length;

    filters.textContent = '';
    const opts = [['all', t('exAll'), c.all], ['fail', t('exFailed'), c.fail], ['ok', t('exSucceeded'), c.ok], ...(c.running ? [['running', t('exBusy'), c.running]] : [])];
    for (const [key, label, n] of opts) {
      const b = h('button', { type: 'button', className: 'ag-day' + (filter === key ? ' sel' : ''), textContent: `${label} (${n})` });
      b.setAttribute('aria-pressed', String(filter === key));
      b.onclick = () => { filter = key; draw(); };
      filters.append(b);
    }
    filters.hidden = !execs.length;
    more.hidden = !cursor;
  };

  const fetchPage = async () => {
    more.disabled = true;
    try {
      const page = await ctx.client.listExecutions(id, { limit: PAGE, cursor });
      if (token !== loadToken) return; // the view changed meanwhile
      execs = [...execs, ...page.data];
      cursor = page.nextCursor;
      draw();
      ctx.setStatus(t('exLoaded', { n: execs.length }));
    } catch (err) {
      if (token !== loadToken) return;
      summary.hidden = false;
      summary.textContent = err.message;
      summary.className = 'err ex-summary';
      ctx.setStatus(err.message, 'err');
    } finally {
      more.disabled = false;
    }
  };
  more.onclick = fetchPage;
  ctx.setStatus(t('exLoading'));
  fetchPage();
}
