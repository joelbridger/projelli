# CODEX FIX BRIEF — Wave 3, Lane 1 (ingest+match) fix round

You are a Codex fix agent in worktree /home/jameson/lp-w3-1 (branch lp/intake-w3-1). Your build (commit 354db44a) is sound at the core, but the adversarial review found two real issues that break the feature for M365 and weaken the spoof gate. Fix both, TDD, commit on this branch. Do NOT push. One cargo compile at a time.

## Fixes (do BOTH)

### [P1] M365 Graph sync must capture the mail-auth headers — `src-tauri/src/commands/mail/graph.rs` (~777)
The Graph delta/list items do NOT include `internetMessageHeaders` unless explicitly `$select`ed or fetched, so every Microsoft 365 message is currently stored with `MailAuthResult.source = "missing"` (all `none`). Because the reply matcher quarantines missing auth, EVERY Outlook reply would be quarantined and never become a normal intake candidate — the feature is broken for the primary provider. Fix: ensure the M365 sync path obtains the authentication headers (`Authentication-Results`, `ARC-Authentication-Results`, `Received-SPF`) before storing — either add `internetMessageHeaders` to the delta/message `$select`, or fetch them per message the same way attachment refs are fetched — and parse them into `MailAuthResult` so a genuinely DMARC-passing Outlook reply yields `dmarc: pass` (not `missing`). Add a Rust test with a Graph fixture that includes passing auth headers → `MailAuthResult` reflects pass (and a fixture with no/failed headers → `none`/`fail`, never falsely `pass`).

### [P2] Sender parsing must fail closed on extra angle-address text — `src/platform/intake/emailAddressMatch.ts` `extractAddress` (~11)
Today `extractAddress` returns the first `<...>` pair and ignores the rest, so a malformed display sender like `Evil <sarah@example.com> <attacker@evil.example>` parses as `sarah@example.com` and passes `emailAddressMatch`, defeating the spoof/lookalike gate for any caller that only has the display `from` string. Fix: require EXACTLY ONE angle-address pair with no extra angle brackets or trailing address text; if there is more than one `<...>` pair (or stray `<`/`>` outside the single pair, or trailing non-whitespace after the closing `>`), return null (fail closed → no match → the matcher's lookalike/quarantine path handles it). Add tests: the multi-angle spoof string does NOT match; a normal `Name <addr>` still matches; a bare `addr` still matches.

## Optional consideration (safe as-is, note only)
`emailAddressMatch` compares the local-part case-sensitively (domain is lowercased). `Sarah@x` vs `sarah@x` won't match — a fail-CLOSED false-negative (safe; a legit reply just isn't auto-proposed). If you lowercase the local-part for comparison, keep it fail-closed elsewhere. Not required; do only if trivial and clearly safe.

## Done bar
- M365 replies with passing DMARC become normal candidates (not quarantined for missing auth). Missing/failed auth still → `none`/`fail` (never falsely pass).
- The multi-angle spoof string fails closed and cannot pass the sender gate.
- Never rename matter/matter_id. Deterministic matcher stays side-effect-free. No em dashes/time estimates.
- GREEN before done: `npx vitest run src/platform/intake`; `cargo test` for the touched mail commands (SERIAL — the `backfill_marker_set...` flake passes in isolation, not yours); `npx tsc --noEmit`; `node scripts/eslint-gate.mjs`. Commit on this branch. Do NOT push.
