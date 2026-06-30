# Advisor Prep Hero — First-Time-User UX Review, ROUND 2 (2026-06-14)

Second full review, on the Round-1-improved build. Two reviewer lenses landed (first-run/returning-user
+ strategic); two (core-workflows, a11y/responsive) were cut for time and folded into a self-driven
polish pass. Findings validated against live app + code before planning. Branch:
`feature/ux-fixes-round2-2026-06-14`. NOT deployed.

## The headline: Round 1's flagship aha is silently broken on any returning view
Both reviewers converged on it, and the code confirms it:
- `ReimaginedAsk.reconstructTurns` (line 152-154) rebuilds a conversation from stored messages but sets
  `citations: []` and STRIPS the `{n}` chip markers, because **citations are never persisted with the
  message**. So a fresh demo answer has clickable cited chips, but the instant you navigate away and back
  (or reload), the chips vanish and the contradictory line "No indexed sources were cited" (line 1233)
  appears right under "Answered over your own files." The click-to-verify differentiator — the whole point —
  becomes invisible. This affects ALL answers, but it guts the demo aha specifically.

---

## Prioritized plan

### WAVE R2-A — Fix the broken aha (CRITICAL)
- **A1. Persist citations with messages.** Add optional `citations` (and `sources`) to the aiChatStore
  message; include them when adding the assistant answer (both the real path ~line 643 and the demo path
  line 564); `reconstructTurns` restores them and keeps the `{n}` markers when citations are present (falls
  back to stripping for old messages). Restores chips + source panel on reload/navigation, for demo AND real.
- **A2. Kill the "Answered over your own files" / "No indexed sources" contradiction.** Once A1 lands, the
  reconstructed demo turn has citations so the false line won't show. Also make the demo trust line honest
  (it cites real sample files, so "Answered over your own files" is fine once chips render; ensure the
  no-sources note never co-occurs with a citation).
- **A3. Land new users on the demo CHIP state, not a restored last answer.** On the sample matter with no
  in-progress turns, show the chip empty state first (the aha must be the first thing seen). Don't restore
  a pre-answered "What is the fee arrangement?" the user never asked.
- **A4. Graceful off-script handling on the sample.** Sample matter + no cloud key + a question that is NOT
  a demo question must show a calm inline message ("That question is outside the sample. Connect an AI in
  Settings to ask your own files, or try an example below.") and STOP — never fall through to a failing
  provider call (the source of the baffling stray "Workflow Questions" modal a curious user hit).

### WAVE R2-B — Sample clarity + the bridge to real files
- **B1. Badge the sample matter** ("Sample" pill) in `ReimaginedMattersHome` MatterRow and MatterManagerDialog
  (read `matter.isSample`); make deleting it a clear, confirmed action ("removes the sample; demo questions
  stop working").
- **B2. Bridge from demo to production.** After a demo answer (and on the sample Ask), a dismissible callout:
  "That was sample data. Add your first real matter to search your own files." -> opens the matter creator.
  Closes the biggest gap between "demo aha" and "real adoption."
- **B3. Second demo answer cites a SECOND file.** All three demo answers cite only "Sample - Matter
  Overview.md"; "Sample - Weekly Review.md" is unused. Add/swap one demo Q that cites the Weekly Review, to
  prove "across ALL your files," the actual value prop.
- **B4. Make the matter launchpad quick-actions visible.** Ask/Documents/Email are hover-only (invisible at
  rest); show them at reduced opacity (full on hover) so the launchpad is discoverable.
- **B5. Reconcile the Done CTA.** "Create your first matter" actually lands in the sample Ask; rely on B2's
  bridge for the real-matter path and make the label/destination honest.

### WAVE R2-C — Returning-user payoff + polish
- **C1. Per-matter answer history (the "second wow").** When Search opens on a matter, show "Recent in this
  matter" (prior Q&As) so returning feels purposeful and the product visibly remembers. Infra exists
  (aiChatStore keyed by chat id).
- **C2. Profession-aware sample copy.** The Done toggle says "sample legal matters" even for tax/consulting;
  use the profession label.
- **C3. Skip-setup lands on Matters** (empty state + Get-started card) instead of a blank last-tab.
- **C4. Fresh-on-navigate.** Returning to Search shouldn't show a stale prior answer the user didn't type
  (related to A3); start fresh or show history, not the raw last answer.
- **C5. Self-driven a11y / responsive / states pass** (covering the two cut lenses): keyboard reachability
  of the launchpad + nav, focus visibility, narrow-width (1100/960) integrity of the bars + surfaces,
  graceful loading/error/empty states, contrast on muted chips. Fix what's cheap; log the rest.
- **C6. File-trust moment** (strategic): when a user adds their first real file to a matter, a one-time
  "Indexed locally. Nothing was uploaded." confirmation. (May defer if it needs deep Documents wiring.)

## Verification gate (every wave)
typecheck 0 · targeted vitest then full suite at boundaries · eslint clean on touched files · live
dev-server check (the demo aha shows chips AFTER navigating away and back; `--kp-navy` ok; zero page errors).

## Deferred (unchanged from Round 1, still need Jameson's greenlight)
Full matter hub (S1), persistent Documents split (C4-r1), unified Ask (C6-r1), action-placement (C2-r1),
Isolated-matter celebration (S3) — see `2026-06-14-matter-spine-future.md`.
