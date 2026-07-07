# Master Plan — UI Feedback batch of 2026-07-07 4:28 PM

**Source:** `docs/Lantern UI Feedback july 7 2026 428 pm.md` (Jameson, verbatim).
**Author:** Fable 5 coordinator-11, per the instructions embedded in the feedback file
(Fable ingests → interviews Jameson → crafts this plan → coordinates Sonnet/Opus workers).
**Interview outcome (1 question asked):** the global Back button is **REMOVED ENTIRELY**
(Jameson chose this over relocating it). Keep `appNavigationStore` machinery; only the UI goes.

## The product direction in one line
Every tab becomes the same shape — **a vertical list on the left, content on the right** —
with a single taller top bar (logo top-left), and stray buttons consolidated into `+` and `⋯` menus.

## Standing constraints (bind every worker)
- Light theme only. Never rename `matter`/`Matter`/`matter_id`. i18n via `t()`; kebab-case keys; no em dashes in strings.
- TDD: failing test first, then implement. Never weaken an existing assertion.
- All docx tab/close paths stay routed through `closeDocxTabSafely`/`flushDirtyTabs` (QA-34/43/81 history).
- ui-system handle/token guards must pass; baseline updates only for sanctioned removals, logged in the handoff.
- Worker gate before handoff: `npx tsc --noEmit` + `npx tsc -p tsconfig.test.json --noEmit` + touched vitest suites + `node scripts/eslint-gate.mjs` + handle/token guards.
- Self-converge: run `codex-review` on your own diff and fix to a clean round BEFORE handoff.
- Print `WORKER-DONE: <branch>` **last**, after the evidence block. Never self-merge, never push.
- Each worker in its own worktree/branch; touch ONLY the files in your lane; ping the coordinator first if you must touch a shared file.

## Work packages

### WP0 — Shared master-detail rail primitive *(foundation; blocks WP4/5/6)*
Branch `lp/mp-railshell`, worktree `~/lp-mp-railshell`. **Sonnet.**
- Extract a reusable left-rail layout from the Documents vertical rail work (see `src/features/documents/DocumentsHome.tsx` + `src/features/documents/editor/TabBar.tsx` for the approved look): a `RailShell` (working name) in `src/ui/kp/` with: left pane (fixed ~240px, light bg, tokens) containing a **header slot** (title + small icon actions: `+` menu, `⋯` menu, or custom buttons) and a **scrollable vertical list slot** (selection model, active highlight, scroll-into-view); right content pane fills the rest.
- This is LAYOUT + selection only — no drag/group logic (Documents keeps its specialized TabBar).
- Include a small `+`-menu and `⋯`-menu composition pattern (reuse existing DropdownMenu/IconButton kp primitives).
- Unit tests for selection/active-state/scroll-into-view; a usage story in the component header comment.
- Lane: `src/ui/kp/` new files + tests only. Do NOT convert any surface yourself.

### WP1 — Chrome: taller top bar, logo top-left, nav up, back button gone
Branch `lp/mp-chrome`, worktree `~/lp-mp-chrome`. **Sonnet.**
Files: `src/App.tsx` (header block), `src/app/shell/layout/Spine.tsx`, `src/ui/brand/AppLogo.tsx`, `brand/brand.config.json` + `scripts/brand-sync.mjs` (variant plumbing), handles baseline.
1. **Logo becomes full-color dark and moves to the top bar.** Today the logo (white text + white icon) is invisible on the light-blue Spine. Produce a **dark, full-color variant through the brand system** (add a variant slot in brand.config / brand-sync — e.g. `logo-dark.svg` — do NOT hand-hack a one-off in a component). Render it at the **top-left of the top bar** via the AppLogo component (new `variant` prop).
2. **Top bar taller** to fit the logo comfortably (single row; pick a clean token height).
3. **Remove from the top bar:** the client-name + suitcase label (TrustBar's left side). KEEP the right side: "Where does your data go?" info affordance + Privacy Center lock + the local/cloud status pill + settings gear + command palette. CRITICAL: `tests/desktop/specs/19-global-shell.mjs` needs `data-testid="trust-bar"` and the `Open Privacy Center` aria-label to survive — keep a `trust-bar` wrapper around the right-side trust content.
4. **Back button REMOVED entirely** (Jameson's decision). Keep `appNavigationStore` + `handleAppBack` machinery compiling (export may become unused-but-kept with a comment); delete the button; sanctioned handle-baseline removal for `app-back-button`, logged.
5. **Spine:** logo row leaves the Spine; the nav (Client Map / Ask / Workflows / Documents / etc.) moves up to fill that space.
Tests: update chrome/spine/e2e specs honestly; add a regression test that no element renders the old white logo path in the Spine.

### WP2 — Client Map: gaps, ⋯ menu, history pane, sparkles, sources pane
Branch `lp/mp-clientmap`, worktree `~/lp-mp-clientmap`. **Sonnet.**
Files: `src/features/matters/MatterHub.tsx`, `src/features/matters/ClientMapPanel.tsx`, the history panel component (`clientmap-history-panel`, in MatterHub), sources pane component under `src/features/matters/`, `src/platform/utils/fileIcons.ts` (read-only reference).
1. **Kill the dead band above the map.** Remove the local-AI note text ("Running on device… generation uses your local model") — redundant with the green pill. Then close the vertical gap in BOTH modes (local + cloud) so the map container (section rail + sources pane) starts directly below the client-name row.
2. **Icon trio → `⋯` menu** (supersedes this morning's ghost-trio): row = client name, `⋯` button, last-updated text. Menu items exactly: "Export client map (DOCX)", "Export client map (PDF)", "Sync all", "History". Preserve behaviors (export docx/pdf handlers, sync spinner state surfaces in the last-updated text, history opens the panel). Keep testids stable where tests pin them; adjust honestly otherwise.
3. **History pane layout fix:** rows and word-chips are cut off on the right. Diagnose the container (fixed width/overflow) and make rows wrap/fit cleanly at the panel's width.
4. **Guided-interview icon:** the Star icon becomes the **Sparkles** icon (same one the Ask tab uses — the three little AI stars). Tooltip stays "Start guided interview".
5. **Sources pane doc-type icons:** currently all red; use the same type→icon/color mapping as the Documents tab (`fileIcons.ts`): blue Word, red PDF, etc.
6. **Sources pane collapsible:** add a collapse/expand affordance (chevron) on the sources pane; persist the choice (localStorage key via `src/config/identity.ts` pattern).

### WP3 — Documents: drag polish, stuck-gray bug, ONE clean doc header, files toolbar into `+` *(critical lane)*
Branch `lp/mp-documents`, worktree `~/lp-mp-documents`. **OPUS 4.8** (docx-editor adjacency, save-indicator/close-path risk, drag logic).
Files: `src/features/documents/DocumentsHome.tsx`, `src/features/documents/editor/TabBar.tsx`, `src/features/documents/media/DocxEditor.tsx` (header region only), `src/app/shell/layout/MainPanel.tsx` (header region only), `src/features/documents/DocumentGridView.tsx` / grid-tree toggle + search relocation.
1. **Drag ergonomics:** dropping BETWEEN vertical tabs must be easy — enlarge the between-tabs drop zone (today you must hover a tab's very edge). Tune the zone split (e.g. 35/30/35 between/onto/between) and add a visible insertion line; test both reorder and group-drop still work.
2. **Stuck dark-gray bug:** after dragging a tab into/out of a group, the whole rail keeps the dark drag-hover color until the next drag. Root-cause the un-cleared drag-over state (dragleave/drop not resetting on group transitions) and fix with a regression test.
3. **ONE clean document header row.** Today three rows stack (Saved+⋯ row; the doc-name row; a repeated-name row with Draft Follow-up / Send to Wealthbox / Export / Revise with AI buttons). Build a single row directly above the editor: `[doc-type icon] [document name] [pencil rename] [⋯ menu] … [saved indicator] [Reviewing toggle] [Collapse]`. The `⋯` menu = the existing menu items (download, history, split horizontally, toggle outline, …) PLUS the four folded-in actions (Draft Follow-up, Send to Wealthbox, Export, Revise with AI). No behavior changes — every action keeps its exact current handler, disabled states, and confirmations (Send to Wealthbox review-gating untouched).
4. **Files toolbar → `+` by the "Files" title in the rail:** New document / New folder / Add files move into a `+` menu next to the pinned Files entry. The tree/grid toggle AND the search field move INTO the Files view itself (only visible when Files is selected, at the top of the file listing). Then remove the old top toolbar row entirely — the documents surface becomes: rail (Files + doc tabs) | content.
Tests: extend the reimagined-documents-home + docx suites; every close/save path test must stay green.

### WP4 — Email: master-detail conversion
Branch `lp/mp-email`, worktree `~/lp-mp-email`. **Sonnet.** *(starts after WP0 merges)*
Files: `src/features/email/EmailWorkspace.tsx` + email feature folder.
- Vertical email list on the left (RailShell), email content on the right.
- The current top bar (New email, keyword/AI search toggle, filters) collapses into the rail header: `+` (new email) and `⋯` (search toggle, filters). No email functionality changes — layout + entry-point consolidation only.
- Note: there may be little/no imported-email fixture data; build against the store/mock data the existing tests use, and make the empty state clean.

### WP5 — Meetings: master-detail conversion + mic record button
Branch `lp/mp-meetings`, worktree `~/lp-mp-meetings`. **Sonnet.** *(starts after WP0 merges)*
Files: `src/features/meetings/ClientMeetingsTab.tsx`, `MeetingEntry.tsx` (list side only — the entry detail keeps this morning's 4-sub-tab layout).
- Vertical meetings list in a left rail (RailShell); selecting one shows the meeting detail (existing MeetingEntry) on the right.
- **Record-a-meeting = a microphone icon button at the top of the rail** (replaces the current record button placement); tooltip; same consent-gated start flow, unchanged.
- Keep every consent/notice behavior and the 4 sub-tabs exactly as shipped this morning.

### WP6 — Workflows: cards → master-detail
Branch `lp/mp-workflows`, worktree `~/lp-mp-workflows`. **Sonnet.** *(starts after WP0 merges)*
Files: `src/features/workflows/AssociateHome.tsx` + workflows feature folder.
- The card grid becomes a vertical workflow list in a left rail (RailShell); selecting a workflow shows its details, Run action, and live run progress in the right content area.
- The practice filter chips (Ask-pill style, shipped today) move to the top of the rail or its `⋯` menu — whichever reads cleaner at rail width; run history/progress components reuse existing pieces.

## Sequencing & merge plan
- **Wave 1 (now, parallel):** WP0, WP1, WP2, WP3.
- **Wave 2 (as WP0 merges):** WP4, WP5, WP6 in parallel.
- Coordinator merges serially (WP0 first when green so wave 2 launches early; then smallest-blast-radius first). Full `npm run gate` in tmux on the combined tip before push; batch Legion sync + notify Jameson once the whole batch (or a meaningful first tranche) is live.
- Reviews: worker self-converge (codex-review) + coordinator's independent adversarial Codex review per branch; ALL findings per branch batched into ONE fix round (WORKER-DISCIPLINE 🧺).

## Known cross-lane seams (declared)
- WP1 (Spine/top bar) vs WP2 (MatterHub header): different files; the "gap above the map" is inside MatterHub — WP2 owns it.
- WP3 owns MainPanel's header region; WP1 does not touch MainPanel.
- WP5 renders MeetingEntry unchanged; WP3 does not touch meetings.
- i18n snapshot count: EVERY worker that adds/removes keys must note the delta in its handoff; the coordinator sets the true combined count at merge time (learned 2026-07-07: parallel branches each setting their own count = guaranteed off-by-N).

## Deferred / follow-ups (explicitly out of scope this batch)
- The flaky `sidecars::parakeet` ETXTBSY test fix (tracked separately).
- Any behavior changes to send flows, consent, or export contents — this batch is layout/consolidation only.
