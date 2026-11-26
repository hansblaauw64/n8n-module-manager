// Brand settings. A fork changes this folder (brand/) and manifest.json, and nothing else,
// so updates from upstream merge without conflicts. See CONTRIBUTING.md, "Rebranding a fork".
//
// The extension name and toolbar title come from manifest.json ("name", "action.default_title").
// Colors live in brand.css. Logo and icons are the image files in this folder.
export const BRAND = {
  /** Company name: alt text of the logo. */
  name: 'things.io',

  /**
   * Footer with rotating tips from an RSS feed. Set to null to switch the footer off.
   * The feed's host also needs to be in "host_permissions" in manifest.json, or the fetch is blocked.
   */
  tips: {
    feedUrl: 'https://things.io/rss.xml',
    /** Only https links on this host (or its subdomains) are shown; other feed items are dropped. */
    linkHost: 'things.io',
    /** Shown when the feed cannot be loaded and nothing is cached. `text` can be one string or { nl, en }. */
    fallback: {
      text: { nl: "things.io · AI, API's en automation voor het MKB", en: "things.io · AI, APIs and automation for small businesses" },
      linkText: 'things.io',
      url: 'https://things.io/',
    },
  },
};
