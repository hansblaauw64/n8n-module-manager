// Pure: describe the schedule(s) of a workflow in the interface language (lib/i18n.js). No chrome.* APIs.
// n8n only stores parameters that differ from the node's defaults, so a missing value means the default:
// field = days, interval = 1, hour = 0 (midnight), minute = 0, seconds interval = 30, minutes interval = 5.
import { t } from './i18n.js';

const day = (d) => t('dayNames')[Number(d) % 7] ?? d;
const pad = (n) => String(n).padStart(2, '0');
const num = (v, d) => (v === undefined || v === '' || v === null || Number.isNaN(Number(v)) ? d : Number(v));
// unit: 'second' or 'minute'
const every = (n, unit) => (n === 1 ? t('sch.every1', { unit: t(`u.${unit}`) }) : t('sch.everyN', { n, unit: t(`u.${unit}s`) }));
const everyHours = (n) => (n === 1 ? t('sch.everyHour') : t('sch.everyHours', { n })); // Dutch: "elk uur", not "elke uur"
const atMinute = (m) => (m === 0 ? t('sch.onTheHour') : t('sch.atMinute', { m })); // ":00" is cryptic, say it in words
const time = (h, m) => `${pad(h)}:${pad(m)}`;

// ---- cron expressions -> readable text (common shapes only; null when not understood) ----

function parseList(field) {
  // "5" -> [5], "1,3" -> [1,3], "0-6" -> range object, "*/2" -> step, "*" -> any
  if (field === '*') return { any: true };
  let m = field.match(/^\*\/(\d+)$/);
  if (m) return { step: Number(m[1]) };
  m = field.match(/^(\d+)-(\d+)$/);
  if (m) return { range: [Number(m[1]), Number(m[2])] };
  m = field.match(/^(\d+(?:,\d+)*)$/);
  if (m) return { list: field.split(',').map(Number) };
  return null;
}

export function cronToText(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null; // 6-field (seconds) cron and expressions are shown raw
  const [mi, ho, dom, mon, dow] = parts;
  const minute = parseList(mi);
  const hour = parseList(ho);
  const days = parseList(dow);
  const monthDay = parseList(dom);
  if (!minute || !hour || !days || !monthDay || mon !== '*') return null;

  // When
  let when = null;
  const oneMinute = minute.list && minute.list.length === 1;
  if (minute.any && hour.any) when = t('sch.everyMinute');
  else if (minute.step && hour.any) when = t('sch.everyNMin', { n: minute.step });
  else if (minute.step && hour.range) when = t('sch.everyNMinBetween', { n: minute.step, a: pad(hour.range[0]), b: pad(hour.range[1]) });
  else if (minute.step && hour.list) when = t('sch.everyNMinInHours', { n: minute.step, list: hour.list.join(', ') });
  else if (minute.any && hour.range) when = t('sch.everyMinuteBetween', { a: pad(hour.range[0]), b: pad(hour.range[1]) });
  else if (oneMinute && hour.any) when = `${everyHours(1)} ${atMinute(minute.list[0])}`;
  else if (oneMinute && hour.step) when = `${everyHours(hour.step)} ${atMinute(minute.list[0])}`;
  else if (oneMinute && hour.range) when = t('sch.everyHourBetween', { a: time(hour.range[0], minute.list[0]), b: time(hour.range[1], minute.list[0]) });
  else if (oneMinute && hour.list) {
    const ts = hour.list.map((h) => time(h, minute.list[0]));
    when = ts.length <= 4 ? t('sch.at', { times: ts.join(', ') }) : t('sch.timesPerDay', { n: ts.length, first: ts[0] });
  } else return null;

  // On which days
  let on = '';
  if (!days.any) {
    if (days.list) on = t('sch.onDays', { days: days.list.map(day).join(', ') });
    else if (days.range) on = t('sch.dayRange', { a: day(days.range[0]), b: day(days.range[1]) });
    else return null;
  }
  if (!monthDay.any) {
    if (monthDay.list) on += t('sch.onMonthDays', { list: monthDay.list.join(', ') });
    else return null;
  }
  return when + on;
}

/** Cron text with the raw expression behind it, so the real schedule is always visible. */
function cronLabel(expr) {
  const text = cronToText(expr);
  return text ? `${text} (cron ${expr})` : `cron: ${expr || '?'}`;
}

// ---- Schedule Trigger rules ----

export function describeInterval(rule) {
  const r = rule || {}; // a stored {} is a valid rule: all defaults
  const at = () => time(num(r.triggerAtHour, 0), num(r.triggerAtMinute, 0));
  switch (r.field ?? 'days') {
    case 'seconds': return every(num(r.secondsInterval, 30), 'second');
    case 'minutes': return every(num(r.minutesInterval, 5), 'minute');
    case 'hours': return `${everyHours(num(r.hoursInterval, 1))} ${atMinute(num(r.triggerAtMinute, 0))}`;
    case 'days': {
      const n = num(r.daysInterval, 1);
      return n === 1 ? t('sch.daily', { time: at() }) : t('sch.everyNDays', { n, time: at() });
    }
    case 'weeks': {
      const n = num(r.weeksInterval, 1);
      const days = (Array.isArray(r.triggerAtDay) && r.triggerAtDay.length ? r.triggerAtDay : [0]).map(day).join(', ');
      return n === 1 ? t('sch.weekly', { days, time: at() }) : t('sch.everyNWeeks', { n, days, time: at() });
    }
    case 'months': {
      const n = num(r.monthsInterval, 1);
      const d = num(r.triggerAtDayOfMonth, 1);
      return n === 1 ? t('sch.monthly', { d, time: at() }) : t('sch.everyNMonths', { n, d, time: at() });
    }
    case 'cronExpression': return cronLabel(r.expression);
    default: return t('sch.unknown', { x: r.field }); // unknown field: at least show which
  }
}

// ---- Legacy Cron node (n8n-nodes-base.cron) ----

export function describeCronItem(item) {
  const i = item || {};
  const at = () => time(num(i.hour, 14), num(i.minute, 0));
  switch (i.mode) {
    case 'everyMinute': return t('sch.everyMinute');
    case 'everyHour': return `${everyHours(1)} ${atMinute(num(i.minute, 0))}`;
    case 'everyDay': return t('sch.daily', { time: at() });
    case 'everyWeek': return t('sch.weekly', { days: day(num(i.weekday, 1)), time: at() });
    case 'everyMonth': return t('sch.monthly', { d: num(i.dayOfMonth, 1), time: at() });
    case 'everyX': {
      const unit = i.unit ?? 'minutes'; // default unit of the Cron node
      const v = num(i.value, 2);
      if (unit === 'seconds') return every(v, 'second');
      if (unit === 'hours') return everyHours(v);
      return every(v, 'minute');
    }
    case 'custom': return cronLabel(i.cronExpression);
    default: return i.mode ? t('sch.unknown', { x: i.mode }) : t('sch.unreadable');
  }
}

/** Returns an array of readable schedule strings (empty if the workflow has no schedule node). */
export function describeSchedules(workflow) {
  const out = [];
  for (const n of workflow.nodes || []) {
    if (n.disabled) continue;
    if (n.type === 'n8n-nodes-base.scheduleTrigger') {
      const rules = n.parameters?.rule?.interval;
      if (Array.isArray(rules) && rules.length) out.push(...rules.map(describeInterval));
      else out.push(t('sch.unreadable'));
    } else if (n.type === 'n8n-nodes-base.cron') {
      const items = n.parameters?.triggerTimes?.item;
      if (Array.isArray(items) && items.length) out.push(...items.map(describeCronItem));
      else out.push(t('sch.unreadable'));
    }
  }
  // Merge identical entries ("dagelijks om 00:00 ×2").
  const counts = new Map();
  for (const x of out) counts.set(x, (counts.get(x) || 0) + 1);
  return [...counts].map(([x, c]) => (c > 1 ? `${x} ×${c}` : x));
}
