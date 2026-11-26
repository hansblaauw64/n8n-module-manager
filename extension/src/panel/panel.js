import { createClient, normalizeUrl, isSecureUrl } from '../lib/n8n.js';
import { groupByModule, applyOrder, moveInOrder, moduleNames, moduleTagMap, retag, findModuleName, planSubflowMoves } from '../lib/modules.js';
import { buildGraph, planAction, planRestore } from '../lib/deps.js';
import { triggerItems, isManualOnly } from '../lib/triggers.js';
import { searchWorkflow } from '../lib/search.js';
import { tabsToRefresh } from '../lib/tabs.js';
import { summarizeRuns, describeRun } from '../lib/executions.js';
import { envInfo } from '../lib/env.js';
import { initTips } from './tips.js';
import { renderAgenda } from './agenda.js';
import { renderWorkflowView } from './workflowView.js';
import { routeOf, sameRoute } from '../lib/route.js';
import { readSettings, openLinkTitle } from '../lib/settings.js';
import { t, locale } from '../lib/i18n.js';
import { initLanguage, languageChanged } from '../i18n-dom.js';
import { makeSnapshot, parseSnapshot, desiredStates, checkSnapshotInstance } from '../lib/snapshot.js';
import { getInstances, findInstanceForUrl } from '../storage.js';
import { BRAND } from '../../brand/brand.js';

const $ = (id) => document.getElementById(id);
const manifest = chrome.runtime.getManifest();
document.title = manifest.name;
$('logo').alt = BRAND.name;
const state = { instance: null, client: null, workflows: [], graph: null, busy: false, memory: {}, allMemory: {}, prefs: { order: [], collapsed: [] }, allPrefs: {}, runs: new Map(), runsLoad: 0, tags: [],
  route: null, // what the tab shows: { view: 'workflow', id } | { view: 'new-workflow' } | { view: 'overview' }
  viewChoice: null, // 'workflow' | 'overview' when the user picked a tab; reset when the page changes
  windowId: null, overviewStatus: '',
  settings: readSettings(), // preferences from the settings page (where links open)
};
const NONE_KEY = '__none__'; // collapse key of the "Zonder module" card
// Interface language first: the static HTML is translated and every text below is built in that language.
state.settings = await initLanguage();

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.filter((k) => k != null));
  return e;
}
const setStatus = (t, cls = 'muted') => { $('status').textContent = t; $('status').className = cls; };

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Environment badge in the header plus a colored bar, so test and production are easy to tell apart. */
function showEnvironment(instance) {
  const env = envInfo(instance?.env);
  const bar = document.querySelector('.topbar');
  const badge = $('env');
  bar.style.borderBottom = env.color ? `${env.solid ? 4 : 2}px solid ${env.color}` : '';
  badge.hidden = !env.color;
  badge.textContent = env.label;
  badge.className = 'envbadge' + (env.solid ? '' : ' outline');
}

async function load() {
  if (state.busy) return;
  $('content').textContent = '';
  const tab = await currentTab();
  const instance = tab?.url ? findInstanceForUrl(await getInstances(), tab.url) : null;
  state.windowId = tab?.windowId ?? null;
  if (!instance) {
    state.instance = null;
    state.route = null;
    showView();
    $('title').textContent = 'n8n Modules';
    showEnvironment(null);
    $('agenda').hidden = true;
    setStatus(t('notInstanceTab'));
    $('content').append(el('button', { textContent: t('openSettings'), onclick: () => chrome.runtime.openOptionsPage() }));
    return;
  }
  if (!isSecureUrl(instance.url)) {
    // Never send the API key over plain http (except localhost).
    state.instance = null;
    state.route = null;
    showView();
    $('title').textContent = instance.name;
    showEnvironment(null);
    $('agenda').hidden = true;
    setStatus(t('httpRefused'), 'err');
    $('content').append(el('button', { textContent: t('openSettings'), onclick: () => chrome.runtime.openOptionsPage() }));
    return;
  }
  state.instance = instance;
  state.client = createClient(instance);
  $('title').textContent = instance.name;
  $('title').title = `${instance.name} (${instance.url})`;
  showEnvironment(instance);
  setStatus(t('loadingWorkflows'));
  try {
    state.workflows = (await state.client.listWorkflows()).filter((w) => !w.isArchived);
  } catch (e) {
    state.route = null; // show the error in the overview, whatever page the tab is on
    showView();
    setStatus(e.message, 'err');
    return;
  }
  state.graph = buildGraph(state.workflows);
  await loadMemory();
  await loadPrefs();
  try { state.tags = await state.client.listTags(); } catch { state.tags = []; } // tags give us empty modules
  const time = new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  state.overviewStatus = t('overviewStatus', { n: state.workflows.length, time });
  setStatus(state.overviewStatus);
  state.runs = new Map();
  render();
  renderAgendaSection();
  applyRoute(tab.url, { force: true });
  loadRuns(); // in the background; fills the "last run" lines as results arrive
}

// --- Views: "Deze workflow" on a workflow page (/workflow/<id>), the module overview everywhere else ---

const onWorkflowPage = () => Boolean(state.instance && state.route && state.route.view !== 'overview');
const activeView = () => (onWorkflowPage() ? state.viewChoice || 'workflow' : 'overview');

function showView() {
  const v = activeView();
  $('viewtabs').hidden = !onWorkflowPage();
  document.body.classList.toggle('view-workflow', v === 'workflow');
  $('wfview').hidden = v !== 'workflow';
  $('tabWorkflow').setAttribute('aria-selected', String(v === 'workflow'));
  $('tabOverview').setAttribute('aria-selected', String(v === 'overview'));
  if (v === 'workflow') {
    renderWorkflowView($('wfview'), {
      route: state.route,
      workflow: state.route.id ? state.workflows.find((w) => String(w.id) === String(state.route.id)) || null : null,
      client: state.client,
      base: normalizeUrl(state.instance.url),
      modulesOf: moduleNames,
      openUrl: openWorkflow,
      linkTitle,
      setStatus: (text, cls) => { if (activeView() === 'workflow') setStatus(text, cls); },
    });
  } else {
    $('wfview').textContent = '';
    if (state.instance && state.overviewStatus) setStatus(state.overviewStatus);
  }
}

/** Follow the page in the tab. Returns false when the tab is not on the loaded instance (then a full load is needed). */
function applyRoute(url, { force = false } = {}) {
  if (!state.instance) return false;
  const r = routeOf(url, state.instance.url);
  if (!r) return false;
  if (force || !sameRoute(r, state.route)) {
    state.route = r;
    state.viewChoice = null; // a new page: show what fits it
    showView();
  }
  return true;
}

$('tabWorkflow').onclick = () => { state.viewChoice = 'workflow'; showView(); };
$('tabOverview').onclick = () => { state.viewChoice = 'overview'; showView(); };

/** Day agenda above the cards (all workflows with a schedule trigger). */
function renderAgendaSection() {
  renderAgenda($('agenda'), {
    workflows: state.workflows,
    workflowUrl,
    openWorkflow,
    linkTitle,
    modulesOf: moduleNames,
    prefs: state.prefs,
    savePrefs,
  });
}

/** Fetch the latest executions for workflows that belong to a module (4 at a time). */
async function loadRuns() {
  const token = ++state.runsLoad;
  const queue = state.workflows.filter((w) => moduleNames(w).length > 0).map((w) => String(w.id));
  const worker = async () => {
    while (queue.length && token === state.runsLoad) {
      const id = queue.shift();
      try {
        state.runs.set(id, summarizeRuns(await state.client.lastExecutions(id, 5)));
      } catch {
        state.runs.set(id, { kind: 'unknown' });
      }
      if (token === state.runsLoad) applyRuns();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (token === state.runsLoad) updateBadge();
}

const APP_TITLE = manifest.action?.default_title || manifest.name;

/**
 * Badge on the toolbar icon for the tabs of this instance: number of workflows (in a module) whose last run failed.
 * Updated whenever the panel loads the runs; it does not poll in the background.
 */
async function updateBadge() {
  if (!state.instance) return;
  const failed = [...state.runs.values()].filter((s) => s.kind === 'fail').length;
  const origin = new URL(normalizeUrl(state.instance.url)).origin;
  const title = failed ? t('badgeFailed', { app: APP_TITLE, n: failed }) : APP_TITLE;
  try {
    for (const tab of await chrome.tabs.query({})) {
      let o;
      try { o = new URL(tab.url).origin; } catch { continue; }
      if (o !== origin) continue;
      await chrome.action.setBadgeText({ tabId: tab.id, text: failed ? String(failed) : '' });
      if (failed) {
        await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#ef4444' });
        await chrome.action.setBadgeTextColor?.({ tabId: tab.id, color: '#ffffff' });
      }
      await chrome.action.setTitle({ tabId: tab.id, title });
    }
  } catch (e) {
    console.warn('updating the badge failed:', e?.message);
  }
}

/** Write cached run info into the placeholders (no re-render, so scroll/focus stay put). */
function applyRuns() {
  const root = $('content');
  for (const line of root.querySelectorAll('.run[data-wf]')) {
    const sum = state.runs.get(line.dataset.wf);
    if (!sum) { line.textContent = t('runLoading'); line.className = 'dep run loading'; continue; }
    if (sum.kind === 'unknown') { line.textContent = t('runUnknown'); line.className = 'dep run other'; continue; }
    const d = describeRun(sum);
    line.textContent = '● ' + d.text;
    line.className = 'dep run ' + d.cls;
  }
  for (const card of root.querySelectorAll('.card[data-module]')) {
    const badge = card.querySelector('.runbadge');
    if (!badge) continue;
    const ids = [...card.querySelectorAll('.run[data-wf]')].map((l) => l.dataset.wf);
    const failed = ids.filter((id) => state.runs.get(id)?.kind === 'fail').length;
    badge.hidden = failed === 0;
    badge.textContent = t('nFailed', { n: failed });
    badge.title = t('nFailedTitle');
  }
}

const workflowUrl = (id) => `${normalizeUrl(state.instance.url)}/workflow/${encodeURIComponent(id)}`;
/** Open a link from the panel where the user wants it (settings page → Voorkeuren → Links openen in). */
async function openWorkflow(url) {
  const where = state.settings.openLinksIn;
  if (where === 'window') return chrome.windows.create({ url, focused: true });
  const tab = await currentTab();
  if (where === 'current' && tab) return chrome.tabs.update(tab.id, { url }); // the panel follows the page by itself
  return chrome.tabs.create({
    url,
    active: true,
    ...(tab ? { openerTabId: tab.id, windowId: tab.windowId } : {}),
    ...(Number.isInteger(tab?.index) ? { index: tab.index + 1 } : {}), // right next to the current tab
  });
}
const linkTitle = (what) => openLinkTitle(state.settings, what);

function render() {
  const q = $('search').value.trim().toLowerCase();
  const match = (w) => !q || searchWorkflow(w, q) !== null;
  const grouped = groupByModule(state.workflows, state.tags);
  const modules = applyOrder(grouped.modules, state.prefs.order);
  const unassigned = grouped.unassigned;
  const collapsedNow = (key) => !q && state.prefs.collapsed.includes(key); // while searching everything is open
  const root = $('content');
  root.textContent = '';
  const byId = new Map(state.workflows.map((w) => [String(w.id), w]));
  const names = (set) => [...set].map((id) => byId.get(id)?.name).filter(Boolean);

  const wfItem = (w) => {
    const needs = names(state.graph.calls.get(String(w.id)));
    const usedBy = names(state.graph.calledBy.get(String(w.id)));
    const href = workflowUrl(w.id);
    const link = el('a', {
      className: 'wf-link',
      href,
      textContent: w.name,
      title: linkTitle(t('openInN8n')),
      onclick: (e) => { e.preventDefault(); openWorkflow(href); },
    });
    // Only a manual trigger: n8n can't publish it, so no on/off switch.
    const sw = isManualOnly(w) && !w.active
      ? el('span', { className: 'chip manual', textContent: t('manual'), title: t('manualTitle') })
      : makeSwitch(w.active ? 'true' : 'false', {
        label: w.active ? t('on') : t('off'),
        title: t(w.active ? 'switchWfOff' : 'switchWfOn', { name: w.name }),
        onclick: () => review(w.active ? 'unpublish' : 'publish', w.name, [w.id], { single: true }),
      });
    const wfHandle = el('button', { className: 'wf-drag', type: 'button', textContent: '⠿', title: t('dragWf') });
    wfHandle.setAttribute('aria-label', t('dragWfAria', { name: w.name }));
    // Not linked to any module yet: dropdown to link it directly (selecting = linking, no extra dialog).
    let assign = null;
    if (!moduleNames(w).length) {
      assign = el('select', { className: 'wf-assign', title: t('assignTitle') });
      assign.setAttribute('aria-label', t('assignAria', { name: w.name }));
      assign.append(el('option', { value: '', textContent: modules.length ? t('assignPick') : t('noModules') }));
      for (const m of modules) assign.append(el('option', { value: m.name, textContent: m.name }));
      assign.disabled = modules.length === 0;
      assign.onchange = () => {
        const to = assign.value;
        assign.value = '';
        if (to) moveWorkflow(w.id, null, to, { ask: false });
      };
    }
    const li = el('li', {}, wfHandle, link, ...(assign ? [assign] : []), sw);
    li.dataset.wf = String(w.id);
    const wrap = el('div', {}, li);
    if (moduleNames(w).length) {
      const run = el('div', { className: 'dep run loading', textContent: t('runLoading') });
      run.dataset.wf = String(w.id);
      wrap.append(run);
    }
    const triggers = triggerItems(w, normalizeUrl(state.instance.url));
    if (triggers.length) {
      // "Paused" only means something for a workflow that can be switched on; a manual-only one never is.
      const paused = !w.active && !isManualOnly(w);
      const line = el('div', {
        className: 'dep sched' + (paused ? ' paused' : ''),
        title: paused ? t('triggersPaused') : t('triggersTitle'),
      });
      triggers.forEach((trig, i) => {
        if (i) line.append(' · ');
        line.append(el('span', { textContent: trig.text }));
        if (trig.copy || trig.copyUnavailable) line.append(copyButton(trig));
      });
      if (paused) line.append(t('isOff'));
      wrap.append(line);
    }
    const found = q ? searchWorkflow(w, q) : null;
    if (found?.hits.length) {
      const shown = found.hits.slice(0, 3).map((h) => `${h.node} (${h.where})`);
      const more = found.hits.length - shown.length;
      wrap.append(el('div', { className: 'dep hit', textContent: '🔍 ' + shown.join(', ') + (more > 0 ? t('searchMore', { n: more }) : '') }));
    }
    if (needs.length) wrap.append(el('div', { className: 'dep', textContent: t('needs', { list: needs.join(', ') }) }));
    if (usedBy.length) wrap.append(el('div', { className: 'dep', textContent: t('usedBy', { list: usedBy.join(', ') }) }));
    return wrap;
  };

  let shown = 0;
  for (const m of modules) {
    const moduleHit = q && m.name.toLowerCase().includes(q);
    const list = moduleHit ? m.workflows : m.workflows.filter(match);
    if (q && !list.length && !moduleHit) continue;
    shown++;
    const ids = m.workflows.map((w) => w.id);
    const empty = m.workflows.length === 0;
    // Module switch = "is any workflow of this module running?". Off: switches off everything that is on (and
    // remembers which). On: switches on only what was remembered; workflows that were off stay off.
    const isOn = m.active > 0;
    const pending = rememberedFor(m).length;
    const head = el('div', { className: 'head' },
      el('div', {},
        cardTop(m.name, { draggable: !q }),
        el('strong', { className: 'modname', textContent: m.name }),
        el('span', { className: 'badge ' + (empty ? 'off' : m.switchable ? m.status : 'off'), textContent: empty ? t('moduleEmpty') : m.switchable ? t('moduleActive', { active: m.active, total: m.switchable }) : t('moduleManualOnly'), title: m.manual ? t('moduleManualTitle', { n: m.manual }) : '' }),
        el('span', { className: 'badge fail runbadge', hidden: true }),
        !isOn && pending ? el('div', { className: 'muted remember', textContent: t('rememberOn', { n: pending }) }) : null),
      empty
        ? el('button', { className: 'danger', type: 'button', textContent: t('delete'), title: t('deleteModuleTitle'), onclick: () => deleteModule(m.name) })
        : !m.switchable ? null // only manual workflows: nothing to switch
        : makeSwitch(isOn ? 'true' : 'false', {
          label: isOn ? t('on') : t('off'),
          title: t(isOn ? 'moduleSwitchOff' : 'moduleSwitchOn', { name: m.name }),
          onclick: () => reviewModule(m, isOn ? 'off' : 'on'),
        }));
    const items = (q ? list : m.workflows).map(wfItem);
    if (empty) items.push(el('li', { className: 'empty-hint', textContent: t('dropHere') }));
    const ul = el('ul', {}, ...items);
    const card = el('div', { className: 'card col' + (collapsedNow(m.name) ? ' collapsed' : '') }, head, ul);
    card.dataset.module = m.name;
    root.append(card);
  }
  const rest = unassigned.filter(match);
  if (rest.length) {
    const noneCard = el('div', { className: 'card col' + (collapsedNow(NONE_KEY) ? ' collapsed' : '') },
      el('div', { className: 'head' }, el('div', {}, cardTop(t('noModule'), { key: NONE_KEY }), el('strong', { className: 'modname', textContent: t('noModule') }))),
      el('ul', {}, ...rest.map(wfItem)));
    noneCard.dataset.none = '1';
    root.append(noneCard);
  }
  enableWorkflowDragging(root);
  if (!shown && !rest.length) root.append(el('p', { className: 'muted', textContent: t('nothingFound') }));
  applyRuns(); // keep already fetched run info after a re-render
  if (!q) enableDragging(root);
  const anyOpen = [...modules.map((m) => m.name), ...(rest.length ? [NONE_KEY] : [])].some((k) => !state.prefs.collapsed.includes(k));
  $('collapseAll').textContent = anyOpen ? t('collapseAll') : t('expandAll');
  $('collapseAll').hidden = !shown && !rest.length;
  root.classList.toggle('multi', modules.length > 1 && root.children.length > 1 && root.children[0].offsetLeft !== root.children[1].offsetLeft);
}

// --- UI preferences (module order, collapsed cards): chrome.storage.local, per instance ---
async function loadPrefs() {
  const { moduleUi } = await chrome.storage.local.get('moduleUi');
  state.allPrefs = moduleUi || {};
  state.prefs = { order: [], collapsed: [], ...(state.allPrefs[state.instance.id] || {}) };
}
async function savePrefs() {
  state.allPrefs[state.instance.id] = state.prefs;
  await chrome.storage.local.set({ moduleUi: state.allPrefs });
}

function toggleCollapsed(key) {
  const s = new Set(state.prefs.collapsed);
  if (s.has(key)) s.delete(key); else s.add(key);
  state.prefs.collapsed = [...s];
  savePrefs();
  render();
}

function toggleAll() {
  const { modules, unassigned } = groupByModule(state.workflows, state.tags);
  const keys = [...modules.map((m) => m.name), ...(unassigned.length ? [NONE_KEY] : [])];
  const anyOpen = keys.some((k) => !state.prefs.collapsed.includes(k));
  state.prefs.collapsed = anyOpen ? keys : [];
  savePrefs();
  render();
}

/** Top row of a card: drag handle (modules only), collapse chevron, "Module" label. */
function cardTop(name, { draggable = false, key = name } = {}) {
  const open = !state.prefs.collapsed.includes(key) || $('search').value.trim() !== '';
  const chevron = el('button', {
    className: 'chevron',
    type: 'button',
    title: open ? t('collapse') : t('expand'),
    textContent: open ? '▾' : '▸',
    onclick: () => toggleCollapsed(key),
  });
  chevron.setAttribute('aria-expanded', String(open));
  chevron.setAttribute('aria-label', t(open ? 'collapseAria' : 'expandAria', { name }));
  const row = el('div', { className: 'eyebrow' }, chevron, el('span', { textContent: t('module') }));
  if (draggable) {
    const handle = el('button', { className: 'drag-handle', type: 'button', title: t('dragModule'), textContent: '⠿' });
    handle.setAttribute('aria-label', t('dragModuleAria', { name }));
    handle.onkeydown = (e) => {
      const dir = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      moveByStep(name, dir);
    };
    row.prepend(handle);
  }
  return row;
}

// --- Add / remove a module by hand. A module is the tag "mod:<naam>" in n8n, so this creates/deletes that tag. ---
const existingModuleNames = () => [...groupByModule(state.workflows, state.tags).modules.map((m) => m.name)];

function addModuleDialog() {
  if (!state.instance) return setStatus(t('noInstance'), 'err');
  const dlg = $('dlg');
  dlg.textContent = '';
  const input = el('input', { id: 'newModule', placeholder: t('addModulePlaceholder'), autocomplete: 'off', maxLength: 40 });
  const out = el('p', { role: 'status', className: 'err' });
  const go = el('button', { className: 'primary', type: 'submit', textContent: t('create') });
  const form = el('form', {},
    el('h3', { textContent: t('addModuleTitle') }),
    el('p', { className: 'muted', textContent: t('addModuleHint') }),
    el('label', { htmlFor: 'newModule', textContent: t('addModuleLabel') }), input, out,
    el('p', {}, go, ' ', el('button', { type: 'button', textContent: t('cancel'), onclick: () => dlg.close() })));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) { out.textContent = t('nameRequired'); return; }
    const clash = findModuleName(name, existingModuleNames());
    if (clash) { out.textContent = t('nameExists', { name: clash }); return; }
    go.disabled = true;
    out.className = 'muted';
    out.textContent = t('creating');
    try {
      await state.client.createTag('mod:' + name);
      state.prefs.order = [...visibleModuleNames(), name]; // new card goes last
      await savePrefs();
      dlg.close();
      await load();
    } catch (err) {
      out.className = 'err';
      out.textContent = err.message;
      go.disabled = false;
    }
  };
  dlg.append(form);
  dlg.showModal();
  input.focus();
}

function deleteModule(name) {
  const tag = moduleTagMap(state.workflows, state.tags).get(name);
  const dlg = $('dlg');
  dlg.textContent = '';
  const out = el('p', { role: 'status', className: 'err' });
  const go = el('button', { className: 'danger-solid', textContent: t('deleteConfirm') });
  go.onclick = async () => {
    go.disabled = true;
    try {
      await state.client.deleteTag(tag.id);
      state.prefs.order = state.prefs.order.filter((n) => n !== name);
      state.prefs.collapsed = state.prefs.collapsed.filter((n) => n !== name);
      await savePrefs();
      dlg.close();
      await load();
    } catch (err) {
      out.textContent = err.message;
      go.disabled = false;
    }
  };
  dlg.append(
    el('h3', { textContent: t('deleteModuleDlg', { name }) }),
    el('p', { textContent: tag ? t('deleteModuleText') : t('tagNotFound') }),
    out,
    el('p', {}, ...(tag ? [go, ' '] : []), el('button', { textContent: t('cancel'), onclick: () => dlg.close() })));
  dlg.showModal();
}

// --- Move a workflow to another module by dragging: changes its mod:<naam> tag in n8n (other tags are kept). ---
function enableWorkflowDragging(root) {
  let dragging = null; // { id, from }
  const cardsAll = () => [...root.querySelectorAll('.card')];
  const clear = () => cardsAll().forEach((c) => c.classList.remove('drop-into'));
  const moduleOf = (card) => (card.dataset.none ? null : card.dataset.module);
  for (const li of root.querySelectorAll('li[data-wf]')) {
    const handle = li.querySelector('.wf-drag');
    handle.addEventListener('mousedown', () => { li.draggable = true; });
    handle.addEventListener('mouseup', () => { li.draggable = false; });
    li.addEventListener('dragstart', (e) => {
      if (!li.draggable) return;
      e.stopPropagation();
      dragging = { id: li.dataset.wf, from: moduleOf(li.closest('.card')) };
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', li.dataset.wf);
    });
    li.addEventListener('dragend', () => { li.draggable = false; li.classList.remove('dragging'); clear(); dragging = null; });
  }
  for (const card of cardsAll()) {
    card.addEventListener('dragover', (e) => {
      if (!dragging || moduleOf(card) === dragging.from) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clear();
      card.classList.add('drop-into');
    });
    card.addEventListener('dragleave', (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove('drop-into'); });
    card.addEventListener('drop', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const { id, from } = dragging;
      clear();
      dragging = null;
      moveWorkflow(id, from, moduleOf(card));
    });
  }
}

async function moveWorkflow(id, from, to, { ask = true } = {}) {
  const w = state.workflows.find((x) => String(x.id) === String(id));
  if (!w || from === to) return;
  const tagMap = moduleTagMap(state.workflows, state.tags);
  const tagIds = retag(w, from, to, tagMap);
  if (!tagIds) return setStatus(t('moveNoChange', { name: w.name }), 'err');
  // Subflows this workflow calls (directly or indirectly) should live in the same module, so they move along.
  const subs = to ? planSubflowMoves(w, to, state.workflows, state.graph, tagMap) : [];

  if (!ask && !subs.length) {
    // Chosen from the dropdown and nothing else moves along: link right away.
    setStatus(t('linking', { name: w.name, to }));
    try {
      await state.client.setTags(w.id, tagIds);
    } catch (e) {
      return setStatus(t('linkFailed', { msg: e.message }), 'err');
    }
    await load();
    return setStatus(t('linked', { name: w.name, to }), 'ok');
  }

  const dlg = $('dlg');
  dlg.textContent = '';
  const out = el('p', { role: 'status' });
  const go = el('button', { className: 'primary', textContent: t('confirm') });
  const line = from && to ? t('moveFromTo', { from, to }) : to ? t('moveAddTo', { to }) : t('moveRemove', { from });

  // One row per subflow, with a checkbox. Shared subflows (also called by other workflows) are not pre-checked.
  const rows = subs.map((s) => {
    const cb = el('input', { type: 'checkbox', checked: s.checked });
    const now = s.from.length ? t('subNowIn', { list: s.from.join(', ') }) : t('subNoModule');
    const label = el('label', { className: 'check sub' }, cb, el('span', {},
      el('strong', { textContent: s.name }), ` (${now})`,
      ...(s.sharedBy.length ? [el('div', { className: 'warnline', textContent: t('subShared', { list: s.sharedBy.join(', ') }) })] : [])));
    return { s, cb, label };
  });

  go.onclick = async () => {
    go.disabled = true;
    const todo = [{ name: w.name, id: w.id, tagIds }, ...rows.filter((r) => r.cb.checked).map((r) => ({ name: r.s.name, id: r.s.id, tagIds: r.s.tagIds }))];
    let done = 0;
    try {
      for (const item of todo) {
        out.className = 'muted';
        out.textContent = t('busyStep', { i: done + 1, n: todo.length });
        await state.client.setTags(item.id, item.tagIds);
        done++;
      }
      dlg.close();
      await load();
      setStatus(done > 1 ? t('movedWithSubs', { name: w.name, n: done - 1 }) : t('moved', { name: w.name }), 'ok');
    } catch (e) {
      out.className = 'err';
      out.textContent = t('stoppedAt', { name: todo[done].name, msg: e.message }) + (done ? t('alreadyMoved', { n: done }) : '');
      go.disabled = false;
      if (done) load(); // show what did change
    }
  };

  dlg.append(
    el('h3', { textContent: t('moveTitle', { name: w.name }) }),
    el('p', { textContent: line }),
    ...(rows.length
      ? [el('p', { className: 'muted', textContent: t('moveSubsHint', { n: rows.length, to }) }), ...rows.map((r) => r.label)]
      : []),
    el('p', { className: 'muted', textContent: t('moveTagsOnly') }),
    out,
    el('p', {}, go, ' ', el('button', { textContent: t('cancel'), onclick: () => dlg.close() })),
  );
  dlg.showModal();
}

const visibleModuleNames = () => [...$('content').querySelectorAll('.card[data-module]')].map((c) => c.dataset.module);

async function reorder(names, focusName) {
  state.prefs.order = names;
  await savePrefs();
  render();
  if (focusName) {
    [...$('content').querySelectorAll('.card[data-module]')].find((c) => c.dataset.module === focusName)?.querySelector('.drag-handle')?.focus();
  }
}

function moveByStep(name, dir) {
  const names = visibleModuleNames();
  const i = names.indexOf(name);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= names.length) return;
  const next = [...names];
  [next[i], next[j]] = [next[j], next[i]];
  reorder(next, name);
}

/** HTML5 drag & drop on module cards, started from the handle only (so links and switches keep working). */
function enableDragging(root) {
  let dragged = null;
  const cards = () => [...root.querySelectorAll('.card[data-module]')];
  const clear = () => cards().forEach((c) => c.classList.remove('drop-before', 'drop-after'));
  const isBefore = (e, card) => {
    const all = cards();
    const multi = all.some((c) => c.offsetLeft !== all[0].offsetLeft);
    const r = card.getBoundingClientRect();
    return multi ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
  };
  for (const card of cards()) {
    const handle = card.querySelector('.drag-handle');
    if (!handle) continue;
    handle.addEventListener('mousedown', () => { card.draggable = true; });
    handle.addEventListener('mouseup', () => { card.draggable = false; });
    card.addEventListener('dragstart', (e) => {
      if (!card.draggable) return;
      dragged = card;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.module);
    });
    card.addEventListener('dragend', () => { card.draggable = false; card.classList.remove('dragging'); clear(); dragged = null; });
    card.addEventListener('dragover', (e) => {
      if (!dragged || dragged === card) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clear();
      card.classList.add(isBefore(e, card) ? 'drop-before' : 'drop-after');
    });
    card.addEventListener('dragleave', (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove('drop-before', 'drop-after'); });
    card.addEventListener('drop', (e) => {
      if (!dragged || dragged === card) return;
      e.preventDefault();
      const name = dragged.dataset.module;
      const names = moveInOrder(visibleModuleNames(), name, card.dataset.module, isBefore(e, card));
      clear();
      reorder(names, name);
    });
  }
}

const COPY_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback when the Clipboard API is refused: a temporary textarea.
    const ta = el('textarea', { value: text });
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error(t('copyFailedPlain'));
  }
}

/** Small copy icon for a webhook trigger. Click copies the production URL, Shift+click the test URL. */
function copyButton(item) {
  const btn = el('button', { className: 'copy', type: 'button' });
  btn.innerHTML = COPY_ICON;
  if (!item.copy) {
    btn.disabled = true;
    btn.title = t('copyUnavailable');
    return btn;
  }
  const idle = t('copyIdle', { url: item.copy.url });
  btn.title = idle;
  btn.setAttribute('aria-label', t('copyAria'));
  btn.onclick = async (e) => {
    const test = e.shiftKey;
    const text = test ? item.copy.testUrl : item.copy.url;
    try {
      await copyText(text);
      btn.innerHTML = CHECK_ICON;
      btn.classList.add('copied');
      btn.title = test ? t('copiedTestShort') : t('copiedShort');
      setStatus(t(test ? 'copiedTest' : 'copied', { url: text }), 'ok');
    } catch (err) {
      btn.title = t('copyFailed', { msg: err.message });
      setStatus(t('copyFailed', { msg: err.message }), 'err');
      return;
    }
    setTimeout(() => { btn.innerHTML = COPY_ICON; btn.classList.remove('copied'); btn.title = idle; }, 1500);
  };
  return btn;
}

/** Toggle switch. checked: 'true' | 'false' | 'mixed'. */
function makeSwitch(checked, { label, title, onclick }) {
  const btn = el('button', { className: 'switch', type: 'button', title, onclick });
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-checked', checked);
  btn.setAttribute('aria-label', title);
  btn.append(el('span', { className: 'track' }), el('span', { className: 'switch-label', textContent: label }));
  return btn;
}

// --- Module memory: which workflows a module switched off, so "Aan" restores exactly those. ---
// Stored per instance in chrome.storage.local: { [instanceId]: { [moduleName]: [workflowId, ...] } }
function rememberedFor(m) {
  const exist = new Map(m.workflows.map((w) => [String(w.id), w]));
  return (state.memory[m.name] || []).filter((id) => exist.has(id) && !exist.get(id).active);
}

async function loadMemory() {
  const { moduleMemory } = await chrome.storage.local.get('moduleMemory');
  state.allMemory = moduleMemory || {};
  state.memory = state.allMemory[state.instance.id] || {};
}

async function saveMemory(mutate) {
  await loadMemory();
  const mine = (state.allMemory[state.instance.id] ||= {});
  mutate(mine);
  for (const k of Object.keys(mine)) if (!mine[k].length) delete mine[k];
  await chrome.storage.local.set({ moduleMemory: state.allMemory });
  state.memory = mine;
}

const remember = (module, id) => saveMemory((mem) => { mem[module] = [...new Set([...(mem[module] || []), String(id)])]; });
const unremember = (module, id) => saveMemory((mem) => { mem[module] = (mem[module] || []).filter((x) => x !== String(id)); });
const forgetEverywhere = (id) => saveMemory((mem) => { for (const k of Object.keys(mem)) mem[k] = mem[k].filter((x) => x !== String(id)); });

/** A single workflow switch. A manual change overrides whatever the module remembered about it. */
function review(action, name, ids, { single = false } = {}) {
  const plan = planAction(action, ids, state.workflows, state.graph);
  const on = action === 'publish';
  showPlan(t(on ? 'switchWfOn' : 'switchWfOff', { name }), plan, ids, {
    snapshotOptional: true,
    onStepDone: (s) => forgetEverywhere(s.id),
  });
}

/** Module switch. 'off': all active workflows go off (remembered). 'on': only the remembered ones come back on. */
function reviewModule(m, dir) {
  const memberIds = m.workflows.map((w) => w.id);
  if (dir === 'off') {
    const plan = planAction('unpublish', memberIds, state.workflows, state.graph);
    return showPlan(t('planModuleOff', { name: m.name }), plan, memberIds, {
      confirmWord: m.name,
      note: t('noteModuleOff'),
      onStepDone: (s) => remember(m.name, s.id),
    });
  }
  const ids = rememberedFor(m);
  if (!ids.length) {
    return showPlan(t('planModuleOn', { name: m.name }), { steps: [], warnings: [] }, memberIds, {
      emptyMessage: t('nothingToRestore'),
    });
  }
  const plan = planAction('publish', ids, state.workflows, state.graph);
  showPlan(t('planModuleOn', { name: m.name }), plan, memberIds, {
    confirmWord: m.name,
    note: t('noteModuleOn'),
    onStepDone: (s) => unremember(m.name, s.id),
  });
}

function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = el('a', { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showPlan(title, plan, scopeIds, { snapshotOptional = false, onStepDone, note, emptyMessage, confirmWord } = {}) {
  const dlg = $('dlg');
  dlg.textContent = '';
  if (!plan.steps.length) {
    dlg.append(el('h3', { textContent: title }), el('p', { textContent: emptyMessage || t('nothingToDo') }),
      ...plan.warnings.map((w) => el('p', { className: 'warnline', textContent: '⚠ ' + w })),
      el('button', { textContent: t('close'), onclick: () => dlg.close() }));
    return dlg.showModal();
  }
  const snapshotName = () => `n8n-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const snap = makeSnapshot(state.instance.url, state.workflows.filter((w) => !scopeIds || scopeIds.includes(w.id)));
  const items = plan.steps.map((s) => el('li', { textContent: t(s.action === 'publish' ? 'stepOn' : 'stepOff', { name: s.name }) }));
  // A snapshot is required for bigger changes (more than 1 workflow), optional for a single switch.
  const optional = snapshotOptional || plan.steps.length === 1;
  // On a Productie instance you also have to type a word (the module name, or "productie"/"production") before confirming.
  const isProd = state.instance.env === 'productie';
  const word = confirmWord || t('prodWord');
  let snapOk = optional;
  let typedOk = !isProd;
  const run = el('button', { className: 'primary', textContent: t('confirm') });
  const updateRun = () => { run.disabled = !(snapOk && typedOk); };
  updateRun();
  const snapBtn = el('button', {
    textContent: optional ? t('snapshotOptional') : t('snapshotFirst'),
    onclick: () => { download(snapshotName(), snap); snapOk = true; updateRun(); snapBtn.textContent = t('snapshotDone'); },
  });
  let prodBlock = null;
  if (isProd) {
    const typed = el('input', { id: 'prodWord', autocomplete: 'off', spellcheck: false, placeholder: word });
    typed.oninput = () => { typedOk = typed.value.trim().toLowerCase() === word.trim().toLowerCase(); updateRun(); };
    prodBlock = el('div', { className: 'prodconfirm' },
      el('label', { htmlFor: 'prodWord' }, t('prodBefore'), el('strong', { textContent: envInfo('productie').label }), t('prodType'), el('code', { textContent: word }), t('prodAfter')),
      typed);
  }
  const out = el('p', { role: 'status' });
  let remembered = true;
  try { remembered = localStorage.getItem('refreshTabs') !== '0'; } catch { /* storage unavailable */ }
  const chk = el('input', { type: 'checkbox', id: 'refreshTabs', checked: remembered });
  chk.onchange = () => { try { localStorage.setItem('refreshTabs', chk.checked ? '1' : '0'); } catch { /* ignore */ } };
  run.onclick = () => execute(plan.steps, items, run, out, dlg, chk, onStepDone);
  dlg.append(el('h3', { textContent: title }),
    ...(note ? [el('p', { className: 'muted', textContent: note })] : []),
    ...plan.warnings.map((w) => el('p', { className: 'warnline', textContent: '⚠ ' + w })),
    el('p', { className: 'muted', textContent: t('planInstance', { name: state.instance.name, env: envInfo(state.instance.env).color ? ` (${envInfo(state.instance.env).label})` : '' }) }),
    el('ol', {}, ...items), out,
    el('label', { className: 'check', htmlFor: 'refreshTabs' }, chk, t('refreshTabs')),
    ...(prodBlock ? [prodBlock] : []),
    el('p', {}, snapBtn, ' ', run, ' ', el('button', { textContent: t('cancel'), onclick: () => dlg.close() })));
  dlg.showModal();
}

// Reload open n8n tabs showing the changed workflows (or the workflow list) so the new status is visible at once.
async function refreshN8nTabs(ids) {
  if (!ids.length) return;
  try {
    const tabs = await chrome.tabs.query({});
    for (const id of tabsToRefresh(tabs, state.instance.url, ids)) await chrome.tabs.reload(id);
  } catch (e) {
    console.warn('reloading tabs failed:', e?.message);
  }
}

async function execute(steps, items, runBtn, out, dlg, chk, onStepDone) {
  state.busy = true;
  runBtn.disabled = true;
  const changed = [];
  const finish = () => (chk?.checked ? refreshN8nTabs(changed) : Promise.resolve());
  for (let i = 0; i < steps.length; i++) {
    out.textContent = t('busyStep', { i: i + 1, n: steps.length });
    try {
      await (steps[i].action === 'publish' ? state.client.publish(steps[i].id) : state.client.unpublish(steps[i].id));
      changed.push(steps[i].id);
      try { await onStepDone?.(steps[i]); } catch (e) { console.warn('updating module memory failed:', e?.message); }
      items[i].className = 'done';
      items[i].textContent += ' ✓';
    } catch (e) {
      items[i].className = 'fail';
      items[i].textContent += ' ✗ ' + e.message;
      out.className = 'err';
      out.textContent = t('stoppedStep', { i: i + 1, n: steps.length });
      state.busy = false;
      await finish();
      dlg.append(el('button', { textContent: t('close'), onclick: () => { dlg.close(); load(); } }));
      return;
    }
  }
  out.className = 'ok';
  out.textContent = t('done');
  state.busy = false;
  await finish();
  dlg.append(el('button', { textContent: t('close'), onclick: () => { dlg.close(); load(); } }));
}

$('reload').onclick = load;
$('collapseAll').onclick = () => state.instance && toggleAll();
$('addModule').onclick = addModuleDialog;
initTips($('tips'));
$('settings').onclick = () => chrome.runtime.openOptionsPage();
$('search').oninput = () => state.instance && render();
$('restore').onclick = () => (state.instance ? $('file').click() : setStatus(t('noInstance'), 'err'));
$('file').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const snap = parseSnapshot(await f.text());
    checkSnapshotInstance(snap, state.instance.url);
    const plan = planRestore(desiredStates(snap), state.workflows, state.graph);
    showPlan(t('rollbackTitle', { at: snap.takenAt }), plan, null);
  } catch (err) {
    setStatus(err.message, 'err');
  }
};

// Another tab in this window: load what fits it.
chrome.tabs.onActivated.addListener(({ windowId }) => { if (state.windowId == null || windowId === state.windowId) load(); });
// n8n is a single-page app: moving between pages changes the URL without reloading. On the same instance, only switch
// the view (no new workflow list and last-run lookups on every click); otherwise load everything for the new site.
// ↻ Vernieuwen still reloads everything.
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (!tab.active || (state.windowId != null && tab.windowId !== state.windowId)) return;
  if ((info.url || info.status === 'complete') && state.workflows.length && applyRoute(tab.url)) return;
  if (info.status === 'complete') load();
});
chrome.storage.onChanged.addListener((c) => {
  if (c.instances) return load();
  if (c.settings) {
    if (languageChanged(c.settings.newValue)) return location.reload(); // simplest: rebuild everything in the new language
    state.settings = readSettings(c.settings.newValue);
    if (state.instance && state.workflows.length) { render(); renderAgendaSection(); } // link tooltips follow the setting
  }
});
load();
