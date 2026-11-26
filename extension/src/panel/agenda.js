// "Dagplanning": collapsible section above the module cards with all workflows that have a schedule trigger,
// ordered by time like a day agenda. Workflows that run at the same time are grouped and flagged.
import { buildAgenda, weekDays, timeLabel } from '../lib/agenda.js';
import { t } from '../lib/i18n.js';

let selectedWeekday = null; // null = today; only kept while the panel is open

function h(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k != null));
  return e;
}

/**
 * root: the <section>. ctx: { workflows, workflowUrl(id), openWorkflow(url), linkTitle(what), modulesOf(workflow), prefs, savePrefs }.
 * prefs.agenda = { open, onlyActive } is stored per instance together with the other panel preferences.
 */
export function renderAgenda(root, ctx) {
  const prefs = (ctx.prefs.agenda ||= { open: true, onlyActive: false, exactOnly: false });
  const week = weekDays(new Date());
  const today = week.find((d) => d.isToday);
  const day = week.find((d) => d.weekday === (selectedWeekday ?? today.weekday)) || today;
  const ag = buildAgenda(ctx.workflows, day.date, { onlyActive: prefs.onlyActive, exactOnly: !!prefs.exactOnly });
  root.textContent = '';
  root.hidden = false;
  root.classList.toggle('open', prefs.open);

  const rerender = () => renderAgenda(root, ctx);
  const save = () => ctx.savePrefs();

  // --- header ---
  const toggle = h('button', { className: 'agenda-toggle', type: 'button' },
    h('span', { className: 'agenda-chev', textContent: prefs.open ? '▾' : '▸' }),
    h('strong', { textContent: t('agTitle') }),
    h('span', { className: 'badge off', textContent: t(prefs.exactOnly ? 'agCountExact' : 'agCount', { n: ag.workflowCount }) }),
    ...(ag.activeCollisions
      ? [h('span', { className: 'badge warn', textContent: t('agActiveCollisions', { n: ag.activeCollisions }), title: t('agActiveCollisionsTitle') })]
      : []));
  toggle.setAttribute('aria-expanded', String(prefs.open));
  toggle.onclick = () => { prefs.open = !prefs.open; save(); rerender(); };
  root.append(toggle);
  if (!prefs.open) return;

  const body = h('div', { className: 'agenda-body' });
  root.append(body);

  // --- controls: day chips + only active ---
  const chips = h('div', { className: 'ag-days', role: 'group' });
  chips.setAttribute('aria-label', t('agDays'));
  for (const d of week) {
    const b = h('button', { type: 'button', className: 'ag-day' + (d.weekday === day.weekday ? ' sel' : '') + (d.isToday ? ' today' : ''), textContent: `${d.label} ${d.date.getDate()}` });
    b.setAttribute('aria-pressed', String(d.weekday === day.weekday));
    if (d.isToday) b.title = t('agToday');
    b.onclick = () => { selectedWeekday = d.isToday ? null : d.weekday; rerender(); };
    chips.append(b);
  }
  const only = h('input', { type: 'checkbox', checked: prefs.onlyActive });
  only.onchange = () => { prefs.onlyActive = only.checked; save(); rerender(); };
  const exact = h('input', { type: 'checkbox', checked: !!prefs.exactOnly });
  exact.onchange = () => { prefs.exactOnly = exact.checked; save(); rerender(); };
  const exactLabel = h('label', { className: 'ag-only', title: t('agExactTitle') }, exact, t('agExact'));
  body.append(h('div', { className: 'ag-controls' }, chips, h('div', { className: 'ag-filters' }, h('label', { className: 'ag-only' }, only, t('agOnlyActive')), exactLabel)));

  if (!ag.workflowCount) {
    const what = t(prefs.exactOnly ? 'agNoneExact' : 'agNoneSchedule');
    body.append(h('p', { className: 'muted', textContent: t('agNone', { active: prefs.onlyActive ? t('agNoneActive') : '', what }) }));
    return;
  }

  // --- heat strip: how many runs per hour, amber when workflows overlap ---
  const max = Math.max(1, ...ag.heat);
  const hourMeta = Array.from({ length: 24 }, (_, hr) => {
    const grp = ag.hours.find((g) => g.hour === hr);
    return { hr, n: ag.heat[hr], real: grp?.slots.some((s) => s.activeCount >= 2) || false, multi: grp?.slots.some((s) => s.multi) || false };
  });
  const heat = h('div', { className: 'ag-heat', role: 'img' });
  heat.setAttribute('aria-label', t('agHeat'));
  for (const m of hourMeta) {
    const hh = String(m.hr).padStart(2, '0');
    const cell = h('button', { type: 'button', className: 'ag-cell' + (m.real ? ' hot' : m.multi ? ' warm' : '') + (m.n ? '' : ' empty'), title: t('agHeatCell', { from: `${hh}:00`, to: `${hh}:59`, n: m.n }) });
    cell.append(h('span', { className: 'ag-bar', style: `height:${m.n ? Math.max(12, Math.round((m.n / max) * 100)) : 0}%` }), h('span', { className: 'ag-hr', textContent: m.hr % 3 === 0 ? String(m.hr).padStart(2, '0') : '' }));
    if (m.n) cell.onclick = () => body.querySelector(`[data-hour="${m.hr}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    else cell.disabled = true;
    heat.append(cell);
  }
  body.append(heat);

  // --- one entry (a workflow in the agenda) ---
  const entry = (e, time) => {
    const href = ctx.workflowUrl(e.wf.id);
    const link = h('a', { className: 'wf-link', href, textContent: e.wf.name, title: ctx.linkTitle ? ctx.linkTitle(t('openInN8n')) : t('openInN8n'), onclick: (ev) => { ev.preventDefault(); ctx.openWorkflow(href); } });
    const mods = ctx.modulesOf(e.wf);
    // A daily schedule needs no note: the time says it all. Other schedules show how often they run.
    const note = e.recurring ? t('agEveryHour') : e.daily ? '' : e.text;
    return h('div', { className: 'ag-entry' + (e.wf.active ? '' : ' off') },
      ...(time ? [h('span', { className: 'ag-time', textContent: time })] : []),
      link,
      ...(mods.length ? [h('span', { className: 'chip', textContent: mods[0] + (mods.length > 1 ? ` +${mods.length - 1}` : '') })] : []),
      ...(note ? [h('span', { className: 'ag-note', textContent: note })] : []),
      ...(e.wf.active ? [] : [h('span', { className: 'ag-offtag', textContent: t('agOffTag') })]));
  };

  // --- the day: hour blocks (scrollable) ---
  const list = h('div', { className: 'ag-list' });
  if (!ag.hours.length) list.append(h('p', { className: 'muted', textContent: t('agNoFixed') }));
  for (const g of ag.hours) {
    const block = h('div', { className: 'ag-hour' });
    block.dataset.hour = String(g.hour);
    block.append(h('div', { className: 'ag-hlabel', textContent: `${String(g.hour).padStart(2, '0')}:00` }));
    const slots = h('div', { className: 'ag-slots' });
    for (const s of g.slots) {
      if (!s.multi) {
        slots.append(entry(s.entries[0], timeLabel(s.t)));
        continue;
      }
      const label = s.activeCount === s.entries.length ? t('agAtOnce', { n: s.entries.length }) : t('agAtOnceOn', { n: s.entries.length, on: s.activeCount });
      slots.append(h('div', { className: 'ag-slot multi' + (s.activeCount >= 2 ? ' real' : '') },
        h('div', { className: 'ag-slot-head' }, h('strong', { textContent: timeLabel(s.t) }), h('span', { className: 'badge ' + (s.activeCount >= 2 ? 'warn' : 'off'), textContent: label })),
        ...s.entries.map((e) => entry(e, ''))));
    }
    block.append(slots);
    list.append(block);
  }
  body.append(list);

  // --- groups without a fixed time ---
  const group = (title, items, hint) => {
    if (!items.length) return;
    const d = h('details', { className: 'ag-group' }, h('summary', {}, `${title} (${items.length})`));
    if (hint) d.append(h('p', { className: 'muted', textContent: hint }));
    for (const it of items) d.append(entry(it, it.minute !== undefined ? `:${String(it.minute).padStart(2, '0')}` : ''));
    body.append(d);
  };
  group(t('agGroupHourly'), ag.recurring.map((r) => ({ ...r, recurring: false, text: r.text })), t('agGroupHourlyHint'));
  group(t('agGroupContinuous'), ag.continuous, t('agGroupContinuousHint'));
  group(t('agGroupUnknown'), ag.unknown, t('agGroupUnknownHint'));
}
