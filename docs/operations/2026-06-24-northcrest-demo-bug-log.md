# Northcrest demo — bug & UX log (collection pass, 2026-06-24)

Collected by driving the **production/preview build** on the Legion. Severity:
🔴 blocker · 🟠 major · 🟡 minor/UX.

## ✅ RESOLUTION (2026-06-24) — ALL fixed, merged to keepance-3.0, GATE GREEN
Fixed by 4 parallel Codex agents (one per cluster), reviewed + merged + gate-green
(typecheck + i18n + 4001 vitest + ESLint + all cargo tests). Commits on
keepance-3.0 (HEAD after merges + 3 follow-up gate fixups):
- **import-engine** → A1 (clients tagged on import: retag/PDF pass now read a FRESH
  file tree, not the empty cached one), A2 (PDFs index on import), A3 (Rust
  `normalize_source_path` → forward-slash tokens everywhere → no duplicate),
  A4 (PDF/OCR progress in the banner), B4 (real citation filenames via correct PDF
  path storage). Resolver now tries direct+relative+absolute path forms.
- **clientmap-ui** → B2 (citation/edit spacing polished), B3 (safe auto-apply of
  clean ADD proposals only; accurate count).
- **ask-search-ux** → B1 (grounded answers attach citations), C4 (recent questions
  workspace-scoped).
- **matter-hub-ux** → C1 (folderPath dedupe), C2 (upcoming dates surfaced),
  C3 (mapped folder shows checked).
Follow-up gate fixups by the integrator: added `setSessionWorkspaceRoot` to 3
aiChatStore test mocks; `in`-guard instead of unnecessary `??`; derived
`doneVisible` so the banner never setStates synchronously in its effect; kept the
citation label as the (now-correct) basename. **Windows-verified (clean auto-import, no scripts):** opening the workspace now
auto-tags every client's office files (A1) and auto-indexes their PDFs with a live
"Indexing PDFs: N/301" banner (A2/A4); Hollings = 8 docx + 7 pdf scoped, isolation
holds (Hollings query scoped to Webb = 0 leak), and the Client Map renders with
clean citation pills + spacing (B2).

---


## A. Auto-import / indexing (the clean "open a workspace" flow)

- **🔴 A1 — One-time retag on import does NOT tag clients.** After a clean import,
  every office/text chunk stays `unassigned` (client-scoped search/Client Map come
  back empty) even though the 26 clients are mapped to their folders. Root cause:
  the new `retagExistingMatterFolderPaths` runs right after `indexWorkspace()`
  resolves, **before the workspace file tree is populated** — `getFileTree()`/the
  cached tree return nothing, so there are no paths to retag. (The SAME
  `reindexFolderPaths` works perfectly when a user toggles a folder later, once the
  tree is loaded — verified 0→18 earlier. So it's purely a timing problem.)
  Evidence: console shows "Cannot load sources: workspace not initialized" during
  the window; all 240 office chunks `unassigned`.

- **🔴 A2 — PDF auto-pass indexes ZERO PDFs on import (production build).**
  `indexWorkspacePdfs` reads `useWorkspaceStore.getState().fileTree` (the CACHED
  tree), which is empty when the index kicks off on open → `collectPdfPaths` = []
  → no PDFs indexed. (When a folder is toggled later, `reindexFolderPaths` reads a
  FRESH tree + routes PDFs to `indexPdfFile`, which works.) Net: out of the box, an
  advisor's PDFs — ~80% of their files — silently never index. This is the single
  biggest gap to "it just works on import."

- **🟠 A3 — Windows mixed-separator duplicate risk.** The workspace root
  normalizes to forward slashes (`C:/.../Northcrest Wealth Partners`), but the Rust
  walk appends children with the OS separator, so office chunks are stored
  MIXED (`C:/...Partners\Clients\...docx`). The tagging fix rebuilds an ALL-forward
  absolute path, which does NOT byte-match the stored mixed path, so the retag
  writes a NEW (correctly-tagged) chunk and leaves the old `unassigned` one — a
  duplicate, and the all-clients view shows stale unassigned copies. Proper fix:
  normalize all stored RAG paths to forward-slash at the Rust storage boundary so
  every code path agrees on one form. (PDFs aren't affected — they stay relative.)

- **🟡 A4 — Indexing banner under-counts + no PDF/OCR progress.** The "Indexing
  workspace: N/73" banner counts only office/text files; the (large, slow) PDF +
  OCR pass has no progress UI at all. A user importing 374 files sees "73" and gets
  no signal PDFs are being read. Add PDF/OCR progress.

## B. Impressive flows (Client Map / Ask / isolation) — verified WORKING earlier

(These work once data is tagged — confirmed in an earlier session-state. Re-checking
for UX issues in this pass.)

- **🟡 B1 — Ask sometimes labels a correct, file-grounded answer "Not cited from
  your files — verify before relying on it."** Seen (twice) on the Hollings
  "central planning issue" answer (clearly drawn from the estate/tax files). The
  answer was right and sourced, so the warning undersells it. Client Map citations
  work cleanly; Ask's citation-attachment is stricter and sometimes drops them.

- **🟠 B4 — Ask citations show meaningless source names ("[6.pdf page 1]").** The
  DAF answer was correct but cited "6.pdf" instead of the real file
  ("Email - DAF grant request spring board meeting….pdf"). For a product whose
  promise is "every answer cites its source," a citation the advisor can't map to
  a real document undermines trust. (Likely tied to the PDF path/label handling.)

- **🟠 B2 — Client Map items render as run-on text (no spacing for the citation +
  edit affordances).** Each fact shows like
  *"...for capital preservation.source p. 3edit"* — the "source p. 3" citation
  chip and the "edit" button are jammed directly onto the sentence with no space
  or visual treatment. On the demo's headline surface this looks unpolished.
  Source: `ClientMapView.tsx` `Item` renders `<span>{text}</span>` then bare
  `<button>source…</button>` and `<button>edit</button>` inline with no gap/styling.
  (Confirmed visually on Hollings: "story so far", "key people", "where things stand"
  all read this way.) Quick win, big polish payoff.

- **🟡 B3 — Client Map dumps "34 updates to review" after a re-index.** When the
  underlying files change/re-index, the map queues a large batch of proposed
  updates (badge "34 a few updates to review"). 34 at once is a lot to triage and
  "a few" is inaccurate. Consider auto-applying high-confidence ones or summarizing.

## C. Client hub / other UI/UX

- **🟡 C1 — Hub "Documents (2)" lists the same folder twice.** Hollings shows
  DOCUMENTS (2) with "Hollings Family / Hollings Family". Caused here by a matter
  carrying two folderPaths for the same folder (absolute + relative — partly my
  seed contamination), but the hub doesn't dedupe folder display, so any
  double-mapping shows a confusing duplicate. Dedupe folderPaths (display + on add).

- **🟡 C2 — Hub "Upcoming / Activity: No upcoming deadlines yet" despite dated
  items in the files.** The meeting notes/plans contain dated reviews and a "May
  board meeting" DAF deadline, but the at-a-glance shows none and only says "Ask
  the AI to find any." Proactively surfacing 1-2 upcoming dates would feel smarter.

- **🟡 C3 — Matter manager shows a mapped folder as UNCHECKED.** Toggling Hollings'
  already-seeded folder reported `checked=false`. Tied to C1 (folderPath format
  mismatch between what's stored vs what `collectFolderPaths` lists). A folder that
  IS mapped can appear unmapped in the manager.

- **🟡 C4 — Search "recent questions" carousel shows stale, off-topic queries.**
  The Search surface lists leftover questions from prior legal/test sessions
  ("What is the answer deadline in the Gar…", "In the scanned exhibit, what is the
  ZEB…") — irrelevant to an advisor demo and from a different workspace/context.
  Recent-questions history should be per-workspace (or cleared), not global.

## D. What WORKS well (keep / lean into for the demo)
- Client Map builds itself with rich, accurate, **cited** facts (Hollings story,
  people, holdings, trusts, DAF — all correct, page-cited).
- Ask returns accurate, file-grounded answers (estate tax $8.89M + ILIT; DAF $175k).
- **Client isolation is solid**: a Hollings-only query scoped to Webb returned ONLY
  Webb files (incl. the OCR'd `scan_0421.pdf`), zero Hollings leakage.
- OCR works: scanned PDFs (`scan_0421.pdf`, etc.) are read + tagged.
- At-a-glance "Generated by AI" next-actions are sharp and on-point.
- The light, clean hub layout is professional.

## Priority for the fix pass (suggest)
1. 🔴 A2 (PDFs index on import) + 🔴 A1 (clients tagged on import) — the two that
   make "open a folder and it just works" true. A3 (Rust path normalization)
   underpins doing A1 cleanly without duplicates.
2. 🟠 B2 (Client Map citation/edit spacing) + 🟠 B4 (real citation names) — cheap,
   high-visibility polish on the headline surfaces.
3. 🟡 A4 / B1 / B3 / C1–C4 — polish.

## Already FIXED this session (for reference, not open)
- ClientMapTemplates infinite-render crash (white screen on opening Client Map) —
  fixed + merged (commit 553ba78d's sibling; the useShallow fix).
- Folder→client tagging for the **UI folder-toggle** flow — fixed + merged + verified
  (0→18). The AUTO-import path still has A1/A2/A3 above.

---

## 🔎 Next-session: where to look hardest (from the integrator)
Scrutinize most the things FIXED this round but never deeply re-verified in the UI,
and the surfaces never swept. Specifically: (1) the **Client Map "updates to review"
tray** — Agent 2 added auto-apply of clean ADDs; confirm the count is accurate, the
accept/dismiss flow works, and auto-apply is neither too aggressive (never touches
user-confirmed items) nor too timid; (2) the hub **"upcoming dates"** (C2) — does it
surface real deadlines (the DAF "May board meeting", scheduled reviews) or stay empty/
hallucinate; (3) **Ask citation trust state** — do chips show the right green
"source found" vs unverified, does clicking a citation open the correct file+page,
and re-check the "not cited" warning on grounded answers + multi-turn follow-ups;
(4) the hub **"Documents (N)" dedupe + matter-manager folder checkboxes** (C1/C3) on
clean relative data. Then sweep the surfaces I barely touched, where polish gaps
hide: the **true first-run/onboarding** (welcome → native folder pick → first index →
first Client Map, driven start-to-finish, never skipped), **Settings / Privacy Center
/ Activity Log / Workflows / Email-connect / Trash**, all **empty/loading/error
states** (no API key, mid-index, provider error), and the **20 light + other deep
households** (do sparse clients build awkward/empty maps?). Finally judge **feel**:
Client Map build time, Ask latency, indexing snappiness, OCR'd scanned-PDF provenance
labels, and light-theme consistency everywhere — "impressive" lives in those details.

---

# Round 2 sweep (2026-06-24, clean-slate verified)

**Method.** Driven on the real Windows bench (Legion, `Microsoft Windows 10.0.26200`,
host Desklink129887) over CDP — every finding observed in the running app, not from
code reading. **Clean-slate rule now enforced** (see
[[feedback_keepance_clean_slate_testing]] / `scripts/demo/legion-clean-reset.sh` +
`legion-purge-residue.mjs`): the first pass was on ACCUMULATED state and exaggerated
some issues, so every Client-Map / Ask / Audit finding below was **re-verified after a
clean wipe** (localStorage residue cleared, `.keepance` index rebuilt from scratch via
the real auto-import). Where a finding was residue-only it is marked RESOLVED-BY-CLEAN.

## ✅ Verified WORKING on a true clean first-run (keep / lean into)
- **Auto-import "just works" (A1/A2/A4 hold).** Opening the workspace auto-tagged every
  client's files and auto-indexed all PDFs with real progress: "Indexing workspace:
  N/73" then "Indexing PDFs: N/301. Nothing leaves your machine." then "OCR: page N of
  M…". 73 office + 301 PDF + OCR, fully automatic, 0 manual scripts. Auto-tag confirmed:
  Hollings scoped retrieval = 20 hits (14 PDF); `_Firm` correctly stays unassigned.
- **Isolation solid** (retrieval-level): Hollings/Webb/Voss each return ONLY their files
  (leak=0 every query).
- **Client Map single build is CLEAN** (see R2-CM1): 35 well-distributed items, no dupes.
- Welcome screen, Settings, Privacy Center, Workflows (advisor packs), Documents tree,
  Trash empty-state, hub at-a-glance next-actions, egress indicator ("Sending to your AI
  provider"), light theme — all polished and professional.

## 🔴 Blockers / near-blockers
- **R2-ASK1 — Ask/Search answers NEVER cite their source (0 citation chips; every answer
  shows "Not cited from your files. Verify this before relying on it.").** Re-verified on
  a fully clean state: fresh single question "total portfolio value / revocable trust" →
  correct answer ($50,200,000 / $18,750,000) but 0 chips, 0 green attestation, the
  uncited warning. The Search page subtitle literally promises "Every answer cites its
  source," so on the headline demo surface every answer contradicts the core promise.
  ROOT CAUSE: Ask relies on the model emitting inline `[filename paragraph N]` markers
  (`workspaceCommand.ts` buildWorkspaceAnswerPrompt + CITATION_RE parseCitations);
  the bench's OpenAI model emits none → `bindAnswerCitations` returns [] → TurnBlock
  `hasGroundedCitation=false` → uncited warning. (Client Map cites fine because it uses
  STRUCTURED JSON sourceNumbers, not free-text markers.) ROBUST FIX (no shortcut, this is
  THE promise): make Ask citations reliable regardless of model marker compliance —
  post-hoc ground the answer's claims back to the retrieved chunks (lexical + embedding)
  and attach verified citations even when the model emitted no markers; and/or move Ask
  to a structured answer+sourceIndices contract like Client Map. End state: grounded
  answers show clickable chips + the green "Answered over your own files" attestation.
  Files: `src/features/ask/askHelpers.ts` (bindAnswerCitations, prompt path),
  `src/platform/rag/workspaceCommand.ts` (buildWorkspaceAnswerPrompt, parseCitations,
  normalizeNumericCitations), `src/features/ask/TurnBlock.tsx`, `CitationText.tsx`.
  (B1 was marked fixed last round — it is NOT fixed in the real Ask path on Windows.)

## 🟠 Major
- **R2-CM2 — Client Map citations say "source p. 0" (page 0 is meaningless).** On a CLEAN
  single Hollings build, 20 of 35 items (57%) cite "p. 0". REAL bug, not residue.
  `locator = "p. " + hit.pageNumber` (`types.ts` sourceRefFromRagHit), so 20 chunks carry
  `pageNumber === 0`. Find where pageNumber 0 is stored (PDF/OCR indexer or office-walk
  default) — store the real page, or omit the locator when page is unknown (render bare
  "source"). Files: PDF/RAG index path + `src/platform/clientMap/types.ts`.
- **R2-AUDIT1 — Activity Log empty after real AI usage.** Re-verified clean: after a fresh
  UI Ask (a real OpenAI request) the Activity Log still shows "No activity logged yet,"
  though it promises "Every AI request, file operation, workflow run … logged." Undercuts
  the "auditable" trust pillar on the demo. Either Ask/read AI requests aren't logged, or
  the audit wiring is broken for the BYOK-direct path. Files: audit-log wiring for Ask +
  Client Map + at-a-glance.
- **R2-LABEL1 — Clients list shows a "PRIVILEGE" column (legal jargon, empty for all
  rows).** Wrong for financial advisors — this is the advisor-pivot A7 "privilege →
  sensitive" relabel, not yet done, and it sits on the FIRST screen an advisor sees.
  Relabel to "Sensitive"/"Confidential" (via the entity-label facade, do NOT rename any
  internal `matter`/`privilege` key) or drop the column. File:
  `src/features/matters/MattersHome.tsx` (+ `useEntityLabel.ts` facade).
- **R2-CM1 — Client Map near-duplicate growth on re-index (LATENT; single build is
  clean).** RESOLVED-BY-CLEAN for the demo: a fresh single build = 35 items, 0 dupes,
  reads well. The 128-item bloat seen first was ACCUMULATED test residue (the prior
  ~1 MB `keepance:client-maps`), not what a first-run advisor sees. BUT the underlying
  flaw is real and will bite over time: dedupe is EXACT normalized-text only
  (`updater.ts` normalizeText / proposeUpdates `existingText.has(...)`), so a fact reworded
  by one word is treated as new and auto-applied (B3 autoApplySafeAddUpdates) — repeated
  re-indexes pile up near-dupes unbounded. ROBUST FIX: near-duplicate detection at
  propose+build time (token-overlap/Jaccard or embedding-cosine threshold) + a sensible
  per-section cap. Files: `src/platform/clientMap/updater.ts`, `generator.ts`.

## 🟡 Minor / polish
- **R2-HUB1 — Hub "No upcoming deadlines yet" is inconsistent.** Hollings shows none even
  though its Client Map "What's coming" has items; a light client (Diaz Sandra) DID
  surface an upcoming review. Either surface real future dates consistently or word it so
  an empty result doesn't look broken. File: hub at-a-glance upcoming-dates logic.
- **R2-HUB2 — Raw citation markers leak as literal text into the hub.** Diaz Sandra's
  at-a-glance activity read "Annual account review … is planned … **[2 page 6]**" — the
  raw marker shows instead of a chip or clean text. Strip/render markers in at-a-glance.
  File: at-a-glance rendering (MatterHub / generateMatterAtAGlance output handling).
- **R2-EMAIL1 — Email surface is contradictory.** Banner "Your email is connected" + a
  perpetual "Syncing…" spinner, but body "No email has been synced yet." No mailbox is
  actually connected for the demo. Reflect the true unconnected state (connect CTA) and
  stop the spinner. File: email connector status/sync state.
- **R2-EMAIL2 — Copy bug** in the Email AI banner: "Try a search **your inbox search**
  never could." (duplicated "search"). Should be "Try a search your inbox never could."
- **R2-RECENT1 — Recent-workspaces shows stale + duplicate entries.** Even after a full
  localStorage wipe, "Recent (5)" listed Northcrest TWICE (mixed `\` vs `/` separator =
  the A3 path issue) + 3 dead test folders. The recent list persists in the Tauri BACKEND
  (beyond localStorage). Normalize the path separator so a workspace appears once; age out
  dead folders. (First screen an advisor sees.)
- **R2-CM3 — Orphan Client Maps for deleted matters** linger in `keepance:client-maps`
  (2 non-Northcrest maps from old sessions). Mostly a residue/cleanup nit; a map for a
  matter that no longer exists should be pruned. (Cleared by the clean reset.)

## Test-harness notes (not app bugs)
- `scripts/legion-drive.sh type <id> "multi word"` word-splits over SSH (passes `$*`
  unquoted) → only the first word reaches the input. Use `page.fill` via a `.mjs`
  (`legion-ask.mjs` / `legion-askcheck.mjs`) for multi-word text.
- A localStorage `clear()` issued while the app runs does NOT survive a `Stop-Process
  -Force` (WebView2 flushes async). Durable wipe = delete the WebView2 Local Storage at
  `C:\Users\james\AppData\Local\com.keepance.app\EBWebView\Default\Local Storage` while
  the app is stopped, OR purge keys in-page then `location.reload()` (no kill) — see
  `legion-purge-residue.mjs`. NOTE: the OpenAI key lives in localStorage (`apiKey_openai`),
  so a full wipe must re-seed it.

## Fix-pass clustering (non-overlapping file groups → parallel Codex agents)
1. **ask-citations** (🔴 R2-ASK1): askHelpers.ts, workspaceCommand.ts, TurnBlock.tsx,
   CitationText.tsx. TS-only.
2. **clientmap-quality** (🟠 R2-CM2 page-0 label + 🟠 R2-CM1 near-dup dedupe/cap):
   clientMap/types.ts, updater.ts, generator.ts. TS-only. (page-0 root cause may also
   touch the PDF index path — coordinate with #5 if it's Rust-side.)
3. **labels-hub** (🟠 R2-LABEL1 privilege column + 🟡 R2-HUB1 upcoming + 🟡 R2-HUB2 raw
   markers): MattersHome.tsx, MatterHub.tsx, useEntityLabel.ts, at-a-glance helper. TS-only.
4. **email-recent-polish** (🟡 R2-EMAIL1/2 + 🟡 R2-RECENT1): email connector status + copy,
   recent-workspaces path normalization. TS-only.
5. **audit-logging** (🟠 R2-AUDIT1): audit-log wiring for Ask/Client Map. May touch Rust
   (the one cargo-compiling agent runs the full gate). Investigate first.
