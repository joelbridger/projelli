# Northcrest demo — bug & UX log (collection pass, 2026-06-24)

Collected by driving the **production/preview build** on the Legion. NOTHING fixed
yet (per Jameson: collect first). Severity: 🔴 blocker · 🟠 major · 🟡 minor/UX.

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
