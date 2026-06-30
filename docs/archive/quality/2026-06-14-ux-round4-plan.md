# Advisor Prep Hero UX — ROUND 4 plan: re-imagine Documents + speak every vertical (2026-06-14)

Two efforts from Jameson, in his order. Branch `feature/ux-round4-2026-06-14`, backup tag
`pre-ux-round4-2026-06-14`. NOT deployed.

## R4-1 — Re-imagine the Documents tab ("Files" as a pinned tab)
Jameson's live feedback (screenshot): the left column is odd, there's no grid file view, created
folders don't show, it looks messy. His chosen layout: **"Files" as a pinned tab.**

- **Replace the R3 persistent split** (left list + right editor) with a unified tab strip: a pinned
  **"Files"** tab first, then the open document tabs. No side column. Click a file -> opens as its own
  tab; click "Files" -> the grid. When nothing is open, "Files" is active.
- **Grid file view.** The "Files" tab shows a clean GRID of files + folders (cards/icons, not a list),
  with folder drill-down (breadcrumb), the actions (New document / New folder / Add files / Search),
  and the Files|Trash toggle. Folders are visible and clickable.
- **Fix the folder/tree bug.** The browser reads `useWorkspaceStore().fileTree`; in real sessions it
  shows empty even when the workspace has files/folders (breadcrumb shows `test-workspace/docs/test1.md`
  but the grid is empty), so the tree isn't reaching the grid. Investigate why the fileTree is not
  populated/loaded for the reimagined Documents surface on workspace open (App.tsx getFileTree wiring;
  load order; reimagined-shell path) and FIX it so the grid shows real files + folders and refreshes
  after New folder / New document / Add files / delete / rename. The create-folder handler already does
  `mkdir -> getFileTree -> setFileTree`; the gap is the initial load / the grid reflecting the tree.
- **Keep:** files-as-tabs (the open-tab model), the editor + toolbar, Trash, the "Add files" import +
  the first-file trust note (R3-1b), the email-open flow (citation e2e must still pass).
- Integration: the cleanest is a pinned "Files" tab in the editor tab strip (TabBar/MainPanel) that
  renders the grid when active; or ReimaginedDocumentsHome renders a unified strip. Implementer picks
  the cleanest; do not break the editor/tab system or the email-open advance.

## R4-2 — Speak every vertical (multi-vertical)
Today Advisor Prep Hero is functionally multi-vertical (tax/consulting/advisor each have real template packs
[13/9/7], profession-aware samples, the onboarding profession picker, founder-surface gating) but
LINGUISTICALLY legal-only. Jameson chose: **make it speak every vertical.**

- **Profession-adaptive entity label.** "Matters" -> "Clients" (tax) / "Engagements" (consulting/advisor)
  / "Matters" (legal) / a sensible default (other), via the i18n layer, EVERYWHERE it shows to users:
  the nav (`ReimaginedSpine` "Matters"), the matter hub, MatterManagerDialog, ReimaginedMattersHome,
  empty states + error messages ("No matters yet" -> "No clients yet"), the data map. Keep the internal
  `Matter` type/ids; only the visible label adapts. Add a single source of truth (e.g. a
  `useEntityLabel()` hook / profession->label map) so it's consistent and testable.
- **Profession-specific aha demos.** The day-1 demo is 100% legal (Garcia lease dispute). Build a TAX
  demo over the tax sample (Client Research Note / home-office deduction) and a CONSULTING demo over the
  consulting sample (Engagement Summary), with their own cited demo answers, so a tax/consulting user's
  first cited answer is in THEIR domain. The sample matter creation + demo answers select by profession.
- **Adapt the privacy + headline copy** per vertical where it is legal-centric (matter/privilege/
  attorney-client) -> domain-appropriate (client return security / engagement confidentiality), at least
  in the most-seen spots (the data-map summary, the trust framing, the email empty state).

## Waves
- R4-1 first (Documents) — one focused effort (it reworks the tab/editor integration + the grid + the
  bug); verify (incl. the citation e2e + a live grid screenshot showing folders) + commit.
- R4-2 next (multi-vertical) — the label hook + the per-profession demos + the copy; verify by switching
  profession (legal/tax/consulting) and confirming the labels + demo adapt; commit.
- Then verify + merge to keepance-3.0, docs + memory, NOT deployed, notify.

## Verification gate (every wave)
typecheck 0 · targeted vitest then full suite · eslint clean on touched · live dev-server check
(Documents grid shows files+folders + opening a file is a tab; profession switch changes the labels +
demo; citations still survive nav; --kp-navy ok; zero errors).

## Resume note
Commits per wave on `feature/ux-round4-2026-06-14`. Master ledger: `2026-06-14-ux-program-LEDGER.md`.
