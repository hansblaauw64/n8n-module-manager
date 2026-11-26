// chrome.storage.local wrapper: instances = [{ id, name, url, key }]
import { originOf } from './lib/n8n.js';

export async function getInstances() {
  const { instances } = await chrome.storage.local.get('instances');
  return Array.isArray(instances) ? instances : [];
}

export const saveInstances = (instances) => chrome.storage.local.set({ instances });

export function findInstanceForUrl(instances, tabUrl) {
  let origin;
  try { origin = new URL(tabUrl).origin; } catch { return null; }
  return instances.find((i) => { try { return originOf(i.url) === origin; } catch { return false; } }) || null;
}
