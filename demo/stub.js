// Fake chrome.* so the panel runs in a normal browser tab (copied from the chrome-extension-mv3 skill). Demo only.
// Load it as the FIRST script in <head>: <script src="/.harness/stub.js"></script>
// Adjust MANIFEST, TABS, the seed data in `store`, and the fetch routes for the project.
//
// In the test:
//   window.__store.local          what the page saved
//   window.__calls                permission requests, opened tabs/windows, badge changes, …
//   window.__requests             every fetch (url, method, body)
//   window.__fire('tabs.onUpdated', 1, { url }, tab)   call the listeners the page registered

const MANIFEST = { name: 'things.io Modules', version: '0.0.0', action: { default_title: 'things.io Modules' } };
const TABS = [{ id: 1, windowId: 1, url: 'http://localhost:5678/', active: true }];

// Seed storage here, e.g. instances: [{ id: '1', name: 'Test', url: 'http://localhost:5678', key: 'TEST-KEY' }]
const store = { local: {}, session: {}, sync: {} };
window.__store = store;
window.__calls = [];
window.__tabs = TABS;

const area = (name) => ({
  get: async (keys) => {
    const s = store[name];
    if (keys == null) return { ...s };
    if (typeof keys === 'string') return keys in s ? { [keys]: s[keys] } : {};
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in s).map((k) => [k, s[k]]));
    return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in s ? s[k] : d])); // object with defaults
  },
  set: async (o) => { Object.assign(store[name], o); },
  remove: async (keys) => { for (const k of [].concat(keys)) delete store[name][k]; },
  clear: async () => { store[name] = {}; },
});

// Event objects (chrome.x.onY): addListener collects the listener, __fire('x.onY', ...args) calls them.
const listeners = {};
const event = (name) => ({
  addListener: (fn) => { (listeners[name] ||= []).push(fn); },
  removeListener: (fn) => { listeners[name] = (listeners[name] || []).filter((f) => f !== fn); },
  hasListener: (fn) => (listeners[name] || []).includes(fn),
});
window.__fire = async (name, ...args) => { for (const fn of listeners[name] || []) await fn(...args); };

// A namespace: explicit members first; onX becomes an event; any other call is logged and resolves to undefined.
const ns = (name, members = {}) => new Proxy(members, {
  get: (t, k) => {
    if (k in t) return t[k];
    if (typeof k !== 'string') return undefined;
    if (/^on[A-Z]/.test(k)) return (t[k] = event(`${name}.${k}`));
    return (...args) => { window.__calls.push([`${name}.${k}`, ...args]); return Promise.resolve(undefined); };
  },
});

const ALL = {
  runtime: ns('runtime', {
    id: 'test-extension',
    getManifest: () => MANIFEST,
    getURL: (p) => '/' + String(p).replace(/^\//, ''),
    sendMessage: async () => undefined,
  }),
  storage: ns('storage', { local: area('local'), session: area('session'), sync: area('sync'), onChanged: event('storage.onChanged') }),
  permissions: ns('permissions', {
    request: async (p) => { window.__calls.push(['permissions.request', p]); return true; },
    contains: async () => true,
  }),
  tabs: ns('tabs', {
    query: async (q = {}) => TABS.filter((t) => !q.active || t.active),
    get: async (id) => TABS.find((t) => t.id === id),
    create: async (o) => { window.__calls.push(['tabs.create', o]); return { id: 99, ...o }; },
  }),
  i18n: ns('i18n', { getUILanguage: () => navigator.language, getMessage: (k) => k }),
  windows: ns('windows', {
    getCurrent: async () => ({ id: 1 }),
    create: async (o) => { window.__calls.push(['windows.create', o]); return { id: 3 }; },
  }),
};
window.chrome = new Proxy(ALL, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? (t[k] = ns(k)) : undefined) });

// Fake API responses. Return a Response for URLs you want to fake; everything else goes to the real network.
const realFetch = window.fetch.bind(window);
window.__requests = [];
window.fetch = async (url, opts = {}) => {
  const u = String(url);
  window.__requests.push({ url: u, method: opts.method || 'GET', body: opts.body });
  // Example route:
  // if (u.includes('/api/v1/workflows')) return Response.json({ data: [], nextCursor: null });
  return realFetch(url, opts);
};
