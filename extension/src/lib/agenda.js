// Pure: turn the schedule triggers of all workflows into a day agenda. No DOM, no chrome.* APIs.
//
// n8n converts Schedule Trigger rules to cron internally, which makes the times deterministic:
//   hours  -> "<m> */<n> * * *"        days   -> "<m> <h> */<n> * *"   (day-of-month steps, restart each month)
//   weeks  -> "<m> <h> * * <days>"     months -> "<m> <h> <dom> */<n> *"
// minutes/seconds intervals run from activation time (not clock aligned), so they are "continuous".
import { describeInterval, describeCronItem } from './schedule.js';
import { t as tr } from './i18n.js'; // `t` is used for times (minutes of the day) in this file

const SCHEDULE = 'n8n-nodes-base.scheduleTrigger';
const CRON = 'n8n-nodes-base.cron';
const MAX_FIXED = 6; // up to this many runs per day: shown as separate agenda items

const num = (v, d) => (v === undefined || v === '' || v === null || Number.isNaN(Number(v)) ? d : Number(v));

// ---- cron ----

/** "5", "1,3", "0-6", "*", "*​/2", "8-18/2" -> sorted unique numbers within [min,max], or null if not understood. */
function expandField(field, min, max) {
  const out = new Set();
  for (const part of String(field).split(',')) {
    const m = part.match(/^(\*|\d+|\d+-\d+)(?:\/(\d+))?$/);
    if (!m) return null;
    let [lo, hi] = m[1] === '*' ? [min, max] : m[1].includes('-') ? m[1].split('-').map(Number) : [Number(m[1]), m[2] ? max : Number(m[1])];
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1 || lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/** Expand a 5-field cron expression. Returns null when it cannot be read (names, expressions, 6 fields). */
export function expandCron(expr) {
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [mi, ho, dom, mon, dow] = f;
  const minutes = expandField(mi, 0, 59);
  const hours = expandField(ho, 0, 23);
  const doms = expandField(dom, 1, 31);
  const months = expandField(mon, 1, 12);
  const dows = expandField(dow, 0, 7);
  if (!minutes || !hours || !doms || !months || !dows) return null;
  return {
    minutes, hours, doms, months,
    dows: [...new Set(dows.map((d) => d % 7))],
    domAny: dom.startsWith('*') && !dom.includes('/') ? true : dom === '*',
    dowAny: dow === '*',
  };
}

function cronRunsOn(c, date) {
  if (!c.months.includes(date.getMonth() + 1)) return false;
  const domOk = c.doms.includes(date.getDate());
  const dowOk = c.dows.includes(date.getDay());
  if (c.domAny && c.dowAny) return true;
  if (c.domAny) return dowOk;
  if (c.dowAny) return domOk;
  return domOk || dowOk; // classic cron: when both are restricted, either one matches
}

// ---- placing a set of run times ----

/** times: minutes-of-day. Few -> fixed items, many at one minute -> recurring (hourly-ish), else continuous. */
function place(times, textHint) {
  const t = [...new Set(times)].sort((a, b) => a - b);
  if (!t.length) return { kind: 'none' };
  if (t.length <= MAX_FIXED) return { kind: 'fixed', times: t };
  const minutes = new Set(t.map((x) => x % 60));
  if (t.length <= 24 && minutes.size === 1) return { kind: 'recurring', minute: t[0] % 60, hours: t.map((x) => Math.floor(x / 60)) };
  return { kind: 'continuous', textHint };
}

const at = (h, m) => num(h, 0) * 60 + num(m, 0);

/** Where does one Schedule Trigger rule run on `date`? */
export function ruleOccurrence(rule, date) {
  const r = rule || {};
  const dow = date.getDay();
  const dom = date.getDate();
  switch (r.field ?? 'days') {
    case 'seconds':
    case 'minutes':
      return { kind: 'continuous' };
    case 'hours': {
      const n = Math.max(1, num(r.hoursInterval, 1));
      const hours = [];
      for (let h = 0; h < 24; h += n) hours.push(h);
      return place(hours.map((h) => at(h, r.triggerAtMinute)));
    }
    case 'days': {
      const n = Math.max(1, num(r.daysInterval, 1));
      if (n > 1 && (dom - 1) % n !== 0) return { kind: 'none' }; // */n over day-of-month
      return { kind: 'fixed', times: [at(r.triggerAtHour, r.triggerAtMinute)] };
    }
    case 'weeks': {
      const days = (Array.isArray(r.triggerAtDay) && r.triggerAtDay.length ? r.triggerAtDay : [0]).map(Number);
      return days.includes(dow) ? { kind: 'fixed', times: [at(r.triggerAtHour, r.triggerAtMinute)] } : { kind: 'none' };
    }
    case 'months': {
      const n = Math.max(1, num(r.monthsInterval, 1));
      if ((date.getMonth()) % n !== 0) return { kind: 'none' };
      return dom === num(r.triggerAtDayOfMonth, 1) ? { kind: 'fixed', times: [at(r.triggerAtHour, r.triggerAtMinute)] } : { kind: 'none' };
    }
    case 'cronExpression': {
      const c = expandCron(r.expression);
      if (!c) return { kind: 'unknown' };
      if (!cronRunsOn(c, date)) return { kind: 'none' };
      return place(c.hours.flatMap((h) => c.minutes.map((m) => h * 60 + m)));
    }
    default:
      return { kind: 'unknown' };
  }
}

/** Where does one item of the legacy Cron node run on `date`? */
export function cronItemOccurrence(item, date) {
  const i = item || {};
  const dow = date.getDay();
  switch (i.mode) {
    case 'everyMinute':
    case 'everyX':
      return { kind: 'continuous' };
    case 'everyHour':
      return place(Array.from({ length: 24 }, (_, h) => at(h, i.minute)));
    case 'everyDay':
      return { kind: 'fixed', times: [at(num(i.hour, 14), i.minute)] };
    case 'everyWeek':
      return num(i.weekday, 1) === dow ? { kind: 'fixed', times: [at(num(i.hour, 14), i.minute)] } : { kind: 'none' };
    case 'everyMonth':
      return num(i.dayOfMonth, 1) === date.getDate() ? { kind: 'fixed', times: [at(num(i.hour, 14), i.minute)] } : { kind: 'none' };
    case 'custom': {
      const c = expandCron(i.cronExpression);
      if (!c) return { kind: 'unknown' };
      if (!cronRunsOn(c, date)) return { kind: 'none' };
      return place(c.hours.flatMap((h) => c.minutes.map((m) => h * 60 + m)));
    }
    default:
      return { kind: 'unknown' };
  }
}

// ---- the agenda ----

/** All schedule rules of a workflow: [{ occurrence, text, field, daily }]. `daily`: runs every day at a fixed time. */
function rulesOf(workflow, date) {
  const out = [];
  for (const n of workflow.nodes || []) {
    if (n.disabled) continue;
    if (n.type === SCHEDULE) {
      const rules = n.parameters?.rule?.interval;
      for (const r of Array.isArray(rules) && rules.length ? rules : [undefined]) {
        out.push({ occurrence: rules ? ruleOccurrence(r, date) : { kind: 'unknown' }, text: rules ? describeInterval(r) : tr('sch.unreadable'), field: r?.field ?? 'days',
          daily: Boolean(rules) && (r?.field ?? 'days') === 'days' && Number(r?.daysInterval ?? 1) === 1 });
      }
    } else if (n.type === CRON) {
      const items = n.parameters?.triggerTimes?.item;
      for (const it of Array.isArray(items) && items.length ? items : [undefined]) {
        out.push({ occurrence: items ? cronItemOccurrence(it, date) : { kind: 'unknown' }, text: items ? describeCronItem(it) : tr('sch.unreadable'), field: it?.mode ?? 'days', daily: it?.mode === 'everyDay' });
      }
    }
  }
  return out;
}

/**
 * Agenda of `date`.
 * Returns { slots, hours, heat, recurring, continuous, unknown, workflowCount, collisions }.
 *  - slots: [{ t, entries:[{wf,text,recurring}], multi, activeCount }] sorted by time; `multi` = 2+ different workflows at that exact time,
 *    `activeCount` = how many of them are switched on.
 *  - hours: slots grouped per hour (only hours that have something).
 *  - heat: 24 numbers (entries per hour) for the overview strip.
 *  - recurring: workflows that run every hour(ish) at a fixed minute; they are also added to a slot they coincide with.
 *  - continuous: workflows that run every few minutes/seconds (not clock aligned).
 */
/** A rule that runs at a set clock time (e.g. daily 14:00, Mondays 09:30, cron "0 9,17 * * *"), not an interval like every N hours/minutes. */
const isExactRule = (field, o) => o.kind === 'fixed' && field !== 'hours' && field !== 'everyHour';

export function buildAgenda(workflows, date, { onlyActive = false, exactOnly = false } = {}) {
  const fixed = new Map(); // t -> Map(wfId -> entry)
  const recurring = [];
  const continuous = [];
  const unknown = [];
  const seen = new Set();

  for (const wf of workflows) {
    if (onlyActive && !wf.active) continue;
    const rules = rulesOf(wf, date);
    if (!rules.length) continue;
    for (const { occurrence: o, text, field, daily } of rules) {
      if (exactOnly && o.kind !== 'none' && !isExactRule(field, o)) continue;
      if (o.kind === 'none') { seen.add(String(wf.id)); continue; } // has a schedule, just not on this day
      seen.add(String(wf.id));
      const base = { wf, text, daily };
      if (o.kind === 'fixed') {
        for (const t of o.times) {
          if (!fixed.has(t)) fixed.set(t, new Map());
          const m = fixed.get(t);
          if (!m.has(String(wf.id))) m.set(String(wf.id), { ...base, recurring: false });
        }
      } else if (o.kind === 'recurring') recurring.push({ ...base, minute: o.minute, hours: o.hours });
      else if (o.kind === 'continuous') continuous.push(base);
      else unknown.push(base);
    }
  }

  // An hourly workflow also takes part in a slot where it runs at the same time (e.g. 14:00).
  for (const [t, m] of fixed) {
    for (const r of recurring) {
      if (r.minute === t % 60 && r.hours.includes(Math.floor(t / 60)) && !m.has(String(r.wf.id))) m.set(String(r.wf.id), { wf: r.wf, text: r.text, recurring: true });
    }
  }

  const byName = (a, b) => a.wf.name.localeCompare(b.wf.name);
  const slots = [...fixed.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, m]) => {
      const entries = [...m.values()].sort(byName);
      return { t, entries, multi: entries.length >= 2, activeCount: entries.filter((e) => e.wf.active).length };
    });

  const hours = [];
  for (const s of slots) {
    const h = Math.floor(s.t / 60);
    let g = hours[hours.length - 1];
    if (!g || g.hour !== h) { g = { hour: h, slots: [] }; hours.push(g); }
    g.slots.push(s);
  }
  const heat = Array(24).fill(0);
  for (const g of hours) heat[g.hour] = g.slots.reduce((n, s) => n + s.entries.length, 0);

  recurring.sort((a, b) => a.minute - b.minute || byName(a, b));
  continuous.sort(byName);
  unknown.sort(byName);
  return {
    slots, hours, heat, recurring, continuous, unknown,
    workflowCount: seen.size,
    collisions: slots.filter((s) => s.multi).length, // 2+ workflows at the same time (also switched-off ones)
    activeCollisions: slots.filter((s) => s.activeCount >= 2).length, // 2+ workflows that are really on
  };
}

/** The seven days of the week containing `today`, Monday first: [{ date, weekday, label, isToday }]. */
export function weekDays(today) {
  const labels = tr('dayShort'); // Sunday first, like Date.getDay()
  const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const monday = new Date(d0);
  monday.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    return { date, weekday: date.getDay(), label: labels[date.getDay()], isToday: date.toDateString() === d0.toDateString() };
  });
}

export const timeLabel = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
