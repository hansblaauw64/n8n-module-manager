# things.io Modules (n8n Module Manager)

A Chrome extension (Manifest V3, side panel) that groups n8n workflows into **modules**. One switch turns a whole module on or off, in the right dependency order.

A module is just a tag `mod:<name>` in n8n. There is no separate database: everything the panel shows comes live from the n8n public API (`/api/v1`).

The interface is in Dutch or English (see Settings → Preferences → Language). This README quotes the Dutch labels and gives the English label the first time each one comes up, e.g. **Vernieuwen** (Refresh).

Want to fork the extension, rebrand it or contribute? See [CONTRIBUTING.md](CONTRIBUTING.md). Changes per version are in [CHANGELOG.md](CHANGELOG.md).

## Installation
1. Get the extension, in one of two ways:
   - **From a zip:** take `dist/n8n-module-manager-<version>.zip` from the repository (it holds the zip of the current version; older ones are in the release tags), or make it yourself with `npm run pack`. Unzip it to a folder you keep, e.g. `Documents\n8n-module-manager`.
   - **From the repository:** use the `extension/` folder itself.

   Open `chrome://extensions`, switch on **Developer mode**, and drag that folder onto the page (or click **Load unpacked** and select it). It's the folder that contains `manifest.json`.
   - Keep the folder where it is: Chrome loads the extension from it, and its ID (and so your saved instances and keys) depends on the folder's location. To update, replace the folder's contents and click ↻ on the extension in `chrome://extensions`.
   - Why no `.crx`: Chrome on Windows and macOS blocks a packed `.crx` that doesn't come from the Chrome Web Store, so loading the folder is the way to install it outside the store.
2. The settings page opens. Enter the **URL** (e.g. `https://n8n.example.com`) and the **API key** (in n8n: Settings → n8n API). Chrome asks for access to that host, and then the connection is tested.
   - You can add several instances, each with its own key.
   - The panel picks the instance by the domain of the active tab, so two instances on the same domain with different paths can't be told apart.
   - Give each instance an **environment**: Test, Acceptatie (acceptance) or Productie (production). The panel shows it in three places, so you don't mix up test and production:
     - as a badge next to the name;
     - as a line under the header;
     - in every confirmation dialog.

     The badge and line use the things.io blue for every environment. **Productie** gets a solid badge with a thicker line (4 px), so it stands out at a glance. **Test** and **Acceptatie** get an outlined badge with a thin line (2 px).
3. Open your n8n site and click the extension icon. The side panel only works on tabs whose address (origin) exactly matches an instance you added. When you add an instance, the extension checks through the n8n API that it really is n8n and that the key works.
   - On every other tab, the icon is **greyed out** and clicking it does nothing.
   - **No instances yet?** Then the icon stays clickable everywhere. Click it on your n8n page: the settings open with that address already filled in, so you only enter the API key. Once the first instance is saved, the icon only works on your instances.
   - To open the settings from anywhere: right-click the icon → **Options**, or use ⚙ in the panel. They also open by themselves on first install.

After a code change, click ↻ on the extension in `chrome://extensions` and reload the n8n tab.

## Settings
The settings page has two tabs. Open it with right-click on the icon → **Options**, or ⚙ in the panel.
- **Instances:** add, edit and delete n8n instances (URL, environment, API key). See Installation.
- **Voorkeuren** (Preferences): apply to all instances and are saved right away.
  - **Taal** (Language): **Automatisch** (Automatic, the default: Dutch when Chrome is set to Dutch, otherwise English), **Nederlands** or **English**. The panel and the settings page switch right away (they reload themselves). Everything follows the language: buttons, dialogs, schedules ("daily at 14:00"), run status, durations, dates and error messages. Names of workflows and modules, and the tips from the feed, stay as they are.
  - **Links openen in** (Open links in): where a workflow or an execution opens when you click it in the panel.
    - **Nieuw venster** (New window, the default): its own Chrome window.
    - **Nieuw tabblad** (New tab): a new tab right next to the current one.
    - **Huidig tabblad** (Current tab): the n8n tab next to the panel goes to that workflow, and the panel follows. Unsaved changes in the editor can be lost; n8n usually asks first.

  Link tooltips in the panel say where a link will open. Go straight to this tab with `options.html#voorkeuren`.

## Icon, name and badge
- **Name:** "things.io Modules". Other things.io extensions also start with "things.io ", so they sit together in the extensions menu.
- **Icon:** the things.io mark (two blue rings joined by a dark L-shaped line) with the letter **M** (Modules) in the free top-right corner. It sits on a white rounded tile, so it stays visible on a dark toolbar.
  - Source files: `extension/brand/icon.svg` (for 32, 48 and 128 px) and `icon-16.svg` (thicker lines, for the toolbar).
  - For a next extension: same tile, same mark, a different letter.
  - The PNGs (`icon-16/32/48/128.png`) are rendered from these SVGs. If you change an SVG, render the PNGs again, for example by opening the SVG in Chrome at the right size or with a tool such as Inkscape.
- **Greyed out:** on tabs that aren't one of your instances, the icon is grey and can't be clicked, so it's clear the extension doesn't work there. The exception is before you've added any instance: then a click opens the setup.
- **Badge:** on an instance's tabs, the icon shows a red number. It counts the workflows (in a module) whose last run failed, and the tooltip says the same.
  - The badge updates when the panel fetches runs (when you open it or click ↻ **Vernieuwen**), not in the background.
  - On tabs that don't belong to an instance, it is cleared.

## Which view, on which page
The panel follows the n8n page that is open in the tab:
- **A workflow is open** (`/workflow/<id>`): the panel shows **Deze workflow** (This workflow), with the executions of that workflow. See below.
- **Every other page** (`/workflows`, `/home/workflows`, `/assistant`, …): the module overview described in the rest of this README.

On a workflow page, two tabs at the top switch between **Deze workflow** and **Alle modules** (All modules). When you move to another page in n8n, the panel switches along without reloading the workflow list. **↻ Vernieuwen** still reloads everything.

## This workflow: executions
- **Header:** the workflow's name, whether it is on (**Aan**) or off (**Uit**), and its module.
- **Executions:** newest first, 20 at a time; **Meer laden** (Load more) fetches the next 20. Each line shows:
  - the status: Geslaagd (succeeded), Mislukt (failed), Draait (running), Wacht (waiting), Geannuleerd (canceled) or Gecrasht (crashed);
  - the execution number; click it to open that execution in n8n (where it opens is a preference, see Settings);
  - how long ago it started, how long it took, how it was started (trigger, webhook, handmatig = manual, subworkflow, …) and the exact start time.
- **Error details** of a failed execution: click **Foutmelding** (Error) under it. The panel then fetches that one execution with its data and shows the error message, the node where it went wrong, the HTTP status (for API errors), the description (often the response of the called service) and, folded away, the stack trace. **Kopieer foutmelding** (Copy error) puts it all on the clipboard. The data is only fetched when you open the section, once per execution, and only the error is kept. Request details (`context`) are never shown, because they can contain credentials.
- **Chart by hour:** at the top, bars per hour of the day show when the loaded executions started, like the day agenda; failed ones are red at the top of a bar. Click a bar to see only that hour (**Alle uren tonen** shows all again). It covers what is loaded, so **Meer laden** adds to it.
- **Summary and filter:** a line counts the loaded executions per status and says when the last failure was. The buttons **Alle**, **Mislukt**, **Geslaagd** (and **Bezig**, in progress, when there are any) filter the loaded list.
- **A new workflow** (`/workflow/new`) has no executions yet; the panel says to save it first.
- **A workflow that isn't in the list** (for example archived, or one the key has no access to) still shows its executions, with its id as the name.
- The executions come from `GET /executions`, without execution data. Open an execution in n8n to see its details.

## The module overview
Each module gets a card labeled **MODULE**. The card shows:
- the module's name;
- how many of its workflows are active;
- a switch;
- the list of workflows.

Workflows without a module are on the card **Zonder module** (No module). Cards sit side by side when the panel is wide enough (at least 340 px per card).

For each workflow:
- **Name:** click it to open the workflow in n8n: in a new window by default (see Settings).
- **Switch:** on or off.
- **Handmatig** (Manual) instead of a switch: the workflow only has a manual trigger. n8n can't publish (activate) such a workflow, because nothing would start it, so there is nothing to switch. It doesn't count towards the module's "x/y active", isn't part of switching a module on, and a rollback skips it with a note. A module with only such workflows has no switch at all and shows "alleen handmatig" (manual only).
- **Triggers:** schedule (with a readable interval), webhook (method and path), manual, subworkflow, form, chat, error handling and app triggers. When the workflow is off, the line is grey.
- **Copy webhook URL:** each webhook has a small copy icon.
  - Click copies the production URL (`<instance>/webhook/<path>`); Shift+click copies the test URL (`/webhook-test/...`). The icon briefly turns into a check mark.
  - If the path contains a route parameter (`users/:id`), the panel puts the node's `webhookId` in front of it, as n8n does.
  - If the path contains an expression, the icon is disabled.
  - Note: the panel builds the URL from the instance address. If n8n has a different `WEBHOOK_URL` configured, check the copied URL.
- **Last run:** succeeded, failed (with "x of the last 5"), running now, or never run. Failed runs give the module header a red badge "N mislukt" (N failed).
- **nodig / gebruikt door** (needs / used by): dependencies, derived from Execute Workflow nodes.

## Day agenda
Above the cards is a collapsible section **Dagplanning** (day agenda). It lists every workflow with a schedule trigger (Schedule Trigger or the old Cron node), ordered by hour like a calendar.
- **Pick a day:** buttons Ma–Zo (Mon–Sun) for the current week, today by default. Weekly, monthly and "every n days" schedules only appear on the days they really run.
- **Hour strip:** 24 bars with the number of workflows per hour. Click a bar to scroll to that hour.
  - Orange: in that hour, 2 or more enabled workflows run at exactly the same time.
  - Yellow: the same, but only with disabled workflows.
- **Simultaneous runs:** workflows at the same time (e.g. 14:00) share a highlighted block with "N tegelijk" (N at once), plus "· M aan" (M on) if some of them are off. The header shows how many times of day have 2 or more enabled workflows.
- **Elk uur** (Every hour): a workflow that runs every hour (or every n hours) is in the "Elk uur" group. It also appears at a fixed time when it happens to coincide with it, marked "elk uur".
- **Doorlopend** (Continuous): workflows that run every few minutes or seconds have their own group. They don't run on fixed clock times, because n8n counts from the moment they were activated.
- **Niet te plaatsen** (Can't be placed): a schedule that can't be read, for example an expression.
- **Alleen actief** (Active only): hides disabled workflows. Off by default; disabled workflows are grey and marked "uit" (off).
- **Alleen vaste tijden** (Fixed times only): shows only workflows that run at a fixed clock time, e.g. daily at 14:00, Monday 09:30, or cron `0 9,17 * * *`. Hourly, every-few-minutes and unreadable schedules are left out, and an hourly workflow no longer counts towards "N tegelijk".
- Each line shows the workflow (click to open it in n8n), its module and, where useful, a note on the schedule.
- The panel remembers per instance whether the section is open, **Alleen actief** and **Alleen vaste tijden**.
- **How times are worked out:** n8n converts a Schedule Trigger to cron internally (hours: `m */n * * *`, days: `m h */n * *`, and so on), so the run times are fixed. The panel can't read a cron expression with names (JAN, MON) or with 6 fields.

## Switching on and off
- **One workflow:** the switch first asks for confirmation with the plan (and any warnings). A snapshot is optional.
- **Sub-workflows switch on along:** n8n won't publish a workflow that calls an unpublished sub-workflow. So switching a workflow (or a module) on also switches on the sub-workflows it calls that are off, first, with a note in the plan. A sub-workflow with only a manual trigger can't be published; the plan warns about it.
- **A module:**
  - **Off:** every workflow that is on is switched off, callers first. The panel remembers which ones.
  - **On:** only the remembered workflows are switched back on, subworkflows first. Workflows that were already off stay off.
  - The module shows as on as long as at least one of its workflows is running.
  - For a module, you must download a snapshot before you can confirm.
  - Without a remembered list (e.g. everything was already off), switching on tells you there is nothing to restore; switch workflows on yourself.
- A manual switch on a workflow takes priority: the module then forgets what it remembered about that workflow.
- **Snapshot:** a JSON file (`n8n-snapshot-<time>.json`) with the instance address, the time, and the id, name and on/off state of the affected workflows. It contains no nodes, settings, credentials or key, so it is not a backup of your workflows (use n8n's own export or workflow history for that).
- **Rollback** (button in the top bar) puts workflows back in the on/off state of a snapshot:
  - You pick the file; the panel shows a plan with only the workflows whose state differs now, and does nothing until you confirm.
  - Order: switching off first (callers before subworkflows), then switching on (subworkflows before callers).
  - It only switches workflows on and off. It never creates, deletes or changes a workflow: deleted workflows are skipped, new ones are left alone, and edited ones keep their current content.
  - Workflows with only a manual trigger are skipped with a note.
  - A snapshot taken on another instance (or without an instance address) is refused, because a copied instance can have the same workflow ids.
- On an error, execution stops at the first failed step. Earlier steps have been carried out.
- After execution, the panel reloads the open n8n tabs of the changed workflows and the workflow list, so you see the new state right away. You can switch this off in the confirmation dialog. Note: reloading loses unsaved changes in an open editor.

## Deleting a workflow
- The bin icon at the end of a workflow row deletes that workflow from n8n.
- n8n's API deletes **at once and for good**: there is no archive step like in the n8n editor, and Rollback or a snapshot can't bring it back. The confirmation says so.
- It also warns when the workflow is on (its triggers stop) or is called by other workflows (they will fail at that step).
- **Download a copy first (JSON)** saves the workflow as n8n returned it, so you can import it again in n8n.
- **Delete permanently** only works after you type the workflow's exact name, on every instance.

## Managing modules
- **+ Module:** creates an empty module (the tag `mod:<name>` in n8n). A name that already exists is refused.
- **Drag:** drag a workflow by its handle (⠿) to another module card, then confirm. Drag it to **Zonder module** to unlink it. The workflow moves, so it ends up in one module. Its other tags stay.
- **Subworkflows move along.** When you move a workflow to a module, the panel finds all subworkflows it calls (directly or indirectly) and lists them in the confirmation with a checkbox.
  - A subworkflow's current module tag is replaced with the target module's tag; its other tags stay.
  - A subworkflow that other workflows outside the move also call is unchecked, with a warning saying who else uses it.
  - Subworkflows that are already only in the target module are skipped.
  - This also applies to the dropdown. If the workflow has no subworkflows, the dropdown still links it right away.
- **"+ Module…" dropdown:** on workflows without a module, picking a module links it right away without a dialog, unless subworkflows could move along (see above).
- **Delete an empty module:** the red **Verwijder** (Delete) button removes the tag in n8n. Only possible when the module is empty.
- **Order:** drag a module card by its handle, or use the arrow keys on the handle. Not possible while searching.
- **Collapse and expand:** the arrow next to **MODULE**, or **Alles inklappen / uitklappen** (Collapse / Expand all). While searching, everything is expanded.

## Tips footer
At the bottom of the panel is a dark footer with rotating tips from `https://things.io/rss.xml`: title, category and a short description.
- The tip changes every 12 seconds. It pauses while the mouse is over the footer or the focus is in it. Use ‹ and › to browse yourself.
- Clicking the title opens the article on `things.io` in a new tab.
- If the feed can't be fetched (offline), the panel uses the last saved tips, or otherwise a short fixed line with a link to things.io.
- **Hide it:** the **▾ Verberg** (Hide) button in the top-right of the footer collapses it to a thin bar with **▴ Toon tips** (Show tips). The panel remembers this only for the current browser session (`chrome.storage.session`). After reloading the extension or restarting Chrome, the footer is shown again.
- The feed is fetched at most every 12 hours and cached (the 40 newest articles, in `chrome.storage.local` under `tipsCache`).
- Fetching it is a plain `GET` of the feed: nothing about you or your n8n instance is sent to things.io.
- That's why the manifest asks for access to `https://things.io/*` up front. The feed sends no CORS header, so without that permission Chrome blocks the request. You see this request when you load the extension.
- Feed text is shown as plain text only (HTML is stripped), and links are only accepted if they are `https://things.io/…`.
- Forks can change the feed, or switch the footer off, in `extension/brand/brand.js` (see CONTRIBUTING.md).

## Search and refresh
- Search looks in names, tags and nodes: node name, type and settings such as URLs or code. It never searches credentials or pinned data.
- Several words work as "and". Matches in nodes are listed under the workflow.
- **↻ Vernieuwen** (Refresh) fetches everything from n8n again. The panel doesn't refresh by itself.

## Dependencies
These are derived from Execute Workflow nodes (`workflowId` as text or as a resource locator). The panel does not see:
- disabled nodes;
- sources other than "database";
- expressions (`={{ ... }}`);
- targets outside the fetched list (e.g. archived workflows);
- other links, such as calling a webhook with an HTTP Request node.

A cycle (A calls B calls A) gives a warning.

## Security
- **Storage:** the API key is in `chrome.storage.local`. Only this extension can read it; websites and other extensions can't. It is stored unencrypted in your Chrome profile on disk. There are no content scripts: nothing from the extension runs inside the n8n page.
- **Key not shown again:** when you click **Wijzig** (Edit) on the settings page, the key field stays empty. Leave it empty to keep the current key, or enter a new one.
- **https only:** an instance must use `https://`, so the key never travels over the network unencrypted. `http://` is allowed for localhost only. The panel also refuses an http instance that was saved earlier.
- **Production:** for an instance with environment Productie, **Bevestigen** (Confirm) only works after you type a word in the confirmation dialog. For a module, type the module name. For one workflow or a rollback, type `productie`.
- **No external requests** except to your own n8n instance and the things.io feed. The Inter font is bundled (`assets/fonts`, SIL Open Font License, see `OFL.txt`).
- **Recommended in n8n:**
  - Create a separate key per person and per instance, with an expiry date.
  - Preferably use a separate n8n user for the key. That way, n8n's publish history shows what was done through the extension.
  - If your n8n version supports scopes, give the key only what it needs: read workflows, activate and deactivate them, manage tags, and read executions.

## What is stored (in this browser only)
`chrome.storage.local`:
- `instances`: name, URL, environment and API key per instance.
- `moduleMemory`: per instance and module, which workflows the module switched off.
- `moduleUi`: per instance, the order of the module cards, which cards are collapsed, and the day agenda settings.
- `tipsCache`: the last tips fetched from the feed.
- `settings`: the preferences from the settings page (where links open).

This isn't shared between computers and isn't stored in n8n. One preference is in the panel's `localStorage`: whether to reload the n8n tabs after execution.

## API calls used
- `GET /workflows`
- `POST /workflows/{id}/activate` and `/deactivate`
- `DELETE /workflows/{id}`: deletes permanently, only after the confirmation with the typed name
- `GET /executions?workflowId=…&limit=5` (last run in the overview) and `GET /executions?workflowId=…&limit=20&cursor=…` (the executions of the open workflow)
- `GET /executions/{id}?includeData=true`: only when you open the error of one failed execution
- `GET /tags`, `POST /tags`, `DELETE /tags/{id}`
- `PUT /workflows/{id}/tags`. This replaces the whole tag list, so the panel always sends the existing tags along.

Only the official public API is used, never the internal `/rest` endpoints. See `docs/findings.md` for what was tested for each call.

## Structure
```
extension/
  manifest.json
  brand/                   brand: brand.js (name, tips feed), brand.css (colors), logo and icons
  assets/fonts/            bundled font (Inter)
  src/background.js        enables the side panel per tab, handles the icon click
  src/storage.js           chrome.storage.local (instances)
  src/i18n-dom.js          sets the language on a page and translates its static HTML (data-i18n)
  src/options/             settings: URL and key
  src/panel/               the panel (UI): panel.js, workflowView.js (this workflow), agenda.js, tips.js
  src/lib/                 pure logic, no chrome.*
    n8n.js                 API client (pagination, backoff on 429, error messages)
    modules.js             grouping, order, tags and moving
    deps.js                dependency graph, order, plans
    triggers.js schedule.js  readable triggers
    agenda.js              day agenda
    executions.js          last run, execution status, duration and links
    route.js               which view fits the page in the tab
    i18n.js messages.js    interface language: t(key) and all texts as Dutch/English pairs
    settings.js            preferences (language, where links open)
    search.js tabs.js snapshot.js env.js rss.js
spike/spike.mjs            Phase 0: checks against an instance (uses .env)
scripts/pack.mjs           npm run pack: dist/n8n-module-manager-<version>.zip
tests/lib.test.js          unit tests
docs/                      findings.md, test-checklist.md
```

## Tests
`npm test` runs the unit tests for the logic in `src/lib/` (Node, no dependencies). The UI and the real n8n calls are not tested automatically. For those, go through `docs/test-checklist.md`, starting with a module of harmless workflows.

## Demo video
`npm run demo` records a video of the panel to `demo/out/demo.mp4` (about 90 seconds). It clicks through the main features with a visible pointer and captions: the overview, the day agenda, a module card, the confirmation for switching a module off on Productie (cancelled, nothing is executed), search, the tips footer, and the executions of a workflow.

- It uses made-up data (`demo/seed.js`) and a fake `chrome.*` (`demo/stub.js`). No real n8n instance is contacted.
- It needs Google Chrome and ffmpeg (in `PATH`), and runs `npm install` once for the `playwright-core` dev dependency.
- The steps are in `demo/record.mjs`; add a step there when you add a feature.

## Spike
`npm run spike` runs `node --env-file=.env spike/spike.mjs`. Copy `.env.example` to `.env` first, and never use a production instance.

Optionally, set `SPIKE_WORKFLOW_ID` to test activate/deactivate. This briefly switches that workflow off and back on.

## Known limitations
- No build step: plain JS (ES modules) instead of the TypeScript/Vite/Preact proposed in PLAN.md.
- Dragging puts a workflow in one module. To have it in two modules at once, set the tags in n8n yourself.
- A module exists as soon as the tag `mod:<name>` exists. An empty module stays visible until you delete it.
- n8n may limit the length of tag names. The panel doesn't check this beforehand; n8n reports the error itself.
- The API key is stored unencrypted in `chrome.storage.local` (see Security).
