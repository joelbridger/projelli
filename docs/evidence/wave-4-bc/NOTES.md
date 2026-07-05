# Wave 4 Track B/C — evidence notes

**Scope:** Book view (Track B, Tasks 1/2/2b) + whole-practice Ask (Track C, Tasks 3/4/5).

## Live screenshots — not captured, and why

I tried to drive the always-on Chrome (`chrome-cdp`) against both a plain `npm run dev`
build and a `build:web-demo` + `vite preview` build to screenshot Book view and the
whole-practice Ask panel. Both builds stop at the workspace-picker screen ("Open
Existing" / "New Workspace"): clicking either does nothing because
`window.showDirectoryPicker` is `undefined` in this Chrome instance (confirmed via
`chrome-cdp eval`) — the File System Access API isn't available here, so there's no
way to open or create a workspace and reach the app's actual surfaces from this
browser session. This is an environment limitation, not a bug in the changed code.

Getting past it needs either a Tauri desktop build (native FS, no picker API needed)
driven via the Legion Windows bench / `scripts/desktop-drive.mjs`, or a Chrome profile
with the File System Access API enabled — both out of reach for this worker session.
**Recommend the coordinator captures the real screenshots via the Legion bench (or a
capable Chrome profile) before merge**, using the flows below.

## What to screenshot + the click counts to verify

**Book view (Client Map tab):**
1. Client Map tab → "Whole book" segment (1 click) — ranked list, neediest first,
   score bar + level chip + gap chips per row (matches `p7-book-and-ask.html`).
2. Click a row (1 click) → opens that client's Client Map hub.
3. Seed a client with a beneficiary MISMATCH/STALE/MISSING finding → confirm the
   amber gap chip renders under the row and the tooltip shows the honest-limits line
   ("Flagged for your review. Not legal advice.").

**Whole-practice Ask:**
1. Ask tab → "Whole practice" scope chip (1 click) — scope pill updates to "Whole
   practice (summaries only)".
2. Type a question, Enter or the send button (1 click) → loading state
   ("Reading your client summaries...") → answer + one chip per matching client.
3. Click a client chip (1 click) → opens that client's Client Map (not a restored
   snapshot — Wave 4 added an explicit `matters` surface for this).
4. Click a cited fact under a chip (1 click) → opens the source passage (routes
   through the existing `dispatchOpenSource`, so email/CRM/connector sources open
   correctly too, not just documents).
5. Try it with file access NOT granted for the conversation on a cloud provider →
   confirm it refuses with the consent message instead of silently sending every
   client's summary.

## What IS verified: tests

Every behavior above is covered by an automated test (105 new/updated tests across
Track B + C, all passing — see the branch's commits). Full-suite state at handoff:
`npx vitest run` → 563 files / 5567 passed, 4 skipped, 1 file skipped (a pre-existing,
unrelated gap: `tests/unit/ocr/ocrEngine.wasm.test.ts` needs a gitignored vendored
`.wasm` binary that a plain `npm run dev` happens to fetch via its `predev` script but
a bare `vitest run` does not — not something this wave's diff touches).
`npm run typecheck` and the ESLint gate are clean except one pre-existing, unrelated
finding in `src/features/documents/versioning/VersionService.ts` (confirmed via
`git log` to predate this branch's work, outside Track B/C scope).

The no-raw-RAG guard (Track C's most safety-critical property) has a dedicated test
asserting `MemoryService.retrieve` and `rag_retrieve` are never called for a
whole-practice question (`src/features/ask/book/wholePracticeAsk.test.ts`).
