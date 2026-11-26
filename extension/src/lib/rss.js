// Pure: minimal RSS 2.0 reader for the tips feed (brand/brand.js). No DOM, no chrome.* APIs.
// Feed content is external data: it is only ever shown as text, and links are limited to the brand host.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/<[^>]*>/g, '') // never keep markup
    .replace(/\s+/g, ' ')
    .trim();
}

/** Only https links on `host` or its subdomains are allowed. */
export function isAllowedLink(url, host) {
  try {
    const u = new URL(url);
    const h = String(host || '').toLowerCase();
    return Boolean(h) && u.protocol === 'https:' && (u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

const tag = (xml, name) => (xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)) || [])[1] ?? '';

/** Returns up to `max` items: [{ title, link, description, category }], newest first as in the feed. */
export function parseRss(xml, max = 40) {
  const items = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const title = decodeEntities(tag(body, 'title'));
    const link = decodeEntities(tag(body, 'link'));
    if (!title || !/^https:\/\//i.test(link)) continue; // the host check is done by the caller (isAllowedLink)
    items.push({
      title,
      link,
      description: decodeEntities(tag(body, 'description')),
      category: decodeEntities(tag(body, 'category')),
    });
    if (items.length >= max) break;
  }
  return items;
}
