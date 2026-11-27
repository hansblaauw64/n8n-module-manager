# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [semantic versioning](https://semver.org/).

Lines starting with **Fork note** need action in forks; see [CONTRIBUTING.md](CONTRIBUTING.md#keeping-a-fork-up-to-date).

## [Unreleased]

## [0.4.0] - 2026-11-27

### Added
- Delete a workflow from the panel: a bin icon on each workflow row. The confirmation says plainly that n8n deletes at once and for good (no archive, no Rollback), warns when the workflow is on or called by others, offers a JSON copy to download first, and only enables the button after you type the exact name. Uses `DELETE /workflows/{id}`, tested in `docs/findings.md`.
- A test that fails when a key in `messages.js` is defined twice (the later one silently wins).

## [0.3.2] - 2026-11-27

### Fixed
- Switching on a workflow whose sub-workflow was off failed: n8n refuses with 400 "Please publish all referenced sub-workflows first". The plan now switches those sub-workflows on first (also indirectly called ones), with a note per sub-workflow; the snapshot includes them.
- When the first step of a plan failed, the message said "the earlier steps were carried out". It now says nothing was changed.
- `npm run pack` no longer puts two `LICENSE` files in the zip when `extension/` has its own copy.

## [0.3.1] - 2026-11-26

The git history starts here: it was begun afresh at 0.3.1, so the versions below have no tag or commits.

### Fixed
- Moving a workflow by dragging it (the confirmation dialog, also when subworkflows move along) always stopped with "t is not a function" in 0.3.0: a loop variable hid the translation function. Nothing was moved.

### Changed
- The docs and tests use `n8n.example.com` instead of the address of the instance the API was tested on.

## 0.3.0 - 2026-11-26

### Added
- Failed executions have a collapsible **Foutmelding** / **Error** section: message, node, HTTP status, description and stack trace, fetched with `GET /executions/{id}?includeData=true` only when opened. Request details (`context`) are never shown. Findings in `docs/findings.md`.
- The interface is available in Dutch and English. Settings → Preferences → Language: Automatic (Chrome's language, the default), Nederlands or English. All texts are in `extension/src/lib/messages.js` as Dutch/English pairs; a test checks that both are always there.
- Workflows with only a manual trigger show "Handmatig" / "Manual" instead of an on/off switch: n8n can't publish them. They don't count towards a module's on/off state, are left out of plans to switch on (with a note), and a rollback skips them.
- **Fork note:** `brand.tips.fallback.text` in `brand/brand.js` can now be `{ nl, en }` instead of one string.
- The settings page has tabs: **Instances** and **Voorkeuren** (preferences). The first preference is where links from the panel open: a new window (default), a new tab next to the current one, or the current tab.
- On a workflow page (`/workflow/<id>`), the panel shows that workflow's executions: status, start time, duration and how it was started, 20 at a time with **Meer laden**, a status filter, and a link to each execution in n8n. Tabs switch between this view and the module overview. Other pages (`/workflows`, `/assistant`, …) show the overview as before.
- The panel follows navigation inside n8n without reloading the workflow list.
- `npm run pack` packs the extension into `dist/n8n-module-manager-<version>.zip` (with `manifest.json` at the root and the LICENSE), to share, attach to a release or upload to the Chrome Web Store. No dependencies.
- Rollback refuses a snapshot taken on another instance (or one without an instance address), so a snapshot from a copied test instance can't change production by matching workflow ids.

- `npm run demo` records a demo video of the panel with made-up data (`demo/`), using `playwright-core` (dev dependency) and ffmpeg.

### Fixed
- The view tabs no longer show on the module overview.

### Changed
- The toolbar icon is greyed out and can't be clicked on tabs that aren't a configured n8n instance. Previously, a click there opened the settings. Settings remain available via right-click on the icon → Options.
- While no instance has been added yet, the icon stays clickable everywhere. A click opens the settings with the tab's address filled in, so on your n8n page you only need to enter the API key.
- All documentation is now in English: README.md, PLAN.md, docs/findings.md and docs/test-checklist.md. The UI is still in Dutch; the README quotes UI labels with their English meaning.
- `package.json` declares the MIT license.

## 0.2.0 - 2026-11-26

### Added
- `CONTRIBUTING.md` explains setup, the project rules, rebranding, keeping a fork up to date and releasing.
- GitHub Actions workflow that runs the unit tests on every push and pull request.
- `npm run spike` script.

### Changed
- All brand-specific settings are now in `extension/brand/`:
  - `brand.js`: company name, tips feed URL, allowed link host and fallback text. Set `tips` to `null` to switch the footer off.
  - `brand.css`: the brand colors.
  - The logo and the icons.
- The panel and the toolbar tooltip take their title from `manifest.json`, so it is no longer hard-coded.
- **Fork note:** the logo and icons moved from `extension/assets/` to `extension/brand/`. If you replaced them, move your versions too. If you changed colors in `panel.css`, move them to `brand/brand.css`.
- `isThingsLink(url)` in `src/lib/rss.js` is now `isAllowedLink(url, host)`.

## 0.1.0 - 2026-11-25

First version:
- Module cards based on `mod:` tags, with on/off switches in dependency order.
- Snapshots and rollback.
- Drag and drop for modules and workflows; subflows move along with the workflow that calls them.
- Triggers, readable schedules and copyable webhook URLs.
- Day agenda with "Alleen actief" and "Alleen vaste tijden" filters.
- Last-run status and a toolbar badge for failed runs.
- Search inside workflow nodes.
- Multiple instances with environment labels and an extra confirmation step for Productie.
- https-only instances, a bundled font, and a tips footer from an RSS feed.

[Unreleased]: https://github.com/hansblaauw64/n8n-module-manager/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/hansblaauw64/n8n-module-manager/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/hansblaauw64/n8n-module-manager/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/hansblaauw64/n8n-module-manager/releases/tag/v0.3.1
