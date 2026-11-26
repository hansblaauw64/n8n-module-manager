// Footer with rotating tips from the RSS feed in brand/brand.js (BRAND.tips; null switches the footer off).
// Fetching needs host permission for the feed's host (manifest). The feed is cached for 12 hours in
// chrome.storage.local; no data about the user or the n8n instance is sent (a plain GET of the feed).
// The footer can be hidden: only a thin bar with a "show tips" button stays. The choice is kept for the browser
// session only (chrome.storage.session), so after reloading the extension the footer is shown again by default.
import { parseRss, isAllowedLink } from '../lib/rss.js';
import { t, getLanguage } from '../lib/i18n.js';
import { BRAND } from '../../brand/brand.js';

const TIPS = BRAND.tips;
const TTL_MS = 12 * 60 * 60 * 1000;
const ROTATE_MS = 12000;
const MAX_ITEMS = 40;

async function loadItems() {
  let cache = null;
  try { ({ tipsCache: cache } = await chrome.storage.local.get('tipsCache')); } catch { /* storage unavailable */ }
  if (cache && Date.now() - cache.at < TTL_MS && cache.items?.length) return cache.items;
  try {
    const res = await fetch(TIPS.feedUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const items = parseRss(await res.text(), MAX_ITEMS);
    if (items.length) {
      try { await chrome.storage.local.set({ tipsCache: { at: Date.now(), items } }); } catch { /* ignore */ }
      return items;
    }
  } catch { /* offline or blocked: fall back to the cache */ }
  return cache?.items || [];
}

function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export async function initTips(root) {
  if (!TIPS) return; // footer switched off for this brand
  const label = root.querySelector('.tip-label');
  const link = root.querySelector('.tip-title');
  const desc = root.querySelector('.tip-desc');
  const nav = root.querySelector('.tip-nav');
  const prev = root.querySelector('.tip-prev');
  const next = root.querySelector('.tip-next');
  const count = root.querySelector('.tip-count');
  const body = root.querySelector('.tip-body');
  const fallback = root.querySelector('.tip-fallback');
  const toggle = root.querySelector('.tip-toggle');
  const fb = TIPS.fallback;
  if (fb) {
    // fallback.text can be one string or { nl, en } per language (brand/brand.js).
    const text = typeof fb.text === 'object' && fb.text ? fb.text[getLanguage()] ?? fb.text.nl ?? '' : fb.text;
    const a = Object.assign(document.createElement('a'), { href: fb.url, textContent: fb.linkText || fb.url, target: '_blank', rel: 'noopener noreferrer' });
    fallback.append(text ? text + ' · ' : '', a);
  }

  // Hide / show. Default: shown. Remembered only until the extension is reloaded or the browser is closed.
  let collapsed = false;
  try { ({ tipsCollapsed: collapsed = false } = await chrome.storage.session.get('tipsCollapsed')); } catch { /* session storage unavailable */ }
  try { chrome.storage.local.remove('tipsCollapsed'); } catch { /* an older version stored the choice permanently: drop it */ }
  let current = null; // text of the current tip label
  const apply = () => {
    root.classList.toggle('collapsed', collapsed);
    toggle.textContent = collapsed ? t('tipsShow') : t('tipsHide');
    toggle.title = collapsed ? t('tipsShowTitle') : t('tipsHideTitle');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    label.textContent = collapsed ? t('tips') : current || t('tip');
  };
  toggle.onclick = async () => {
    collapsed = !collapsed;
    apply();
    try { await chrome.storage.session.set({ tipsCollapsed: collapsed }); } catch { /* ignore */ }
  };

  const items = shuffle((await loadItems()).filter((i) => isAllowedLink(i.link, TIPS.linkHost)));
  root.hidden = false;
  if (!items.length) { apply(); return; } // static fallback text stays visible

  fallback.hidden = true;
  body.hidden = false;
  nav.hidden = false;

  let i = 0;
  let paused = false;
  const show = (n) => {
    i = (n + items.length) % items.length;
    const item = items[i];
    current = item.category ? t('tipCategory', { category: item.category }) : t('tip');
    label.textContent = collapsed ? t('tips') : current;
    link.textContent = item.title;
    link.href = item.link; // validated above: https on TIPS.linkHost only
    desc.textContent = item.description;
    desc.hidden = !item.description;
    count.textContent = `${i + 1}/${items.length}`;
    body.classList.remove('swap');
    void body.offsetWidth; // restart the fade animation
    body.classList.add('swap');
  };
  prev.onclick = () => show(i - 1);
  next.onclick = () => show(i + 1);
  root.addEventListener('mouseenter', () => { paused = true; });
  root.addEventListener('mouseleave', () => { paused = false; });
  root.addEventListener('focusin', () => { paused = true; });
  root.addEventListener('focusout', () => { paused = false; });
  setInterval(() => { if (!paused && !collapsed && !document.hidden) show(i + 1); }, ROTATE_MS);
  show(0);
  apply();
}
