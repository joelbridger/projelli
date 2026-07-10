# Lantern Intake — Wave 3 Tracker (email-native fallback)

**Wave lead:** Opus 4.8 · high. **Branch:** `lp/intake` (worktree `~/lp-intake`), off Wave-2 done tip `30f5f47a` (Wave 2 + coord-fixes merged, gate-green).
**Plan:** `W3-EXEC-PLAN.md` (12 open questions resolved in §0). **Briefs:** `briefs/w3-<lane>.md`.

## Lane status
| Lane | Slug | Worktree | Branch | Codex | Review | Adversarial | Merged SHA | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | ingest+match (Rust+TS) | `~/lp-w3-1` | `lp/intake-w3-1` | DONE-EXIT:0 | lead PASS (security core sound) | codex-review: 1 P1 + 1 P2 | `354db44a` (pre-fix) | FIX ROUND running (`briefs/w3-1-fix.md`) |
| 2 | proposal cards + accept | `~/lp-w3-2` | `lp/intake-w3-2` | — | — | — | — | queued (brief TO WRITE) — after Lane 1 |
| 3 | quarantine path | `~/lp-w3-3` | `lp/intake-w3-3` | — | — | — | — | queued (brief TO WRITE) — last |

## Open questions — all 12 RESOLVED in `W3-EXEC-PLAN.md` §0
Headlines: Q1 sender source = `IntakeRecord.clientEmail` (primary only; no per-member household addrs). Q3 no outbound thread/message id stored by Wave 2 → thread-tie best-effort; multi-active-request → quarantine. Q6 NO mail-auth parsing exists → Lane 1 adds `MailAuthResult` (missing→'none', never 'pass'). Q9 attachment persist via a new Rust command (no bytes to renderer). Q10 durable queues in the encrypted Intake SQLCipher store. Q11 audit action `intake_email_reply` (intent/outcome).

## Security focus (this wave)
Mis-filing attacks are THE risk: spoofed sender, look-alike/plus-alias/display-name-only address, replies vs completed/revoked intakes, untrusted email body (prompt-injection). The deterministic gate (Lane 1) runs BEFORE any AI/file write; failed/missing auth or ambiguity → quarantine (no confidence tier, no preselect, no one-click). Every `codex-review` adversarial pass MUST focus on mis-filing.

## Lane 1 review — lead verify + adversarial pass
Lead verify: vitest 90/90 (src/platform/intake), tsc clean, eslint-gate clean. Lead read the SECURITY CORE closely — sound + fail-closed: matcher runs sender-match → auth gate (missing/fail → quarantine, never candidate) → active-request → attachment-metadata → thread-tie/ambiguity → open-items; `emailAuthResult` requires DMARC pass + aligned + (DKIM or SPF pass); `emailAddressMatch` IDNA-normalizes domain + exact compare + look-alike detection. codex-review (mis-filing focus) found 2 real issues the lead missed (batched into `briefs/w3-1-fix.md`):
- **[P1] M365 Graph sync doesn't fetch `internetMessageHeaders`** → every Outlook message stored `authResult source: missing` → matcher quarantines ALL M365 replies → feature quarantine-only for the primary provider. Fix (Rust): `$select`/fetch the auth headers so DMARC-passing Outlook replies yield `dmarc: pass`.
- **[P2] sender parse trusts first `<...>`, ignores trailing** → `Evil <sarah@x> <attacker@evil>` parses as sarah → spoof-gate bypass when only display `from` available. Fix (TS): fail closed on extra angle text.
- Lead-noted (safe, optional): local-part compared case-sensitively → fail-closed false-negative.

## Lanes 2 & 3 — briefs to write (scoped in W3-EXEC-PLAN §3)
- Lane 2 (`briefs/w3-2-proposal-cards.md`): proposal card/row/modal, accept path (audit intent → file via the new persist command / fact via `intakeFactUpsert(channel:'email_reply')` → checklist tick → outcome; partial-failure), durable proposal queue in SQLCipher, masked restricted previews, confidence tiers from auth, reuse `CrmWriteReviewCard`/`crmWriteQueueStore`.
- Lane 3 (`briefs/w3-3-quarantine.md`): `emailQuarantinePolicy` (triggers as tests) + durable `emailQuarantineStore` + quarantine card/panel in the Onboarding tab + board count signal; no accept-all/preselect/one-click; manual-file writes `channel:'email_reply'` + advisor-confirmed provenance + audit.

## Ritual (same as Wave 2) + landmines
Per lane: Codex build (prompt-from-file, `^DONE-EXIT:[0-9]+$`-anchored Monitor) → lead diff review + ONE `codex-review --base lp/intake` (mis-filing focus) → batch findings → one fix round → `merge --no-ff` → gate (serialize Lane 1 cargo) → push → `LANE-MERGED`. Gate-fix round after Lane 3. Landmines: one cargo at a time; fresh worktrees need sidecar binaries (`cp -a ~/lp-ux-integrate/src-tauri/binaries/. <wt>/src-tauri/binaries/`) + node_modules symlinks; known baseline flake `commands::mail::tests::backfill_marker_set_is_idempotent_and_clearable` (passes in isolation); anchor monitor sentinels ([[project-monitor-anchor-done-sentinel]]).

## Log
- **2026-07-10:** Wave 2 fully done (+ coordinator final-pass fixes, merged `30f5f47a`). Wave 3 kicked off: pulled `W3-PREP.md` from backup tag `4c133cd8`; resolved all 12 open questions from shipped Wave 1/2 code; wrote `W3-EXEC-PLAN.md` + Lane 1 brief; created `~/lp-w3-1` (binaries + node_modules) and **dispatched Lane 1** (Codex). Docs pushed (`lp/intake` @ `8fac6c98`). Handing off the 3-lane execution to a fresh session (context high; a fresh session reviews the security-critical Lane 1 with fresh eyes). Lane 1 building under Codex; monitor armed.
