# Worker brief — Cold-boot confirmation run (close the scorecard's honesty notes)

**Lane:** cc-lantern-benchconfirm · worktree `~/lp-bench` (permanently on `lp/windows-smoke-evidence`)
**Model:** Sonnet 5 · high. You own the Legion for this lane.

## Context
The finish-line pass ended 11 PASS / 0 FAIL / 3 SETUP-BLOCKED / 5 stubs (RUN-LOG.md tail on your branch — read the 2026-07-04 sections FIRST). All harness fixes from those rounds are MERGED (tip c30e8039+). Two honesty notes remain: wave0-draft-followup flaked once from manual-test residue, and wave2-wealthbox-approve-live has a review-card-disappears sequencing mystery (time-boxed notes in RUN-LOG). index-health and wave2-queue-review blocked only on the now-fixed navigation gaps.

## Mission
ONE clean cold-boot full-suite run to convert the blocked/flaky checks into honest PASSes (or precise findings):
1. **Cold boot the Legion** (real restart — this is the point: no residue, no leftover modals, no manual-test state). It's Tailscale `james@100.127.67.22`; the app runs via the `LanternPlusDev` scheduled task (currently Disabled — enable, start; return to Disabled at the end).
2. Pull `C:\lantern-plus` to the current origin/lantern-plus tip; FULL rebuild (Rust changed since the last bench build — the pathguard Windows fix); freshness canary before any verdict (a pathguard-fix string works).
3. Run the FULL suite: `node scripts/bench-smoke.mjs --target legion --live` from the server repo (harness at merged tip — includes ensureClientsTableTab + all fixes).
4. For wave2-wealthbox-approve-live specifically: if it blocks/fails again, capture the forensics bundle + note the exact card lifecycle timing (the harness now auto-collects on FAIL) — a precise repro record is a valid outcome; do NOT spend more than ~20 extra minutes chasing it.
5. Commit evidence + a dated FINAL-CONFIRMATION section to RUN-LOG.md on `lp/windows-smoke-evidence`; push. Report the scorecard.
6. Leave the bench as found (app stopped, task Disabled, tunnels closed). No product-code changes from this lane; harness fixes (if any are needed) go on a new branch for coordinator review.

Timeout-wrap everything. Report at: cold-boot done / canary / scorecard / bench quiesced. Last line exactly: `WORKER-DONE: benchconfirm`
