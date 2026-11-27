# Contributing and forking

This is a Chrome extension (Manifest V3, side panel) for n8n. It groups workflows into modules and switches a whole module on or off in dependency order. User documentation is in [README.md](README.md); this file is for developers.

## Quick start

There is no build step and there are no runtime dependencies. You need Chrome 116+ and Node 20+ (for the tests only).

```sh
git clone https://github.com/<you>/n8n-module-manager.git
cd n8n-module-manager
npm test
```

1. Open `chrome://extensions`, switch on **Developer mode** and click **Load unpacked**.
2. Select the `extension/` folder, the one that contains `manifest.json`.
3. On the settings page, add an n8n instance with its URL and an API key (in n8n: Settings → n8n API). **Use a test instance.**
4. Open that instance in a tab and click the extension icon.

After a code change, click ↻ on the extension card in `chrome://extensions` and reload the n8n tab.

## Layout

```
extension/
  manifest.json          name, version, permissions, icons
  brand/                 everything brand-specific (see "Rebranding a fork")
  assets/fonts/          bundled Inter font (SIL OFL)
  src/background.js      enables the side panel per tab, opens it on icon click
  src/storage.js         instances in chrome.storage.local
  src/options/           settings page
  src/panel/             the side panel UI (panel.js, agenda.js, tips.js)
  src/lib/               pure logic: no DOM, no chrome.* APIs
tests/lib.test.js        unit tests for src/lib (node --test)
spike/spike.mjs          Phase 0 checks against a live instance (reads .env)
scripts/pack.mjs         npm run pack: zip of extension/ for sharing and releases
docs/                    findings from the spike, manual test checklist
```

**The one rule:** logic goes in `src/lib/` as plain functions that take data and return data. That is the part we can unit-test. The `src/panel/` and `src/options/` code only wires that logic to the DOM and `chrome.*`.

## Project rules

These keep the extension safe to run against real n8n instances. Pull requests that break them will not be merged.

- **Official public API only** (`<instance>/api/v1` with the `X-N8N-API-KEY` header). Never the internal `/rest` endpoints.
- **Don't guess API behavior.** If you rely on something the n8n docs don't state, test it against a real instance and note the result in `docs/findings.md`.
- **Every change to n8n is confirmed first.** Show the plan, then ask for confirmation. For a whole module, require a snapshot. Production instances need the extra typed confirmation.
- **The API key stays in `chrome.storage.local`.** Never log it, never put it in a URL, never send it anywhere other than its own instance. Instances must use https; plain http is allowed only for localhost.
- **Feed content is data.** Show it as text only (`textContent`, never `innerHTML`), and only link to the configured brand host.
- **No new runtime dependencies or build step** without discussing it first in an issue.

## Testing

- `npm test` runs the unit tests. GitHub Actions runs them on every push and pull request.
- The UI and the real API calls are not covered by automated tests. Before a release, go through [docs/test-checklist.md](docs/test-checklist.md) on a test instance, starting with a module of harmless workflows.
- `npm run spike` (see the README, section "Spike") checks API behavior against a test instance configured in `.env`. **Never point it at production.**

## Demo video

`npm run demo` records `demo/out/demo.mp4` from the real panel code with made-up data (see the README). When you add or change a feature that people see, add or update its step in `demo/record.mjs` and check the video before you open a pull request.

## Rebranding a fork

All brand-specific parts live in two places, so you can change the branding without touching the code:

| What | Where |
| --- | --- |
| Extension name, short name, toolbar tooltip | `extension/manifest.json`: `name`, `short_name`, `action.default_title` |
| Company name (logo alt text) | `extension/brand/brand.js`: `name` |
| Tips footer: feed URL, allowed link host, fallback text | `extension/brand/brand.js`: `tips` (set it to `null` to switch the footer off) |
| Feed host permission | `extension/manifest.json`: `host_permissions`. Replace `https://things.io/*` with your feed's host, or remove the entry when `tips` is `null`. |
| Colors (buttons, top bar, environment labels, focus ring) | `extension/brand/brand.css` |
| Logo in the top bar | `extension/brand/logo.png` (shown about 28 px high on a dark bar) |
| Icons | `extension/brand/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png` (sources: `icon.svg`, `icon-16.svg`) |

Commit these changes on your fork's `main` (or on a `brand` branch). Upstream changes these files rarely. Merges then only conflict when both sides edited the same lines, and those are easy to resolve by hand.

## Keeping a fork up to date

```sh
git remote add upstream https://github.com/hansblaauw64/n8n-module-manager.git   # once
git fetch upstream
git merge upstream/main          # or: git rebase upstream/main
npm test
```

Then reload the extension in `chrome://extensions`. Read [CHANGELOG.md](CHANGELOG.md) before merging: entries marked **Fork note** tell you about changes to `manifest.json` or `brand/` that you need to copy into your own versions.

To stay on a known-good version, merge a release tag (`git merge v0.3.1`) instead of `main`.

## Versions and releases

We use [semantic versioning](https://semver.org/). The version lives in `extension/manifest.json` (Chrome reads it there) and in `package.json`; keep the two the same.

- **Patch** (0.2.1): bug fixes.
- **Minor** (0.3.0): new features, or anything that changes `manifest.json` or `brand/`.
- **Major** (1.0.0): changes that break stored settings or need manual steps.

To release:

1. Move the **Unreleased** section of `CHANGELOG.md` under a new version heading, with the date.
2. Bump the version in `manifest.json` and `package.json`.
3. Commit with the message `Release vX.Y.Z`, then tag and push:

   ```sh
   git tag vX.Y.Z
   git push origin main --tags
   ```

4. Run `npm run pack` before the release commit, so `dist/` holds the new zip (the script removes the previous one). Optionally, create a GitHub release from the tag with `dist/n8n-module-manager-X.Y.Z.zip` attached and the changelog entry as its notes. The script refuses to pack when the two versions differ.

## Pull requests

- Keep each pull request to one subject, with tests for new logic in `src/lib/`.
- Add a line under **Unreleased** in `CHANGELOG.md`. If forks need to act on the change, prefix the line with **Fork note:**.
- Code, comments and documentation are in English. The UI is in Dutch and English: **every text goes in `extension/src/lib/messages.js`** as a `[dutch, english]` pair, and the code calls `t('key', { values })` (from `lib/i18n.js`). Static HTML text gets a `data-i18n` attribute (see `src/i18n-dom.js`). A test fails when a key lacks one of the languages or their `{placeholders}` differ. When the README mentions a UI label, quote the Dutch one and give the English label the first time.
