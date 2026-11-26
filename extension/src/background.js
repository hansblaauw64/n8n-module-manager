// Side panel is only enabled on tabs whose origin matches a configured n8n instance.
import { getInstances, findInstanceForUrl } from './storage.js';

// The toolbar icon is greyed out (chrome.action.disable) on every tab that isn't a configured n8n instance,
// so the extension can only be opened on n8n. Settings stay reachable via right-click on the icon → Options,
// the ⚙ button in the panel, and they open by themselves on first install.
// Exception: while no instance is configured yet, the icon stays clickable everywhere. A click then opens the
// settings with the tab's address filled in, so you can set up the extension from your n8n page.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
// sidePanel.open() must run synchronously inside the click (no await before it), or Chrome rejects it.
// On a tab without a panel (no instances yet, or a race while the tab changes URL) open() rejects:
// then open the settings with the tab's address, which the settings page offers to add.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
    console.warn('sidePanel.open failed:', err?.message);
    let site = '';
    try { site = new URL(tab.url).origin; } catch { /* no usable url */ }
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/options/options.html') + '?site=' + encodeURIComponent(site) + '&err=' + encodeURIComponent(err?.message || ''),
    });
  });
});

async function updateTab(tab) {
  try {
    if (!tab || tab.id == null) return;
    const instances = await getInstances();
    const match = tab.url ? findInstanceForUrl(instances, tab.url) : null;
    await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'src/panel/panel.html', enabled: Boolean(match) });
    const clickable = Boolean(match) || !instances.length; // no instances yet: clicking opens the setup
    await (clickable ? chrome.action.enable(tab.id) : chrome.action.disable(tab.id));
    if (!match) {
      // The panel sets a badge (failed runs) on n8n tabs; clear it when this tab is no longer an n8n tab.
      await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
      await chrome.action.setTitle({ tabId: tab.id, title: chrome.runtime.getManifest().action?.default_title || chrome.runtime.getManifest().name });
    }
  } catch (err) {
    console.warn('updateTab failed:', err?.message); // e.g. tab closed meanwhile
  }
}

async function updateAll() {
  await chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
  // Default for all tabs, including new ones before their first update: greyed out, unless there are no instances
  // yet (then clickable, to open the setup). Matching tabs enable it in updateTab().
  const none = !(await getInstances()).length;
  await (none ? chrome.action.enable() : chrome.action.disable()).catch(() => {});
  for (const tab of await chrome.tabs.query({})) await updateTab(tab);
}

chrome.runtime.onInstalled.addListener(async (d) => {
  await updateAll();
  if (d.reason === 'install' && !(await getInstances()).length) chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(updateAll);
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.url || info.status === 'complete') updateTab(tab);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then(updateTab).catch(() => {});
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.instances) updateAll();
});
