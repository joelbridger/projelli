# CODEX BUILD BRIEF — Lantern Intake Wave 3, Lane 1: Ingest + Match (Rust mail-rail + TS matcher)

You are a Codex build agent in worktree /home/jameson/lp-w3-1 (branch lp/intake-w3-1). This is the ONLY Rust lane in Wave 3 and the blocker other lanes wait on. Build the scope below, TDD, commit on your branch. Do NOT push. **Run at most ONE cargo compile at a time** (the box serializes cargo on a shared target dir; a blocked job self-aborts). Build/test Rust deliberately, not in parallel with other cargo.

## Context to read first
- `docs/plans/lantern-plus/intake/W3-EXEC-PLAN.md` §0 (resolved questions — READ), §1 (non-negotiables), §2, §4.
- `docs/plans/lantern-plus/intake/W3-PREP.md` "Lane 1: Ingest And Match" + "Deterministic Matching Acceptance Criteria" (these are your tests, verbatim).
- **Real mail rails (read before editing):** `src-tauri/src/commands/mail/{store.rs,sync.rs,model.rs,normalize.rs,messages.rs}`, `src-tauri/src/commands/mail/gmail/normalize.rs`, `src-tauri/src/commands/mail/imap/normalize.rs`, `src/platform/utils/mail-commands.ts`. NOTE: there is currently NO dkim/dmarc/spf/Authentication-Results parsing anywhere; `MailView::from_markdown()` returns `attachments: Vec::new()`; `mail_get_attachment` fetches Graph+Gmail bytes on demand, IMAP unsupported.
- **Consume:** `src/platform/intake/intakeStore.ts` (`IntakeRecord.clientEmail`, items/state/status), `src/platform/intake/types.ts` (`FactKind`, `RequestItem`, provenance). The matcher reads intake state; it does NOT write anything.

## Scope A — Rust mail-rail additions (auth + attachments)
1. **`MailAuthResult`** (provider-neutral): `{ dkim: pass|fail|none, spf: pass|fail|none, dmarc: pass|fail|none, aligned: bool, source: graph|gmail|imap|missing }`. Add to `model.rs` (+ a durable column/field in `store.rs` `EncryptedMailStore` metadata, and surface in `MailView` via `messages.rs`). Missing/unparseable auth → all `none`.
   - `gmail/normalize.rs`: parse `Authentication-Results`, `ARC-Authentication-Results`, `Received-SPF` from the Gmail full-message headers JSON.
   - `imap/normalize.rs`: parse the equivalent headers from raw RFC822 where present; **record missing as `none`, never `pass`**.
   - Graph: parse from the message headers Graph exposes; if unavailable, `none`.
2. **Durable attachment refs** (M365 + Gmail): persist at sync time (`sync.rs`/`normalize.rs`) an attachment manifest per message — `{ id, filename (display), content_type (when known), byte_size (when known), kind }` — and surface it in `MailView` (replace the always-empty `attachments`). IMAP: leave attachments unsupported (empty + a flag).
3. **`thread_id` surfaced**: `MailMessage` already carries `thread_id`; expose it through `MailRecord`/`MailView`/TS `MailView` (the matcher needs it for best-effort thread ranking).
4. **New attachment-persist command**: a Tauri command that fetches ONE provider attachment and writes it into the workspace via the same path-validation standard (like `WorkspaceService.writeFileBinary`) WITHOUT returning bytes to the renderer. Register it in `lib.rs`; add the TS wrapper in `mail-commands.ts`. (Lane 2 calls this on accept; you build the command + a Rust test that it writes a sanitized, uniquified file and refuses traversal.)
5. Mirror all new fields in the TS types in `mail-commands.ts`.

## Scope B — TS deterministic matcher (pure, no AI, no writes)
New files under `src/platform/intake/`:
- `emailAddressMatch.ts`: normalize by trim + lowercase + IDNA-normalize the domain; compare exact local-part (do NOT strip dots/hyphens/plus tags unless the exact alias is the saved address); reject malformed addresses. Use only the parsed address, never the display name.
- `emailAuthResult.ts`: map a `MailAuthResult` → `authenticated: boolean` (DMARC pass AND aligned DKIM/SPF) vs `quarantine`.
- `emailReplyTypes.ts`: the matcher output contract (the cross-lane type) — `EmailReplyCandidate` (message id/provider/account/received, sender, authResult, threadId, matchedMatterId, matchedRequestId, targetOpenItemIds, confidenceEligible, attachments) and `EmailReplyQuarantine` (message ref + `reason: 'auth_failed'|'lookalike'|'ambiguous_sender'|'ambiguous_request'|'inactive_request'|'accepted_item_update'|'attachment_metadata_missing'`).
- `emailReplyMatcher.ts`: the pure function `matchEmailReply(mail, intakeState, now) → { kind:'candidate', ... } | { kind:'quarantine', reason } | { kind:'ignore' }`. Implement EXACTLY the W3-PREP rules: sender match against `clientEmail` only; auth gate (fail/missing → quarantine); active-request rules (no active → ignore; one active + open items → candidate; completed/revoked/expired → no normal proposal; >1 active for a client → quarantine ambiguous); thread ranking best-effort (no stored outbound id → cold messages allowed only when exactly one active request, else quarantine); open-items-only (accepted item → "possible update", unchecked). **Never asks an AI provider** — deterministic only.
- `emailThreadMatch.ts` (thread-id compare helper).

## Tests (this lane)
- **Vitest (TS):** every bullet in W3-PREP "Deterministic Matching Acceptance Criteria" (Sender identity, Sender authenticity, Active request, Thread preference, Open items only) as explicit cases. Plus: display-name-only never matches; plus-alias/look-alike never match; IDN/malformed handling; spoofed `from_addr` with failing auth → quarantine, never candidate.
- **`cargo test` (Rust, SERIAL):** `MailAuthResult` parsing from Gmail/Graph fixtures (pass/fail/missing → correct enum; missing never becomes pass); attachment manifest from a 2-attachment fixture → 2 stable refs; the attachment-persist command writes a sanitized/uniquified file, refuses `../` traversal, does not overwrite. (The baseline flake `commands::mail::tests::backfill_marker_set_is_idempotent_and_clearable` may appear under parallel cargo — re-run in isolation.)

## Constraints
- The matcher is deterministic and side-effect-free (no writes, no AI, no network). Email body is untrusted — the matcher does not read body content for identity/path decisions.
- Never rename `matter`/`matter_id`. Strict TS, `@/` alias, Zustand idiom; Rust matches the existing mail-rail + CRM-store style. No em dashes/time estimates in any copy.
- Before done: `npx vitest run src/platform/intake` green; `cargo test` for the touched mail commands green (SERIAL); `npx tsc --noEmit` clean; `node scripts/eslint-gate.mjs` clean. Commit on your branch. Do NOT push.
