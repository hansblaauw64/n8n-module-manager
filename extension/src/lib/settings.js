// Pure: general preferences of the extension (the "Voorkeuren" / "Preferences" tab of the settings page).
// Stored in chrome.storage.local under `settings`; unknown or missing values fall back to the defaults.
import { t } from './i18n.js';

/** Where a link from the panel (workflow, execution) opens. Labels follow the interface language. */
export const OPEN_LINKS = ['window', 'tab', 'current'].map((id) => ({
  id,
  get label() { return t(`set.${id}`); },
  get hint() { return t(`set.${id}Hint`); },
}));

/** Interface language. "auto" follows Chrome's language; the names are shown in their own language. */
export const LANGUAGE_CHOICES = [
  { id: 'auto', get label() { return t('set.auto'); }, get hint() { return t('set.autoHint'); } },
  { id: 'nl', label: 'Nederlands', hint: '' },
  { id: 'en', label: 'English', hint: '' },
];

export const DEFAULT_SETTINGS = Object.freeze({ openLinksIn: 'window', language: 'auto' });

/** Settings as stored (any shape) -> a complete, valid settings object. */
export function readSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    openLinksIn: OPEN_LINKS.some((o) => o.id === s.openLinksIn) ? s.openLinksIn : DEFAULT_SETTINGS.openLinksIn,
    language: LANGUAGE_CHOICES.some((o) => o.id === s.language) ? s.language : DEFAULT_SETTINGS.language,
  };
}

/** Tooltip for a link in the panel, matching where it will open. */
export function openLinkTitle(settings, what = t('openInN8n')) {
  return `${what} (${t(`set.where.${readSettings(settings).openLinksIn}`)})`;
}
