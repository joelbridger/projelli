# Worker brief — Linux Playwright mirror of the Windows smoke checklist

**Lane:** cc-lantern-e2emirror · worktree `~/lp-e2emirror` · branch `lp/e2e-smoke-mirror`
**Model:** Sonnet 5 · high. Part of the Jameson-approved testing-speed program (`coordination/TESTING-SPEED-PROGRAM.md`, item 7).

## Mission
Mirror as much of the Windows bench smoke checklist (`scripts/bench-smoke/checklist.mjs` — read it first; 17+ checks across Waves 0-4) as Playwright browser tests running against the Vite dev build on THIS server. Goal: catch UI/flow regressions in minutes on Linux, so the physical/cloud Windows benches do confirmation, not discovery.

## Ground rules
- Study the existing Playwright setup first (`tests/e2e/`, playwright config, how the dev server + seeded workspace fixtures work — the full-user-test playbook `~/keepance/docs/quality/full-user-test-playbook.md` describes the drive-it-like-a-user pattern). FOLLOW the existing patterns; don't invent a parallel harness.
- ADDITIVE ONLY: new spec files + fixtures. Do not modify product source except to add missing `data-testid`s (each such edit must be a pure attribute addition — flag every one in your report).
- For each bench check, classify honestly: MIRRORED (full flow), PARTIAL (browser can cover part — say what's missing), or NOT-MIRRORABLE (needs real Windows/native/live connector — say why). Checks needing live third-party accounts (Wealthbox writes, OAuth dances) are NOT-MIRRORABLE — mock at the network boundary only if an existing mock pattern already exists; do not build new mock infrastructure this lane.
- Deliverable doc: `docs/qa/E2E-SMOKE-MIRROR.md` — the mapping table (bench check id → spec file → classification) + how to run.
- Keep the suite FAST (<5 min total) and deterministic — no sleeps, use Playwright auto-waiting.
- Gate before handoff: `npx playwright test` for your specs (all green), plus `npx tsc --noEmit` and the standard `npx vitest run` unaffected (spot-check). NO cargo (frontend only). Use timeout wrappers on long commands.
- Self-review: run one `codex-review --commit <your tip>` round per big commit; cap at ~3 rounds or 2 trivial rounds, whichever first.
- Do NOT merge; the coordinator merges (after w3 lands — expect to pull a moved tip before handoff).
- When done: print the evidence summary (mapping table + test counts + runtime), then as the very last line of your turn the done sentinel in the standard format (copy exactly): `WORKER-DONE: lp/e2e-smoke-mirror`
