# URGENT P0 fix — QA-60: Windows case-collision breaks app boot (blank screen)

**Lane:** cc-lantern-qa60 · dir `~/lp-qa60` (own worktree, branch `lp/qa60-case-fix`). **Model:** Sonnet 5 · high. **URGENT — the current tip is broken on Windows.**
**The bug (proven live on bench-2, hunt2):** `src/features/meetings/MeetingNoteOutboundGate.tsx` (component) and `src/features/meetings/meetingNoteOutboundGate.ts` (logic) differ ONLY by first-letter case. On Windows' case-insensitive filesystem, an extensionless import of `./meetingNoteOutboundGate` can resolve to the .tsx component instead of the .ts logic → runtime crash → BLANK SCREEN on boot. Coexists fine on Linux/CI (case-sensitive), which is why it shipped. (Also present: useMeetingNoteOutboundGate.ts — check it doesn't add a third collision.)
**Rules:** NO-SHORTCUTS. This must actually fix boot on Windows. TDD/verify. Codex self-review. 🔒 DONE MEANS PUSHED.

## The fix
Rename to eliminate the case-only difference (keep the PascalCase component convention; rename the LOGIC file to a name that doesn't case-collide with the component — e.g. `meetingNoteOutboundGate.ts` → `outboundNoteGate.ts` or fold its exports so the module names are unambiguous). Update EVERY import across the codebase (grep for both spellings + extensionless). Make all imports use unambiguous names/paths that resolve identically on case-insensitive AND case-sensitive filesystems.
- Add a guard so this class can't recur: a small check (script or test) that fails if any two source files differ only by case (a `git ls-files | ... case-fold dupes` check) — wire it into the gate. (This is the same "make the class un-writable" principle as the guardrails lane; coordinate — if guardrails is a better home, note it, but ship the rename regardless.)

## Verify (critical — this bug only shows on Windows)
Local: tsc + full vitest + eslint + build succeeds, no dangling imports. Then FLAG in the handoff that a Windows boot re-verify is REQUIRED — the coordinator will run it on a bench/the Legion (the fix is worthless if it still blank-screens on Windows).

## Gate + handoff
tsc · typecheck:tests 0 · i18n 0 · full vitest · eslint-gate · Rust untouched. Handoff: what was renamed, import count updated, the case-dupe guard added, "needs Windows boot re-verify". Push (NOT self-merged), then exactly: `WORKER-DONE: lp/qa60-case-fix`

## Landmines
Do NOT rename matter_id/Matter or locked identifiers. Coordinate the outbound-gate files with recently-merged Tier B (these ARE Tier B's files). No interactive menus.
