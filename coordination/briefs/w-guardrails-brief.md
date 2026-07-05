# Build brief — GUARDRAILS: make the recurring bug classes un-writable (from the whole-system assessment)

**Lane:** cc-lantern-guardrails · dir `~/lp-guardrails` (own worktree, branch `lp/guardrails`). **Model:** Sonnet 5 · high.
**Context:** `docs/strategy/2026-07-05-development-process-assessment.md` — Jameson approved acting. This lane turns two treadmill bug classes + a process leak into *enforced gates* so they stop being writable. NOT product features — build tooling / lint / gate scripts only. TDD where testable. Codex self-review foreground/watched. PULL + reconcile before handoff.

## Item 1 — ESLint rule: no silently-swallowed failures on user-facing paths
The #1 recurring bug class today (QA-19/40/41/34/43 + 8 from the static sweep): empty/near-empty catch blocks and fire-and-forget promises that turn a failure into a silent wrong/stuck state.
- Add a custom ESLint rule (in the repo's existing eslint plugin dir — see how `lantern-i18n/no-hardcoded-string` is implemented) named e.g. `lantern-async/no-silent-failure`: flags (a) `catch` blocks that are empty or only contain a bare `return`/comment with no logging, error-state set, or re-throw; (b) `.catch(() => {})` / `.catch(() => true/false/null)` swallows; (c) floating promises in effects/handlers (`void somePromise()` without a `.catch`). Scope it to `src/features/**` and `src/platform/**` (user-facing).
- Wire it into `scripts/eslint-gate.mjs` with a BASELINE (like the existing baseline pattern) — existing violations are grandfathered so we don't block on the ~dozens already there; NEW violations fail the gate. This is the key: it stops the class from GROWING while we burn down the baseline via the swallow fix-lanes.
- Document the escape hatch (an explicit `// eslint-disable-next-line lantern-async/no-silent-failure -- <reason>` for genuine best-effort cases) so it's honest, not gamed.

## Item 2 — i18n locale-COMPLETENESS gate (process leak: de/es silently fall back to English)
Today Tier B shipped an English-only dialog that `i18n:check` passed because it only verifies keys-used-exist-in-en, NOT that de/es have every key. This is a recurring miss.
- Add a check (extend `npm run i18n:check` or a sibling script) that asserts `de.json` and `es.json` contain EVERY key present in `en.json` (structural parity), failing with the exact missing key paths. Grandfather nothing that's genuinely intentional-English via an explicit allowlist file if one is needed, but default to "all keys in all locales."
- This directly prevents the "new feature ships English-only for non-English users" class.

## Gate + handoff
tsc · typecheck:tests 0 · i18n:check 0 (+ your new completeness check green — you may need to add the currently-missing de/es keys the check surfaces, OR scope the check to fail-on-NEW-only via a baseline if the existing gap is large; state which) · full vitest · eslint-gate green (with the new rule + baseline). Handoff: the rule's baseline count, the completeness-check result (how many keys were missing), how NEW violations are caught, self-review rounds. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/guardrails`

## Landmines
Do NOT touch product feature code (this is tooling); if the completeness check surfaces a huge existing gap, baseline-and-fail-on-new rather than blocking. Don't touch the en-json snapshot count test (coordinator owns a separate self-derive change there). No interactive menus.
