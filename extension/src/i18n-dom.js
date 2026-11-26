// Interface language for the extension pages (panel, settings). Uses chrome.* and the DOM; the texts are in lib/.
//
// Static HTML text is marked with attributes and filled in at start:
//   data-i18n="key"             → textContent
//   data-i18n-html="key"        → innerHTML (only for our own messages that contain markup, e.g. <code>)
//   data-i18n-title / -placeholder / -aria-label="key" → that attribute
import { t, setLanguage, resolveLanguage, getLanguage } from './lib/i18n.js';
import { readSettings } from './lib/settings.js';

/** Chrome's interface language (e.g. "nl" or "en-US"); falls back to the browser language. */
const uiLanguage = () => {
  let lang = '';
  try { lang = chrome.i18n?.getUILanguage?.(); } catch { /* not available */ }
  return typeof lang === 'string' && lang ? lang : navigator.language || '';
};

/** Translate the marked static text inside `root`. */
export function applyI18n(root = document) {
  for (const e of root.querySelectorAll('[data-i18n]')) e.textContent = t(e.dataset.i18n);
  for (const e of root.querySelectorAll('[data-i18n-html]')) e.innerHTML = t(e.dataset.i18nHtml);
  for (const [attr, data] of [['title', 'i18nTitle'], ['placeholder', 'i18nPlaceholder'], ['aria-label', 'i18nAriaLabel']]) {
    for (const e of root.querySelectorAll(`[data-${attr === 'aria-label' ? 'i18n-aria-label' : 'i18n-' + attr}]`)) e.setAttribute(attr, t(e.dataset[data]));
  }
}

/** Read the settings, set the interface language and translate the page. Returns the settings. */
export async function initLanguage() {
  let settings = readSettings();
  try { settings = readSettings((await chrome.storage.local.get('settings')).settings); } catch { /* storage unavailable: defaults */ }
  document.documentElement.lang = setLanguage(resolveLanguage(settings.language, uiLanguage()));
  applyI18n(document);
  return settings;
}

/** True when stored settings would give a different language than the page has now (then reload the page). */
export const languageChanged = (newSettings) => resolveLanguage(readSettings(newSettings).language, uiLanguage()) !== getLanguage();
