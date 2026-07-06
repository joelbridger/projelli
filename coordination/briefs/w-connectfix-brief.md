# Worker brief — connect-flow demo hardening (4 scoped fixes, steps 1-2)

You are **cc-lantern-connectfix**, worktree **~/lp-connectfix**, branch **lp/connect-demo-hardening** (off tip 381462f3). Frontend-leaning lane. You do NOT merge; the coordinator merges.

## Context
Adversarial review of the demo's connect steps (full log: `/tmp/claude-1000/-home-jameson-lantern-plus/cbf813e9-0636-4dab-94c6-c1621a39686c/scratchpad/codex-connect.log`, last ~9KB). Verify each finding against code, then fix these FOUR (the other two findings are out of scope — do not touch OneDrive disconnect ordering or the Outlook cancel race):

1. **Wealthbox connect/sync can look frozen** — `src/platform/connectors/crm/WealthboxConnect.tsx:86` has no front-end timeout; backend retries rate limits a long time (`src-tauri/src/commands/crm/client.rs:146`). Fix (frontend only): after ~20s of Connecting/Syncing with no progress, show "Wealthbox is taking longer than usual — still trying…"; ensure a Stop/Cancel affordance is visible during sync; a clear failure state if the first household list call exceeds a sane timeout.
2. **429 treated as valid key** — `src/platform/providers/apiKeyValidation.ts:251` accepts HTTP 429 as success. Fix: 429 becomes a distinct warning state ("This key is real, but the account is over its limit right now") — not fully verified, not an invalid-key error.
3. **Bad key never marked invalid** — on 401/403 from Ask/chat, call `markKeyInvalid(provider)` (helper exists: `src/platform/providers/keyVerification.ts:54`); on success, `markKeyVerified(provider)`. Wire it where Ask surfaces provider auth errors (`src/features/ask/useAsk.ts:1252` area).
4. **Expired Microsoft sign-in shows engineer-speak** — map `invalid_grant` / `scope_upgrade_required` / `refresh failed` / `not connected` (surfaced via `MailConnect.tsx:192`, `OneDriveConnect.tsx:389`, from `graph.rs:113`) to one plain message: "Your Microsoft sign-in expired. Click Reconnect." with the Reconnect action next to it. Frontend mapping is fine; don't rewrite Rust error strings unless trivial.

## Method
TDD (Vitest) per fix: slow-connect shows the waiting message; 429 → warning state not success; 401 marks key invalid; error-string mapping renders the plain message. Scoped diffs only; match existing patterns (OneDriveConnect already has good timeout UX — reuse its approach). i18n per neighboring strings. No `matter_id`/`Matter` renames.

## Done criteria (HARD)
1. Tests red→green with real output; `npx tsc --noEmit` green; scoped `npx vitest run` green.
2. Committed AND pushed (`git push -u origin lp/connect-demo-hardening`; `--no-verify` only for unrelated pre-push failures — say so).
3. THEN print exactly: `WORKER-DONE: lp/connect-demo-hardening` + 4-line summary (one per fix).
