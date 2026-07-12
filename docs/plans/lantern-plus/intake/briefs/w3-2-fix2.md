# CODEX FIX BRIEF — Wave 3, Lane 2 fix round 2 (egress guard + lint)

You are a Codex fix agent in worktree /home/jameson/lp-w3-2 (branch lp/intake-w3-2). The prior fix (bf3ce399) correctly fixed the audit-blocks + retry-idempotency + dismiss issues, but the ESLint gate is RED with a real privacy-guard violation plus lint noise from the new code. Fix all of it (the gate must pass WITHOUT a baseline update). TDD, commit on this branch. Do NOT push.

## Fixes

### [P1 — privacy guard] Route the classifier's model call through the egress-audit wrapper — `src/platform/intake/useEmailReplyIngestion.ts`
ESLint `lantern-egress/no-direct-provider-send` fires because the new model-confidence classification calls the provider DIRECTLY. Every provider AI call on client-adjacent content MUST go through `sendWithEgressAudit(...)` / `runWithEgressAudit(...)` (`src/platform/privacy/sendWithEgressAudit.ts`) so the privacy/confidentiality checks + egress audit receipts cannot be skipped — this is a hard privacy invariant, not a lint nit. Wrap the classifier's provider call in the egress-audited path (mirror how `followUpDraft`/the nudge "draft in my voice" model call is wrapped). The email body remains UNTRUSTED (already sanitized before the prompt); the model still returns only a confidence label and chooses no identifier/path. Keep the no-provider fallback (deterministic confidence). Do NOT suppress the rule with an eslint-disable — actually route through the wrapper.

### [lint] Fix the remaining new ESLint findings properly (no baseline update)
- `src/platform/intake/useEmailReplyIngestion.ts`: `no-unnecessary-condition` (a `??` whose left side is never null) — remove the dead condition or correct the type.
- `src/platform/intake/emailReplyAccept.test.ts`: `no-unsafe-return`, `no-unsafe-member-access .completion` — give the test values proper types (no `any`).
- `src/platform/intake/emailReplyClassifier.test.ts`: `no-non-null-assertion` — assert/narrow instead of `!`.
- `src/platform/intake/useEmailReplyIngestion.test.ts`: `no-unsafe-assignment` (array destructuring of `any`) — type the destructured value.
Do NOT run `--update-baseline`; fix the code so `node scripts/eslint-gate.mjs` passes on its own.

## Done bar
- `node scripts/eslint-gate.mjs` passes with NO new findings and NO baseline update. The classifier model call is egress-audited (privacy receipts cannot be skipped). Untrusted body still sanitized; model chooses no id/path.
- No behavior regression: `npx vitest run src/features/intake src/platform/intake` still green; `npx tsc --noEmit` clean; `cargo test` for touched intake commands still green (SERIAL). Commit on this branch. Do NOT push.
