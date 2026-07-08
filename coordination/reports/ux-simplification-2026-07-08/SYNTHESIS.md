# UX Simplification Synthesis

## The big picture

The app has a strong trust story, but it says the same trust story too many times. Most screens are not noisy because they have too many features; they are noisy because backup tools, warnings, explanations, and status labels are visible before the user needs them. The same pattern shows up everywhere: a user tries to read, ask, review, or send, but the page also shows setup, history, export, delete, filters, and help text at the same time. Many areas also use boxes inside boxes, which makes simple things feel heavier than they are. The best direction is not to strip out trust, privacy, citations, consent, or review gates. It is to make those signals smaller, clearer, and closer to the moment when they matter. The product should feel like one calm working surface with one obvious next action, plus details that open only when the user asks for them.

## Cross-screen themes

### 1. Too many actions are visible at once

This appears on Ask, Client Map, Documents, Email, Meetings, Workflows, and Settings. Secondary actions like rename, copy, export, delete, save, duplicate, history, and settings often sit beside the main task.

**Systemic fix:** Use one visible primary action per area. Put secondary, rare, and destructive actions in a standard `...` menu, or reveal them only on hover, focus, selection, or after the user opens a flow.

**Audit correction:** Some audits pushed icon-only buttons too far. Keep text on primary or risky actions like `Send`, `Run`, `Stop`, `Mark reviewed`, and destructive confirmations. Use icon-only buttons only for familiar utility actions, with tooltips.

### 2. Boxes inside boxes make the app feel busier than it is

This appears in source panels, settings rows, document grids, trash, email metadata, meeting send panels, workflow questions, and guided interview cards.

**Systemic fix:** Use flat rows, light dividers, and whitespace inside rails and side panels. Save raised cards for repeated items, modals, and true framed tools. Do not put a card inside another card unless it is doing real work.

### 3. The same meaning is repeated in multiple places

This appears on Ask scope, Sources, Client Map history, Documents Files/Trash navigation, Email empty states, Privacy/Data Map entry points, Workflow descriptions, and meeting notice status.

**Systemic fix:** Pick one home for each idea. If the rail says where the user is, the toolbar should not repeat it. If a citation chip proves a claim, do not also show a large reassurance box. If Privacy Center owns Data Map, remove extra Data Map doors elsewhere.

### 4. Trust copy is right, but too loud

This appears across Ask, Settings, Client Map, Documents, Email, Meetings, and Workflows. The app often explains privacy in full paragraphs when a short status would do.

**Systemic fix:** Use a trust ladder:

- Always visible: a tiny status, like where AI sends data.
- At action time: one short warning, like "Review first. Sends by your email."
- On demand: full details in a tooltip, disclosure, Privacy Center, or dialog.

Never remove the load-bearing trust signal; shrink the repeated explanation.

### 5. Modes, filters, and scope controls are overexposed

This appears on Ask, Documents, Email, Workflows, Settings, and Meetings. Rows of chips and tabs show decisions before the user has enough context.

**Systemic fix:** Use one compact control for mode or scope. Show active filters as small chips only when they are active. Do not show a full filter form, tab row, or chip wall by default.

**Audit correction:** Plus buttons do not need one universal home. The rule should be: rails navigate, toolbars create things in the current view, and app-wide compose actions can stay in a rail header when that is the clearest place.

### 6. Empty, normal, and success states take too much space

This appears on Ask Sources, Client Map history, Settings memory tables, Documents counts, Email empty panes, Meetings reviewed badges, Local AI ready cards, and Workflow no-results states.

**Systemic fix:** Keep failures, blockers, and risk states visible. Make normal-good states quiet. Hide empty panels and empty tables until there is data, and show counts only when they help search, selection, or risk.

### 7. Helper copy is often longer than the decision

This appears on all seven audits. Long labels, ellipses, old product names, technical words, score numbers, raw IDs, and repeated explanations make screens feel less designed.

**Systemic fix:** Run one copy pass across the app: sentence case, short labels, no ellipses in placeholders, no raw machine details in normal UI, and use `Lantern` or `this app` consistently.

### 8. Similar tasks use different patterns

This appears in email filing, meeting recipients, file row actions, source rows, history, and picker flows.

**Systemic fix:** Standardize a small set of patterns: searchable dropdowns for picking clients or people, flat source rows for citations, `...` menus for row utilities, slim selected-state bars, and drawers or dialogs for review-before-send.

## Top 20 recommendations

| # | Screen | What changes | Impact | Effort |
|---:|---|---|---|---|
| 1 | All screens | Make one action clearly primary, then move secondary, rare, and destructive actions into `...` menus or reveal them only when needed. | HIGH | M |
| 2 | All screens | Replace nested cards with flat rows, dividers, and whitespace inside rails, side panels, and settings areas. | HIGH | M |
| 3 | All screens | Use the trust ladder: tiny always-visible status, one-line warning at action time, full explanation only on demand. | HIGH | M |
| 4 | Settings + onboarding | Merge duplicate privacy/Data Map entry points, flatten Settings navigation, and make onboarding start with a real setup choice. | HIGH | L |
| 5 | Ask + Client Map | Collapse Sources by default, expand it from citation clicks, and make source cards into quiet source rows. | HIGH | M |
| 6 | Ask | Replace multiple scope/status pills with one scope menu, and make answer settings quiet unless the user changes them. | HIGH | M |
| 7 | Meetings | Move Send out of the tab row, merge recipient planning with send review, and use one person-first recipient picker. | HIGH | L |
| 8 | Documents | Move Trash into the left rail, move the `+` action into the file toolbar, and remove the duplicate Files/Trash switch. | HIGH | M |
| 9 | Email | Collapse the always-open reply composer, make the message header plain, and move export/save actions into the reader menu. | HIGH | M |
| 10 | Workflows | Make Run the only strong action, shorten template descriptions, and show only the current step during a run. | HIGH | M |
| 11 | Client Map | Hide row Edit/Remove/Add/History controls until hover, menu, disclosure, or a focused editing state. | HIGH | M |
| 12 | Meetings | Keep notice and consent visible, but shrink verified notice states, the consent dialog, and the floating recording pill. | HIGH | M |
| 13 | All screens | Hide empty panels, empty tables, duplicate empty states, and normal-good status cards until they have something useful to say. | HIGH | S |
| 14 | All screens | Do one plain-language copy pass: shorter labels, sentence case, no ellipses, no old product name, no raw scores or IDs. | HIGH | M |
| 15 | Documents | Unbox the file grid and Trash view so browsing files feels like browsing files, not sorting cards. | HIGH | M |
| 16 | Email + Meetings + Client Map | Standardize client, person, filing, and recipient pickers into searchable dropdown rows instead of chip walls or repeated sections. | MED | M |
| 17 | Workflows + Meetings + Email | Show send/export/review details in one place, not both the panel and the confirmation dialog. | MED | M |
| 18 | Rails | Make small rails easier to scan by reducing always-open search, row badges, row icons, snippets, dates, and category lines. | MED | M |
| 19 | Documents + Meetings + Settings | Make normal saved, reviewed, installed, ready, and non-urgent billing states quiet; keep failures and blockers loud. | MED | S |
| 20 | All screens | Write a "do not trim" rule into the design pass so citations, consent, privacy, review, recoverability, and isolation signals stay protected. | HIGH | S |

## Per-screen quick wins

### Ask

- Shorten stale plan export warnings to one scannable sentence.
- Make Book Overview results read like a compact answer, not a mini dashboard.
- Shorten the whole-practice confirmation without weakening consent.
- Make the sample-data bridge a one-line nudge after the first sample answer.
- Remove the decorative quote treatment from user questions.

### Chrome + Settings

- Remove the decorative onboarding background and keep setup on a plain light surface.
- Turn AI setup from two large sales cards into one path with a Cloud AI / Local AI choice.
- Move rare Settings footer actions like import, export, and reset into a More menu.
- Fold advanced recording notice options behind an Advanced section.
- Hide ready-state cards for Local AI and Voice unless something needs attention.

### Client Map

- Collapse "Before you meet" into one row until opened.
- Make "What I'm missing" the one home for gap questions and guided answers.
- Shorten normal status near the client name; show only failure or updating states in the header.
- Make voice profiles a compact privacy row.
- Remove duplicate Wealthbox approval reassurance; keep the approval message near the send action.

### Documents

- Move Rename into the document actions menu.
- Make the saved state quiet when everything is fine, but keep save failures loud.
- Shorten the Word review toggle to `Review`.
- Start the AI redline composer as a one-line input that expands on focus.
- Move the firm/editorial export details into the export flow, not the default document view.

### Email

- Hide AI search scores and raw mail IDs from normal search results.
- Make filters show as active chips, with the full filter form opened only from Filters.
- Put attachments inline with message metadata unless there is a warning.
- Shorten the connected/no-account empty copy while keeping the local privacy promise.
- Show Gmail and Outlook as friendly provider names.

### Meetings

- Make the meeting header title-first, with date and compact status chips below.
- Turn the recording consent dialog into a short checklist.
- Collapse speaker naming until the user clicks `Name speakers`.
- Remove repeated mic tiles from meeting rail rows.
- Make auto-join a slim expandable strip instead of a floating card.

### Workflows

- Move Recent runs out of the selected-template body, or filter it to that template.
- Move the firm-name field into the export flow.
- Lead completed workflows with `Draft ready` and one Open action.
- Shorten the cost estimate modal to one estimate line plus Details.
- Replace chain suggestion button clusters with one action: `Use output in another workflow`.

## Deliberately kept

- Keep the AI/data destination signal visible. It can be shorter, but it cannot disappear.
- Keep consent and review gates before AI file access, whole-practice sends, email sends, meeting sends, recording, external sharing, and destructive actions.
- Keep citations, source chips, source verification states, stale export warnings, and verified/unverified review counts.
- Keep client isolation, sample status, and client-scoped wording visible where they prevent trust mistakes.
- Keep Privacy Center, Data Map, privacy reports, and local/cloud/assured AI choices, but deduplicate their entry points.
- Keep importing, indexing, provider, Local AI, trial, and blocker states visible when they stop work or explain why an answer may be incomplete.
- Keep recording consent, spoken notice, strict notice quarantine, Notice Card support, local recording status, biometric consent, and voice profile deletion confirmation.
- Keep recoverability: Trash count, restore, permanent delete confirmation, empty-trash confirmation, retention settings, and save-failure escalation.
- Keep Word review, tracked changes, clean-copy export, and hidden-metadata removal.
- Keep created-file links after workflows, because they prove the workflow made a real document.
- Keep Settings search, because it is the escape hatch in the densest part of the app.
- Keep the light theme.

## Suggested build order

### Wave 1: Set the app-wide rules and do the cheap cleanup

This is the best first approval round. Create shared rules for action priority, quiet normal states, `...` menus, flat rows, and the trust ladder. Then do the copy pass: shorter labels, sentence case, remove ellipses, remove old product names, and hide raw scores or IDs. This wave should make the whole app feel calmer without changing much behavior.

### Wave 2: Simplify the main reading surfaces

Apply the rules to Ask, Client Map, Documents, and Email. Collapse Sources until citations matter, flatten source rows, clean up file browsing, collapse the reply composer, and remove duplicate navigation. This is the highest user-visible payoff.

### Wave 3: Simplify the heavier workflows

Tackle Meetings and Workflows after the shared patterns are proven. Meetings needs the send flow merged, notice states compressed, and recording UI calmed down. Workflows needs shorter template detail, one strong Run action, current-step-only running state, and cleaner completion.

### Wave 4: Guardrail pass and polish

Run a final design QA pass focused on the things that must not be trimmed: privacy, consent, citations, review gates, recoverability, isolation, save failures, and recording rules. Check keyboard access, tooltips, and screen-reader labels for every icon-only or menu-hidden action.
