# UI Overhaul — rounds plan from Jameson's 2026-07-06 feedback batch

**Source:** `docs/APP FEEDBACK 07-06-2026 503 PM MST.md` (~30 items). **Planner:** coordinator-10 (Fable). **Builders:** Codex for all rounds (Jameson's directive), through the UI Iteration System gates (classifier → handle/token guards → scoped tests → robot rehearsal), one round per branch, gallery to Jameson after each visual round.
**Sequencing:** ALL rounds start AFTER the keepance→lantern rename lands (FOLDER-CLEANUP-RENAME-PLAN.md) — the rename touches every file; doing UI first would make it collide with everything.

## Coordinator's calls on the two ask-me items (Jameson: veto anytime)
- **Map icon vs lock icon (both open privacy info):** KEEP the lock (the full Privacy Center screen), REMOVE the map icon from the top bar, and put the Data Map inside the Privacy Center as its own section. One entrance, one mental model: eye = "what's leaving right now", lock = "everything about privacy". A modal duplicating a screen is the confusing part.
- **Files-Only toggle + file-access container on Ask:** fold BOTH into a compact "answer scope" popover chip sitting in the same row as the client filter (a small filter icon + current state, e.g. "Files only" / "Files + general"). One click opens a popover with the toggle and the file-access consent controls. The main window loses the whole block; power users keep one-click access; the chip always SHOWS the active mode so nothing is hidden-but-active.

## Bug notes for builders
- **B1 (map source click, item 7 / Ask source click, item ~191):** both must route to the CLIENT's Documents tab with the file open under the tab's toolbar — never the orphan global documents screen. Same root fix, one navigation helper.
- **B2 (Save to Document does nothing):** reproduce first; suspect the unified send path's artifact creation.
- **B3 (rail click → Client Map goes to list):** navigation model round fixes this by design (see R3).
- **B4 (meeting notice `join-timeout` ×2 → `terminal: internal`):** Jameson's console paste IS our new telemetry working. Two clean join-timeouts on the LEGION (not a bench artifact!) then a terminal 'internal'. Investigate the 'internal' terminal reason (why did retry #2's failure classify as internal?) + pursue the join path itself. Meetings round (R7).
- **"Active Matter" visible on the Activity tab:** user-facing facade leak — the WORD matter must never face users (engine name stays). Sweep ALL user-facing strings for matter/Matter while there.

## Rounds (each = one branch, one Codex build, one combined re-review, gallery when visual)

### R1 — copy trims + tiny fixes (Tier P/S, fast, high certainty)
Remove: "Click a row to focus AI…" · "View" label by the Clients/Whole-Book toggle · Documents column · ALL header subtexts on every tab (match Workflows' clean header) · Ask's "Your Private Practice Assistant…" line. Change: clients icon suitcase→PEOPLE icon in brand red · whole-book progress bars red→GREEN (semantic, not brand) · "Using cloud AI" indicator becomes clickable → opens the AI options · "Active Matter"→client-language sweep. Bug: B2 (Save to Document).

### R2 — Clients list restructure (Tier S/B)
One-line rows: Ask/Documents/Email/Meetings/Activity buttons right of the name; Archive leaves the row → a 3-dot menu at row end (right of Created) with Archive + other sensible shortcuts; comfortable vertical whitespace. New Client button + Clients/Whole-Book toggle same height, adjacent, in the tab-style header row; the list adopts the individual-client view's light lines + tab styling (visual kinship with Ask/Workflows).

### R3 — navigation model (Tier B, the deepest thinking round)
Left-rail client search bar (top of the expandable list — advisors have 100+ clients). Client Map tab semantics: no selection → blank canvas + "Click a client on the left"; with selection → straight to THAT client's map (no intermediate list screen; the Clients LIST tab remains the list home). Fix B3. Remove the "only" scope badge from map top-right (the rail selection replaces its job). **App-wide Back button** (history stack for cross-surface jumps: Ask→source→Documents→back to the same Ask conversation).

### R4 — Client Map depth (Tier B)
Source-click routes per B1. Edit history: every bullet edit recorded (who/what/when) and reflected against its source — advisors need an audit trail. Confirmation modals: remove-section AND remove-bullet. Add-bullet on every section (pre-made + custom). Sync: circle-arrows icon next to the client name that re-scans documents and refreshes the map + "last updated" evidence beside it. Export/Share: branded (Advisor Prep Hero) PDF/Word of the map.

### R5 — Ask layout (Tier S/B)
Sources pane: auto-collapsed by default, expandable from a slim state; previews trimmed to a few lines, expandable, click-through opens the document (via B1 routing). Scope popover per the coordinator call above. Conversation search bar under "New question". Filter cleanup — RESOLVED (coordination/reports/ask-scope-semantics.md): the two are GENUINELY DIFFERENT. All Clients = real document search across every client (cited answers from files). Whole Practice = answers built ONLY from the Client Map summaries (never touches documents, by design — a fast book-level digest). So: do NOT remove — RENAME for clarity. Coordinator suggestion (Jameson names the final label): keep 'All Clients' as-is; rename 'Whole Practice' to something that says digest-not-search, e.g. 'Book Overview' with helper text 'from your Client Maps'. Jameson picks the final wording in the R5 gallery review.

### R6 — Workflows flow (Tier B)
Kill the run-for-current-client confirmation (straight to questions), autofill the client name. "Continue"→"Run". Unfilled section → auto-scroll to it with a visible highlight. While running: the status pill is NOT clickable and has an animated icon. Results: Recent Runs entry is clickable → opens the produced document; title includes client name + doc type; document auto-saves under the client's Documents in a "Workflows" folder; the whole trail obvious.

### R7 — Meetings (Tier B + investigation; the only round that may need the Legion)
Sub-tabs: Recording (audio player + notes like "no one spoke" + download) · Transcript (view/copy/export) · Summary (review/copy/export to Word/PDF). No live-docx pane — export creates the docx in Documents. Meetings renameable. **Notice card reliability (B4):** diagnose the join-timeout on real hardware with the new telemetry; then the two-way voice: card announces "This meeting is being recorded" on entry and "Recording stopped" when recording stops in-app — this feedback loop is crucial to Jameson.

### R8 — demo data (small, anytime after rename)
Seed demo emails referencing the three practice families so Outlook-connected demos show matching per-client emails (44 real imported, none match the families today).

## Execution notes
- Every round: fresh branch off the then-current tip, Codex builds with TDD, ONE combined delta re-review after the batch (batching doctrine), coordinator verifies + gates + merges, robot gallery to Jameson for visual rounds (R1-R5 especially).
- R1 first (fast win, high certainty), then R2→R3 (R3 builds on R2's header), R4/R5/R6 parallelizable AFTER R3's navigation lands (back-button touches all), R7 anytime (different neighborhood), R8 anytime.
