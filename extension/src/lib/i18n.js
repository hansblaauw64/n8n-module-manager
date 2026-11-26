// Interface language (Dutch or English). Pure: no DOM, no chrome.* APIs.
//
// All texts live in messages.js as [dutch, english] pairs. t(key, values) returns the text in the current language;
// "{name}" placeholders are filled from `values`, and a message can also be a function (for plurals).
// The panel and the settings page call setLanguage() at start and when the "language" preference changes.
import { MESSAGES } from './messages.js';

export const LANGUAGES = ['nl', 'en'];
let current = 'nl';

/** Pick the language: 'nl' or 'en' when chosen, otherwise ('auto') the browser's UI language (Dutch → nl, rest → en). */
export function resolveLanguage(setting, uiLanguage = '') {
  if (LANGUAGES.includes(setting)) return setting;
  return /^nl\b/i.test(String(uiLanguage)) ? 'nl' : 'en';
}

export function setLanguage(lang) {
  current = LANGUAGES.includes(lang) ? lang : 'nl';
  return current;
}

export const getLanguage = () => current;

/** Locale for dates and times in the current language. */
export const locale = () => (current === 'en' ? 'en-GB' : 'nl-NL');

/** Text for `key` in the current language. Unknown keys return the key itself, so a gap is visible, not silent. */
export function t(key, values = {}) {
  const pair = MESSAGES[key];
  if (!pair) return key;
  const msg = pair[current === 'en' ? 1 : 0] ?? pair[0];
  if (typeof msg === 'function') return msg(values);
  if (Array.isArray(msg)) return msg; // e.g. day names
  return String(msg).replace(/\{(\w+)\}/g, (_, k) => (values[k] ?? `{${k}}`));
}
