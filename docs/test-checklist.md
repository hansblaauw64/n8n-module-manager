# Manual test checklist

Use a workflow that can safely be switched off. Give it the tag `mod:test` in n8n.

Labels are quoted in Dutch (the default on a Dutch Chrome), with the English label in parentheses.

## Icon and badge
- [ ] The toolbar and `chrome://extensions` show the icon with the things.io mark and the letter M, name "things.io Modules".
- [ ] A workflow in a module whose last run failed: after opening the panel, the icon shows a red number (on n8n tabs only), and the tooltip mentions the count.
- [ ] Go to another site in that tab: the badge disappears.

## Security
- [ ] **Wijzig** (Edit) on an instance: the key field is empty. Saving without a new key works and keeps the old key.
- [ ] A URL with `http://` (not localhost) is refused with a message.
- [ ] Instance set to Productie: switching a module off or on asks you to type the module name. Without it, **Bevestigen** (Confirm) doesn't work.
- [ ] In the panel's DevTools, Network tab: no requests to fonts.googleapis.com or fonts.gstatic.com.

## Phase 1: skeleton
- [ ] `chrome://extensions` → Developer mode → Load unpacked → folder `extension/`: no errors on the card.
- [ ] The settings page opens on first install.
- [ ] Valid URL and key: Chrome asks for host access, then "Opgeslagen" (Saved).
- [ ] Valid URL with a wrong key: message "API-key ongeldig of onvoldoende rechten" (API key invalid or insufficient permissions).
- [ ] Unreachable URL (e.g. `https://nope.invalid`): message "Instance niet bereikbaar" (Instance not reachable).
- [ ] Open the n8n site and click the icon: the side panel opens.
- [ ] Open another site (e.g. google.com): the icon is greyed out, and clicking it does nothing.
- [ ] Switch back to the n8n tab: the icon is active again and opens the panel.
- [ ] On another site, right-click the icon → Options: the settings page opens.
- [ ] Open a new empty tab: the icon is greyed out there too.
- [ ] Delete all instances, open your n8n site and click the icon: the settings open with the n8n address filled in and the cursor in the key field. Enter the key and click **Testen en opslaan** (Test and save): after that, the icon is greyed out on other sites again.
- [ ] With no instances, click the icon on an empty new tab: the settings open with an empty URL field and a short instruction.

## Phase 2: cards
- [ ] The number of workflows in the panel matches n8n (archived ones not counted).
- [ ] The card "test" shows the workflow with the correct active/inactive dot.
- [ ] Workflows without a `mod:` tag are under "Zonder module" (No module).
- [ ] Search filters modules and workflows.

## On and off (test module only)
- [ ] Switch on one workflow: the plan is shown, **Bevestigen** works, and afterwards the workflow is on/off in n8n.
- [ ] Module switch off: only workflows that were on are switched off, and "Bij aanzetten gaan N workflows weer aan" (On switching on, N workflows go back on) appears.
- [ ] Module switch on: only those workflows go back on; a workflow that was off stays off.
- [ ] A snapshot is required for a module (more than one workflow) and optional for one workflow.
- [ ] Rollback with the downloaded snapshot restores the state.
- [ ] Rollback with a snapshot from another instance shows an error and no plan.
- [ ] Open n8n tabs of changed workflows reload (checkbox on) and show the new state.

## Modules and tags (careful: this changes real tags in n8n)
- [ ] **+ Module** creates an empty card, and the tag `mod:<name>` then exists in n8n. A duplicate name is refused.
- [ ] Drag a workflow to the empty card: after confirmation the tag is on it, and other tags remain.
- [ ] The "+ Module…" dropdown on a workflow without a module links it right away (if it doesn't call subworkflows).
- [ ] Move a workflow that calls a subworkflow: the confirmation shows the subworkflow with a checkbox. After confirming, both have the new module tag and their other tags are kept. A shared subworkflow is unchecked and shows the warning.
- [ ] Dragging to "Zonder module" removes the module tag.
- [ ] Delete an empty module: the tag is gone in n8n.
- [ ] Drag module cards, and move them with the arrow keys. The order is kept after ↻ and after closing the panel.
- [ ] Collapse and expand, also **Alles inklappen** (Collapse all); this is remembered.

## This workflow (executions)
- [ ] Open a workflow in n8n: the panel shows **Deze workflow** with the right name, Aan/Uit and module, and the executions match the list in n8n (Executions tab of the workflow).
- [ ] A failed execution is red; **Mislukt** shows only the failed ones; **Alle** shows everything again.
- [ ] **Meer laden** loads older executions (on a workflow with more than 20), then disappears when there are no more.
- [ ] Click an execution number: a new window opens on that execution in n8n. *(Check this on your n8n version: the link is `/workflow/<id>/executions/<executionId>`.)*
- [ ] Go to the workflow list in n8n (`/home/workflows`): the panel switches to the module overview by itself, without the tabs.
- [ ] Open another workflow from n8n: the panel switches to that workflow's executions.
- [ ] Under a failed execution, **Foutmelding** opens the error: message, node, HTTP status (API errors), description and a folded stack trace. It matches the error in n8n's execution view. **Kopieer foutmelding** copies it.
- [ ] Open the error of an execution whose data n8n has already pruned: a message says no error was saved.
- [ ] **Alle modules** on a workflow page shows the overview; **Deze workflow** goes back.
- [ ] `/workflow/new`: the panel says to save the workflow first.
- [ ] `/assistant`: the module overview.

## Overview
- [ ] The trigger line is correct (schedule interval, webhook path).
- [ ] Copy icon on a webhook: the pasted production URL is reachable (workflow on) and matches the URL in the webhook node in n8n. Shift+click gives the test URL.
- [ ] The last run matches the executions in n8n; red badge on a failed run.
- [ ] Search finds words in nodes (e.g. a URL) and shows the node under the workflow.
- [ ] Clicking a workflow name opens a new window on the right workflow.

## Language
- [ ] Settings → **Voorkeuren** → **English**: the settings page reloads in English, and the open panel switches to English by itself.
- [ ] In English: a schedule reads "daily at 14:00", a run "last run succeeded · 5 min ago", durations "3.1 s"; the confirmation on Production asks to type `production` for a single workflow.
- [ ] **Automatisch**: Dutch on a Dutch Chrome, English otherwise (`chrome://settings/languages`).
- [ ] Back to **Nederlands**: everything is Dutch again.

## Manual-only workflows
- [ ] A workflow whose only trigger is a manual one shows **Handmatig** instead of a switch, both in a module and on its workflow page.
- [ ] Its module's "x/y actief" doesn't count it; a module with only such workflows has no switch and says "alleen handmatig".
- [ ] A workflow with a manual trigger AND a schedule still has a normal switch.

## Settings
- [ ] The settings page has two tabs, **Instances** and **Voorkeuren**; the arrow keys move between them.
- [ ] **Voorkeuren** → **Nieuw tabblad**: "Opgeslagen" appears. In the panel, a workflow name opens in a new tab right next to the current one (no reload of the panel needed).
- [ ] **Huidig tabblad**: the n8n tab goes to the workflow, and the panel switches to its executions.
- [ ] **Nieuw venster**: back to a new window. Executions and the day agenda follow the same setting.
- [ ] The footer shows a tip from things.io, changes after about 12 s and pauses while the mouse is over it. ‹ and › work, and clicking the title opens the article.
- [ ] Hide the footer (▾ **Verberg**) and show it again. After ↻ on the extension in `chrome://extensions`, the footer is shown again.
- [ ] **Dagplanning** (day agenda):
  - [ ] Today is open.
  - [ ] A workflow with `{triggerAtHour:14}` is at 14:00.
  - [ ] Several workflows at the same time share one block with "N tegelijk" (N at once).
  - [ ] "Alleen actief" (Active only) filters.
  - [ ] "Alleen vaste tijden" (Fixed times only) shows only schedules with a fixed clock time (no hourly, minutes or seconds).
  - [ ] The day buttons work.
  - [ ] Clicking a name opens the workflow.
- [ ] Footer without internet (airplane mode): the last tips from the cache, or the fixed line with a link.
- [ ] After reloading the extension, Chrome asks (once) for access to things.io.
