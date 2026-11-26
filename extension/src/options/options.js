import { createClient, normalizeUrl, originOf, isSecureUrl } from '../lib/n8n.js';
import { getInstances, saveInstances } from '../storage.js';
import { ENVIRONMENTS, envInfo } from '../lib/env.js';
import { BRAND } from '../../brand/brand.js';
import { OPEN_LINKS, LANGUAGE_CHOICES, readSettings } from '../lib/settings.js';
import { t } from '../lib/i18n.js';
import { initLanguage, languageChanged } from '../i18n-dom.js';

const $ = (id) => document.getElementById(id);
await initLanguage(); // sets the interface language and translates the static HTML
document.title = t('opt.title', { app: chrome.runtime.getManifest().name });
$('logo').alt = BRAND.name;
for (const e of ENVIRONMENTS) $('env').append(Object.assign(document.createElement('option'), { value: e.id, textContent: e.label }));
const msg = (text, kind = '') => { $('msg').textContent = text; $('msg').className = kind; };
let editingId = null;
let known = []; // instances as last rendered; lets submit use the stored key without awaiting (user gesture)
const KEY_HINT_NEW = '';
const KEY_HINT_EDIT = t('opt.keyKeep');

async function render() {
  const instances = await getInstances();
  known = instances;
  const list = $('list');
  list.textContent = '';
  if (!instances.length) list.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: t('opt.none') }));
  for (const i of instances) {
    const row = document.createElement('div');
    row.className = 'card';
    const info = document.createElement('div');
    info.innerHTML = '<strong></strong><div class="muted"></div>';
    info.firstChild.textContent = i.name;
    info.lastChild.textContent = i.url;
    const env = envInfo(i.env);
    if (env.color) {
      const badge = document.createElement('span');
      badge.className = 'envbadge' + (env.solid ? '' : ' outline');
      badge.textContent = env.label;
      info.firstChild.after(badge);
    }
    const edit = Object.assign(document.createElement('button'), { textContent: t('opt.edit') });
    edit.onclick = () => {
      editingId = i.id;
      $('name').value = i.name;
      $('url').value = i.url;
      // Never put the stored key back into the page: leave the field empty and keep the current key unless a new one is typed.
      $('key').value = '';
      $('key').required = false;
      $('key').placeholder = KEY_HINT_EDIT;
      $('env').value = i.env || '';
      $('formTitle').textContent = t('opt.editTitle');
      $('cancel').hidden = false;
    };
    const del = Object.assign(document.createElement('button'), { textContent: t('delete') });
    del.onclick = async () => {
      if (!confirm(t('opt.deleteConfirm', { name: i.name }))) return;
      await saveInstances((await getInstances()).filter((x) => x.id !== i.id));
      render();
    };
    row.append(info, edit, del);
    list.append(row);
  }
}

function reset() {
  editingId = null;
  $('form').reset();
  $('formTitle').textContent = t('opt.addTitle');
  $('cancel').hidden = true;
  $('key').required = true;
  $('key').placeholder = KEY_HINT_NEW;
}
$('cancel').onclick = reset;

$('form').onsubmit = async (e) => {
  e.preventDefault();
  let url, origin;
  try { url = normalizeUrl($('url').value); origin = originOf(url); } catch { return msg(t('opt.invalidUrl'), 'err'); }
  if (!isSecureUrl(url)) return msg(t('opt.httpsOnly'), 'err');
  const typed = $('key').value.trim();
  const key = typed || (editingId ? known.find((x) => x.id === editingId)?.key : '');
  if (!key) return msg(t('opt.keyRequired'), 'err');
  // Must run directly in the click handler (user gesture).
  const granted = await chrome.permissions.request({ origins: [origin + '/*'] });
  if (!granted) return msg(t('opt.accessNeeded', { origin }), 'err');
  msg(t('opt.testing'));
  try {
    await createClient({ url, key }).ping();
  } catch (err) {
    return msg(err.message, 'err');
  }
  const instances = await getInstances();
  const entry = { id: editingId || crypto.randomUUID(), name: $('name').value.trim() || new URL(url).host, url, key, env: $('env').value };
  const next = editingId ? instances.map((x) => (x.id === editingId ? entry : x)) : [...instances, entry];
  await saveInstances(next);
  reset();
  msg(t('opt.saved'), 'ok');
  render();
};

// ---- tabs: "Instances" and "Voorkeuren" (preferences). #voorkeuren in the address opens the second one. ----
const tabs = [...document.querySelectorAll('[role="tab"]')];
function showPane(name, { focus = false } = {}) {
  const tab = tabs.find((t) => t.dataset.pane === name) || tabs[0];
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
  }
  if (focus) tab.focus();
  history.replaceState(null, '', location.pathname + location.search + (tab.dataset.pane === 'instances' ? '' : '#' + tab.dataset.pane));
}
for (const t of tabs) {
  t.onclick = () => showPane(t.dataset.pane);
  t.onkeydown = (e) => { // arrow keys move between tabs (ARIA tabs pattern)
    const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    showPane(tabs[(tabs.indexOf(t) + dir + tabs.length) % tabs.length].dataset.pane, { focus: true });
  };
}
showPane(new URLSearchParams(location.search).has('site') ? 'instances' : location.hash.slice(1) || 'instances');

// ---- preferences: saved immediately in chrome.storage.local under "settings" ----
/** One group of radio choices (a fieldset in the HTML) bound to one setting. */
function renderChoices(boxId, setting, choices, current) {
  const box = $(boxId);
  box.querySelectorAll('label.choice').forEach((l) => l.remove());
  for (const o of choices) {
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: setting, value: o.id, checked: current[setting] === o.id });
    input.onchange = async () => {
      const { settings: now } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...readSettings(now), [setting]: o.id } });
      $('prefsMsg').textContent = t('opt.savedChoice', { choice: o.label });
    };
    const text = document.createElement('div');
    text.append(Object.assign(document.createElement('strong'), { textContent: o.label }));
    if (o.hint) text.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: o.hint }));
    const label = document.createElement('label');
    label.className = 'choice';
    label.append(input, text);
    box.append(label);
  }
}
async function renderPrefs() {
  const current = readSettings((await chrome.storage.local.get('settings')).settings);
  renderChoices('language', 'language', LANGUAGE_CHOICES, current);
  renderChoices('openLinks', 'openLinksIn', OPEN_LINKS, current);
}
renderPrefs();
// Another language chosen (here or in another window): reload, so the whole page is in that language.
chrome.storage.onChanged.addListener((c) => { if (c.settings && languageChanged(c.settings.newValue)) location.reload(); });

// Opened from the toolbar icon on a tab without a panel (?site=<origin of that tab>).
// A web address that isn't saved yet is filled in, so only the API key is left to enter.
render().then(async () => {
  const params = new URLSearchParams(location.search);
  const site = params.get('site');
  if (site === null) return;
  const saved = (await getInstances()).map((i) => { try { return originOf(i.url); } catch { return i.url; } });
  const isWeb = /^https?:\/\//i.test(site);
  if (isWeb && !saved.includes(site)) {
    $('url').value = site;
    $('key').focus();
    return msg(saved.length ? t('opt.setupAdd', { site, list: saved.join(', ') }) : t('opt.setupNew', { site }));
  }
  if (!isWeb) {
    // e.g. a new tab or a chrome:// page: nothing to fill in.
    return msg(t('opt.setupNoSite'));
  }
  // A saved address whose panel didn't open (e.g. a race while the tab was loading): show Chrome's reason.
  const err = params.get('err');
  msg(t('opt.panelFailed', { site }) + (err ? t('opt.chromeSays', { err }) : '') + t('opt.reloadTab'), 'err');
});
