# Advisor Prep Hero UX Program — Master Ledger

> The single source of truth for the first-time-user UX program. Every idea is recorded here
> with a status, so nothing is ever lost. Updated each round. Companion docs:
> - Round 1 review: `2026-06-14-first-time-ux-review.md`
> - Round 1 plan: `2026-06-14-ux-fix-execution-plan.md`
> - Deferred structural work: `2026-06-14-matter-spine-future.md`
> - Round 2 review + plan: `2026-06-14-ux-review-round2.md` (added in Round 2)
>
> Status legend: ✅ shipped · ⏸️ deferred (needs greenlight) · 🔭 open/residual · 🔁 carried to next round

---

## ROUND 1 — shipped to keepance-3.0 (merged `ae8fae5`, NOT deployed)

Gates at merge: typecheck 0 · vitest 3190 passed · cargo 457 passed · live visual sweep clean.

### Bugs fixed ✅
- **New matter button was a no-op** — dispatched `keepance:open-matter-manager` with no listener; App.tsx now opens MatterManagerDialog.
- **Opening an email showed a blank page** — full-page Email surface bypassed MainPanel, and a fragile `setTimeout` cleanup cancelled the Documents editor-advance; fixed by adding `'email'` to `REAL_FILE_TYPES` + a ref-guarded direct `setViewMode`, and navigating to the editor on open.

### Plain language ✅
- Nav renames: **Ask→Search**, **Associate→Workflows**, **AI Audit→Activity Log** (internal ids + testids unchanged). Audit filter "AI / Egress"→"AI Requests".
- Confidentiality: **3 modes → 2 plain choices for solos** ("On this computer only" / "Cloud AI, your account"); **Assured hidden unless in a firm** (no more greyed "Needs admin key").
- Egress label "Direct to <P> (your account)" → "Sent to your <P> account".
- Security "Privileged matter" → "Isolated / Network lockdown" (kept distinct from attorney-client privilege).
- Jargon purge (user copy + en.json): egress→"AI request", **API key→account key** (Settings now "AI Account Keys"), workspace→folder (selector/license only), tokens/"context is full"/"compress"→plain, "MCP write blocked"→"External AI write blocked", stripped "Markdown" and the "embedding vectors" caveat.

### First-run funnel ✅
- AI-key step: **"Skip for now" is the dominant default**, honest cost anchor ("$2 to $5 a month"), cut the "copy it ONCE" panic, removed the "turn off training" step from onboarding.
- Firm step greets solos: "How do you practice?" + dominant "I practice alone, skip this".
- Done step: one CTA ("Create your first matter") + honest no-AI note; sample toggle reworded.
- Cold landing: plain empty-state copy (dropped "scope AI retrieval"); trial chip calm, no corner upsell on first launch.
- **Get-started setup card** (live AI/email status) on the Matters empty state, deep-links to Settings.
- "Where your data goes" step: 10-row accordion → **3 plain bullets** + "Read the full data map" link.

### The aha moment (flagship) ✅
- **A brand-new user with NO AI key gets a cited answer on day one.** `sampleMatterDemo.ts` ships 3 pre-baked, citation-backed answers over the "Garcia v. Meridian Properties LLC" sample; citations open the real file (Verified badge, excerpt, "Open in editor").
- matterStore `isSample` + `getOrCreateSampleMatter`; ReimaginedAsk has a no-cloud-key demo branch; sample-matter chips auto-submit; post-onboarding lands you in that Ask.

### Consistency & simplification ✅
- Status bars de-duplicated + tidied; egress trust line never clips; **stale breadcrumb fixed** (hidden on non-editor surfaces); matter scope shown once.
- Email "Ask AI" mode: headline + explainer + 3 example chips + fixed placeholder.
- Documents empty state sells Word-native value; "New Word document" primary.
- Workflows library: horizontal practice-area filter (hidden for single-category law persona).
- Editor toolbar context-sensitive to file type (.txt/.md/.docx).

### Matter spine (safe increment) ✅
- **Matters launchpad**: each matter has Ask / Documents / Email quick-actions (`keepance:matter-launch`) that set it active + jump scoped to it.
- Workflows shows "Running in: <matter>".

### New capability ✅
- **Email attachment send** across Microsoft 365 (Graph fileAttachment), Gmail + IMAP/SMTP (multipart/mixed). Compose paperclip + removable chips. (End-to-end send needs the one-time scope re-consent on real hardware.)

---

## ⏸️ DEFERRED — needs Jameson's greenlight (full detail in `2026-06-14-matter-spine-future.md`)
- **S1 — Full matter hub.** Entering a matter opens a hub whose Ask/Docs/Email/Workflows are all pre-scoped to it; top-level nav collapses. Fundamental nav-model change; design with Jameson first.
- **C4 — Persistent Documents split.** File list left + document right (Finder/VS Code style), no browser↔editor toggle. Reworks Wave A view logic; do deliberately.
- **C6 — Unify the two Ask experiences** into one "Ask anything" with a scope toggle (All / This matter / Email / Documents). Best done with the hub.
- **C2 — Consistent primary-action placement** across every surface. Low individual value, spread risk; fold into hub.
- **S3 — Celebrate the Isolated matter.** A confirmation/shield moment when network lockdown is enabled (badge already exists).

## 🔭 OPEN / RESIDUAL
- Email send (incl. attachments) verified by plumbing + tests only; **needs a connected account + one-time scope re-consent on real hardware** for true end-to-end proof.
- Demo answers cite a single sample file (Matter Overview); could be richer (cite Client Intake too) and cover more question phrasings.
- The matter launchpad quick-actions are hover-revealed (discoverable on hover; fine on desktop, worth noting for touch).

## Raw reviewer ideas worth keeping (from the 4 Round-1 lenses, not all actioned)
- Onboarding: workspace path strings were Unix-jargon (`~/Documents/...`) — partly addressed via folder language; verify the picker copy.
- Settings has ~20 categories — the setup checklist now fronts it, but the category list itself is still long (future IA pass).
- Strategic: the unique value (Word-native, matter isolation, privilege enforcement) is still under-surfaced outside the moments we added; a "second wow" + returning-user habit loop is the next frontier.
- Proof moat (named attorneys, DPA/SOC2) is Jameson-owned, not a code task.

---

## ROUND 2 — findings (full detail in `2026-06-14-ux-review-round2.md`)

Second review on the improved build. Headline: **Round 1's flagship aha is silently broken on any
returning view** — `reconstructTurns` drops citations + strips `{n}` markers (citations were never
persisted), so navigating away and back loses the click-to-verify chips and shows a contradictory
"No indexed sources were cited." Validated in code.

### 🔁 To implement (Round 2 waves)
- **R2-A (critical, fix the aha):** A1 persist citations with messages (restore chips on reload, demo + real); A2 kill the "Answered over your own files" vs "No indexed sources" contradiction; A3 land new users on the demo chip state (not a restored last answer); A4 graceful off-script message on the sample (no fall-through to a failing provider / the stray "Workflow Questions" modal).
- **R2-B (sample clarity + bridge):** B1 "Sample" badge + confirmed delete on the sample matter; B2 dismissible "add your first real matter" bridge after a demo answer; B3 a second demo answer that cites "Sample - Weekly Review.md" (prove "across all your files"); B4 make the matter launchpad quick-actions visible (not hover-only); B5 reconcile the "Create your first matter" CTA with where it actually lands.
- **R2-C (returning-user + polish):** C1 per-matter answer history ("Recent in this matter" = the second wow); C2 profession-aware sample copy; C3 skip-setup lands on Matters + Get-started card; C4 fresh-on-navigate Search; C5 self-driven a11y/responsive/states pass (the two cut lenses); C6 first-real-file "indexed locally, nothing uploaded" trust moment.

### 🔭 Round 2 raw ideas / lower-priority (don't lose)
- Trust-bar matter-name truncation in the header (cosmetic).
- Email connect: show the value prop before the OAuth friction.
- Settings still has ~20 categories (future IA pass).
- Momentum/value-accumulation indicators on the Matters list ("2 clients, 4 docs indexed, 7 answers").
- Two reviewer lenses (core-workflows depth, full a11y/responsive sweep) were cut for time — fold into C5
  and re-run as a dedicated pass if depth is wanted later.

### 🔭 Round 2 — found-but-not-fixed (low severity, logged from the C5 a11y/responsive pass)
- **Matter name wraps at ~960px** — long "Client - Matter" labels wrap because the row keeps the Sample pill
  inline via flex-wrap. Fix = ellipsis on the label text node + move the pill outside the flex (small MatterRow refactor).
- **Email mode-hint text wraps at ~960px** (10px muted) — drop the `maxWidth` or shorten the copy.
- **Email viewer browser-mode error leaks the raw id** ("id: fix-1") in the subtitle — fixture/desktop-only path; tidy the copy.
- **No loading skeleton on the Matters surface** — fine today (matterStore is synchronous); add one only if it goes async.
- ⏸️ **C6 — first-real-file "Indexed locally, nothing was uploaded" trust moment** — DEFERRED: needs deeper
  Documents/file-add + indexing-event wiring than a safe autonomous pass should add. High-value for the
  "put a real client file in" trust barrier; do as a focused follow-up. (Captured so it is not lost.)

### ✅ Round 2 — shipped to `feature/ux-fixes-round2-2026-06-14`
- R2-A: citations persist (the aha survives navigation); trust-contradiction gone; sample lands on chips; off-script calm message.
- R2-B: Sample badge + locked/confirmed delete; visible matter launchpad; demo-to-real bridge; a 2nd demo answer citing a 2nd file; honest Done CTA.
- R2-C: "Recent in this matter" history; profession-aware sample copy; skip-setup lands on Matters; keyboard focus-ring + aria-label + grid-overflow + aria-current fixes.

### ✅ ROUND 3 — the "bigger ideas" shipped (plan: `2026-06-14-ux-round3-plan.md`)
Jameson greenlit #1, #3-#6 + smaller items; **#2 reframed (his call): NOT a matter-first nav rewrite, but a hub INSIDE the Matters tab** (keeps the tool-first tabs for tax/consulting users). Chosen layout = "Overview command-center".
- **#2 (reframed) THE MATTER HUB ✅** — click a matter -> a command center: header (name/client/date, Sample pill, Isolated shield badge), a matter-scoped Ask hero + recent questions, an at-a-glance (curated + populated for the sample; honest counts + recent activity for real matters), and Documents/Email/Workflows/Activity panels with counts + `>` jumps (keepance:matter-launch). New `MatterHub.tsx` + ReimaginedMattersHome list<->hub. Absorbs #3/#5/#6. Live-verified.
- **#3 Unified Ask ✅** — Search has a scope toggle (This matter / All matters / Email / Documents); the hub's Ask is this, matter-scoped. (The email tab's own Ask-AI mode left intact; full fold-in is a later nicety.)
- **#1 Real-file import + trust ✅** — "Add files" affordance + a one-time "Indexed on your machine. Nothing was uploaded." reassurance on first file add. (This also delivers the previously-deferred C6.)
- **#4 Persistent Documents split ✅** — file list left + document right, no more browser<->editor toggle / lost place; Trash + email-open preserved (citation e2e 12/12).
- **#5 Isolated-matter celebration ✅** — confirm + shield affirmation + persistent Isolated badge; `useActiveMatterPrivileged()` exported (the hub header uses it).
- **#6 Returning-user momentum ✅** — the hub at-a-glance (the second wow) + a quiet "N matters, M folders indexed" cue on the list. (R2 already added "Recent in this matter".)
- **Smaller consistency ✅** — matter-name ellipsis at narrow widths; email mode-hint wrap; email-viewer error no longer leaks the raw id; email-connect value pitch before OAuth; C2 list-style surfaces keep the primary action top-right.
- Gates: tsc 0, full vitest 3247, citation e2e 12/12, shell sweep clean. Merged to keepance-3.0. NOT deployed.
- **Still deferred (Jameson's call):** the full matter-first nav rewrite (he chose the in-tab hub instead); Settings IA (the ~20-category list) is a separate future pass; a real AI-generated at-a-glance for non-sample matters (the hub shows honest counts/activity today).

### ✅ ROUND 4 — Documents re-imagined + multi-vertical (plan: `2026-06-14-ux-round4-plan.md`)
- **Documents re-imagined** (Jameson live feedback: the R3 left-column split was odd/messy, no grid, created folders didn't show): now a unified tab strip with a pinned **"Files"** tab + the open document tabs (no side column); a clean card GRID of files+folders (`DocumentGridView.tsx`); MainPanel `hideTabBar` so there's one tab strip. **Folder bug fixed:** the test-mode mock workspace was a no-op (mkdir did nothing, getFileTree returned []) so created folders never appeared — it now tracks an in-memory tree (mkdir records dirs, getFileTree builds the nested tree). Files-as-tabs, Add files + trust note, Trash, email-open all preserved (citation e2e 12/12).
- **Speak every vertical** (he chose "make it speak every vertical"): new **`useEntityLabel()`** / `getEntityLabel()` — the entity term adapts to profession (legal=Matter, tax=Client, consulting=Engagement, advisor=Client) everywhere user-facing (nav + sub-header, MatterHub, ReimaginedMattersHome, MatterManagerDialog, EmailViewer); internal `Matter` type/ids/SAMPLE_MATTER_ID unchanged. Live-verified: nav reads Clients (tax) / Engagements (consulting) / Matters (legal). **Per-profession aha demos:** tax ("Dwyer - 2025 Form 1040", home-office deduction, cites the tax sample) + consulting ("Northwind" engagement, cites the consulting sample) via `getSampleMatterName`/`getDemoQuestions`/`getDemoAnswerForWorkspace(…, profession)`; ReimaginedAsk + getOrCreateSampleMatter are profession-aware. Domain-neutralized the most legal-centric data-map copy.
- Gates: tsc 0, full vitest 3287, citation e2e 12/12, shell sweep clean. Merged to keepance-3.0. NOT deployed.
- **Still deferred:** the full matter-first nav rewrite; Settings IA; a real AI at-a-glance for non-sample matters; deeper per-vertical privacy/headline copy (the high-frequency spots are done).

### ✅ ROUND 5 — Settings simplification + AI at-a-glance + per-vertical copy (plan: `2026-06-15-ux-round5-plan.md`)
Jameson's 3 queued items (he picked the Settings grouping from ASCII mockups):
- **Settings: 20 categories -> 5 sections** (Workspace / AI & Privacy / Account / Voice / Advanced & Help). A full evaluation found a third were near-empty/legacy/read-only (empty Advanced, placeholder Mobile, one-time Onboarding/About/Updates, read-only Cost & Usage). `schema.ts` + `SettingsModal.tsx` rewritten; every control still reachable (composed with sub-headers); a `CATEGORY_ALIAS_MAP` + `resolveSection()` keep EVERY in-app deep-link working (old 'ai'->AI & Privacy, 'integrations'->Account — verified live). 82 new tests.
- **Real AI 'at a glance' on the matter hub:** `src/modules/matter/matterAtAGlance.ts` (retrieves the matter's indexed content, prompts the provider for open issues/key dates/next actions grounded ONLY in it) + `src/stores/matterAtAGlanceStore.ts` (persisted cache; Refresh invalidates). MatterHub is state-aware: sample=curated demo, real+key=AI panel ("Generated by AI" + refresh + loading/empty states), real+no-key=the existing honest counts. ReimaginedAsk untouched.
- **Per-vertical copy:** `src/hooks/useProfessionCopy.ts` (sibling to useEntityLabel) adapts the confidentiality framing + cost note + solo/team + sensitive-work copy per profession (legal=attorney-client privilege; tax=return confidentiality; consulting=engagement confidentiality), applied to onboarding welcome/firm/done + the AI-setup step + the trust-bar scope. The genuinely-legal email privilege tagger ("Attorney-Client Privileged"/"Work Product") was deliberately LEFT legal (a real classification feature, not framing).
- Gates: tsc 0, full vitest 3396, citation e2e 12/12, Settings deep-link + shell sweep clean. Merged to keepance-3.0. NOT deployed.
- **Now-shorter deferred list:** the full matter-first nav rewrite (he chose the in-tab hub instead); per-vertical privilege-tagger categories (left legal for now); whatever surfaces from his next testing pass.

### ✅ ROUND 6 — Files tree+grid+DnD + Settings accordion/scroll/nav-tab (plan: `2026-06-15-ux-round6-plan.md`)
From Jameson's live testing of the Files tab + Settings:
- **Files tab:** added a **Tree | Grid toggle** (persisted to `keepance:docs-view`). The vertical expanding tree REUSES the existing v2 `src/components/workspace/FileTree.tsx` (it always had expanding folders + working drag-into-folder DnD — just was not wired into the reimagined shell; the v2 components live on `backup/pre-ui-reimagining-2026-06-13`). **Grid DnD fixed:** `DocumentGridView` declared `onMove` but never destructured/used it (the exact "cannot drag" bug) — cards are now draggable, folder cards accept drops -> `onMove`, the breadcrumb-as-drop-target was ported. Dragging files AND folders into folders works in both views. **New-doc-at-root fixed:** an optional `parentPath` now threads through the doc-create handlers (App.tsx ~2074/2127, default `<root>/docs`), passing the grid's current folder (New folder already worked). Grid icons derive the extension from `node.name` (TauriFSBackend never sets `.extension`). The test-mode mock workspace gained a real `move()` so DnD works in the browser dev server too. 46 doc tests; citation e2e 12/12; all 4 complaints live-verified.
- **Settings:** extracted **`src/components/settings/SettingsContent.tsx`** (the section nav + search + content + footer) reused by the modal (now a thin Dialog wrapper) AND a new full-page tab; **accordion sub-sections** (each SubHeader collapsible, ONE open at a time within a section, first open by default, an active search expands the matching sub-sections); **scroll resets to top** on top-level section change (was carrying over); **Settings is now a nav tab** under Activity Log (gear icon) that renders full-page in the main window, with the gear/Ctrl+, modal + all CATEGORY_ALIAS_MAP deep-links still working. ReimaginedSpine gained the `'settings'` SpineTab; App.tsx the render branch + a shared `handleSettingsAction`. 31 new/updated tests.
- Gates: tsc 0, full vitest 3439, citation e2e 12/12, shell sweep clean (the Settings nav tab renders). Merged to keepance-3.0. NOT deployed.

### ✅ ROUND 7 — standardized surface headers + Settings collapse-all (plan: `2026-06-15-ux-round7-plan.md`)
- **One standard header on every surface:** new `src/components/layout/SurfaceHeader.tsx` (navy 18px icon + 22px/700 title + 13px muted description + optional right-side actions slot — matches the Matters header exactly). Applied to Matters (Briefcase, refactored to BE the reference), Search (Sparkles), Documents (FolderTree — it had NO header before), Email (Mail), Workflows (ListChecks), Activity Log (ShieldCheck), and the Settings page (gear). Each surface keeps its own actions (New matter, New email, scope toggle, export, the Files tab strip) in the header's `actions` slot / below. Verified: every surface's `h1` is its title; consistent across tabs.
- **Settings accordion:** sub-sections now ALL collapsed by default (was first-open); clicking an open one collapses it (zero-open allowed = collapse-all); still one-open-at-a-time when opening; search still expands the matching sub-sections.
- Gates: tsc 0, full vitest 3444, citation e2e 12/12, header-consistency sweep clean. Merged to keepance-3.0. NOT deployed.

### ✅ ROUND 8 — self-driven QA polish (no plan doc; 2 read-only review agents fed the fixes)
Autonomous wave while Jameson slept, off the back of R7. Two QA review agents surfaced ~20 findings; the safe/clear ones shipped. **Orchestration note for next time:** one fix agent ran in an isolated git worktree (`agent-…`) instead of the main tree, so its changes had to be patched in by hand before the combined verify — re-check `git status` + grep distinctive markers after every parallel batch, exactly as the rules say.
- **Header consistency, to the pixel (the headline R7 follow-through):** every surface header wrapper standardized to `padding: 24px 24px 16px` + a bottom border — Search, Matters, Workflows, Email, Activity Log, Documents, and **Settings** (`pt-6 px-6 pb-4` == the same), so the title sits at an identical height on every tab (Settings was 8px high before). Email: the floating "keyword search covers all email" 2nd line folded into one clean description; the matter-scope toggle now HIDES in keyword mode (was faded). Activity Log: the "stored in your browser, not encrypted" line moved out of the header into a muted banner below; CSV/JSON export truly disabled (+ title) when empty; controls aligned to 24px. Search: recent-question aha chips widened so full questions are readable. MatterHub: navy Briefcase icon added beside the matter title.
- **Documents nav lands on the Files browser (real bug):** clicking Documents dropped you back into the last-open file editor. Root cause = `ReimaginedDocumentsHome` UNMOUNTS/REMOUNTS on every nav, so the R8-agent's counter "reset signal" effect always hit its skip-first-render guard and never fired. Replaced with a **persistent `documentsView` intent owned by App.tsx** (it survives the remount), read in the `useState` initializer on mount: nav click / reveal-folder / matter-launch → `browser`; email/file open → `editor`. `prevActivePathRef` seeded with the mount-time active path so the external-open effect does not yank a nav-landing into the editor. Live-verified (navigate away → click Documents → file browser).
- **Documents grid count fixed:** counted the whole tree ("2 documents") → now the current directory level ("1 folder" / "N items").
- **Documents toolbar wraps** at narrow widths (flexWrap + shrinkable search); **Tree mode gained "Add files"** (parity with grid); **gear / Ctrl+,** no longer opens the Settings modal on top of the active Settings tab.
- **Settings a11y:** `aria-current="page"` on the active section nav button; accordion bodies stay mounted-but-`hidden` (was unmounting) so `aria-controls` resolves while collapsed. The "section nav routes away" QA flag was a `?mailFixture=1` test artifact (the fixture fires an open-email event on load), not a product bug — confirmed, no product change.
- Gates: tsc 0, full vitest 3455 (0 fail), citation e2e 12/12, eslint clean on touched files (App.tsx pre-existing debt only, no new errors), live header + Documents + Settings sweep clean. Merged to keepance-3.0. NOT deployed.

### ✅ ROUND 9 — six-persona review (NEW user-experience angles) + fix wave (no plan doc; 6 read-only review agents fed the fixes)
Jameson asked for a fresh round through DIFFERENT user lenses than the prior first-time-user focus. Six parallel read-only review agents, each a distinct real user: (1) daily power user / efficiency, (2) privacy-obsessed skeptic, (3) scale/density (60 matters), (4) error/recovery/edge cases, (5) accessibility (keyboard + screen reader), (6) evaluating buyer. ~65 findings; strong cross-agent convergence on the real ones. Shipped in 2 verified waves on disjoint files. **No worktree mishap this round (all 12 agents edited the main tree).**

**Wave 1 — core bugs + privacy honesty + error handling:**
- **CORE-VALUE BUG (3 agents independently): the matter-hub Ask box discarded the typed question** and dropped you on a blank Search (it called `dispatchLaunch('search')` with no payload). New cross-file prefill contract: MatterHub dispatches `keepance:matter-launch` with `detail.question`; App stashes it in `askPrefill` state + passes `prefillRequest`/`onPrefillConsumed` to ReimaginedAsk, which prefills + auto-submits, then App clears it (so a remount doesn't re-fire). Live-verified end-to-end (hub recent-question chip → Search answers it with a verified citation).
- **Privacy correctness:** Trust Bar egress pill was hardcoded `provider="anthropic"` (always lied for OpenAI/Gemini/local) → now reflects the real active provider (`useActiveEgressProvider`, local-only → ollama). The egress AUDIT record logged `provider-direct` even in firm Assured mode → now passes `assuredAvailable` so the defense-file destination is true. ReimaginedAsk now renders an `EgressIndicator` above its composer (it had none; AIChatViewer always did).
- **Privacy HONESTY copy:** Data Map dropped "exactly one reason" (now honest about opt-in analytics + bug-report endpoints), added a firm Assured-relay row, and gates the browser-demo caveat to demo mode (desktop users get an affirmation). Onboarding dropped the absolute "never through Advisor Prep Hero" (true for solo BYOK, not firm Assured) and added a Dropbox/iCloud "those folders sync to a third-party cloud" caveat. (Em-dashes the agent introduced were removed by the orchestrator — no em-dashes in user copy.)
- **Errors:** silent file-op failures (rename/open/create/move/delete) now show plain-language messages; raw AI errors (401/quota/context-length) and email errors are mapped to plain language; the Activity Log empty state distinguishes "no matches (clear filters)" from a truly empty log; the "indexing off" warning gained an Enable button.
- **Keyboard:** Ctrl+N wired (was advertised, dead); Ctrl+1..7 jump tabs; `/` focuses Ask; always-reachable "New search" in the composer; skip-to-content link.
- Gate: tsc 0, full vitest 3464, citation e2e 12/12.

**Wave 2 — scale + accessibility:**
- **Scale:** Matters list gained a search box (shown past ~5 matters) + sortable columns (default alphabetical). Email got "Showing N of M", searchable file-to-matter pickers, and Ask-email cards that lead with subject/snippet not a raw id. Documents grid count shows "3 of 12" when filtered. Workflows persists the practice-area filter + category collapse across tab switches and shows "N of M / hidden by search" when narrowed. FileTree "New Folder" now targets the selected folder, not root.
- **A11y:** Documents tab strip is keyboard-operable (real buttons, Enter/Space, role=tablist/tab); FileTree got role=tree/treeitem + Space-activate; email + matter-row hover actions now reveal on keyboard focus (focus-within) at readable contrast; email search has a focus indicator; spinners honor `prefers-reduced-motion`; Settings nav has a landmark label + the accordion body is an aria-live region. GetStartedCard leads with "Create your first matter".
- Gate: tsc 0, full vitest 3504 (0 fail), citation e2e 12/12, live Matters sort check. Merged to keepance-3.0. NOT deployed.

**⏸️ FLAGGED for Jameson (deliberately NOT changed — design-direction or board-level, needs his call):**
- **"Search" vs "Ask" vs "AI Assistant" naming.** The buyer lens argues the core feature reads as three names (marketing/aria say "Ask", the nav says "Search", and a separate "AI Assistant" tab exists). Prior rounds deliberately renamed Ask→Search for plain language, so reconciling is HIS naming call, not a silent flip.
- **Pricing/positioning (board-level):** the founding-rate has no scarcity/availability signal; the license "what you unlock" list names features that are hard to find in-product (Whiteboard/audio/research); "the litigation associate" in pricing copy vs the "Workflows" nav label. Recommend aligning copy to the in-product labels — but pricing/positioning is his decision.
- **Matter-hub row click silently sets the active AI scope.** The description says "Click a row to focus AI on that client," but a buyer/power-user may want row-click = open hub (preview) vs an explicit "set active scope." Interaction-model decision.
- **Trial → buy flow** is three hops (banner → Settings → website). Could short-circuit the banner straight to checkout; touches conversion, so his call.
- **Real activity feed in the MatterHub:** R9 did the honest cheap fallback ("Matter created [date]" + guiding copy); wiring the live audit feed into the hub is a bigger data decision.
- **Keyboard "Move to folder"** alternative to drag-and-drop (a11y) — flagged with a `// TODO(a11y)` in `DocumentGridView`; needs a UX pattern decision.
- **ModelListService refreshes model lists via the provider API even in local-only mode** (key-bearing request, no content). Privacy purists may want it suppressed in local-only; behavior tradeoff, left as-is.

