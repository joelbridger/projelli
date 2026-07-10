# Lantern Intake — Wave 3 Tracker (email-native fallback)

**Wave lead:** Opus 4.8 · high. **Branch:** `lp/intake` (worktree `~/lp-intake`), off Wave-2 done tip `30f5f47a` (Wave 2 + coord-fixes merged, gate-green).
**Plan:** `W3-EXEC-PLAN.md` (12 open questions resolved in §0). **Briefs:** `briefs/w3-<lane>.md`.

## Lane status
| Lane | Slug | Worktree | Branch | Codex | Review | Adversarial | Merged SHA | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | ingest+match (Rust+TS) | `~/lp-w3-1` | `lp/intake-w3-1` | DONE-EXIT:0 | lead PASS (security core) | codex-review: 1 P1 + 1 P2 → FIXED `4dc20449` | in `f61c249f` | **MERGED** |
| 2 | proposal cards + accept | `~/lp-w3-2` | `lp/intake-w3-2` | DONE-EXIT:0 | lead PASS | codex-review: 2 P1 + 2 P2 → fixed | in `670752e2` | **MERGED** (gate-fix folded 3712a94b) |
| 3 | quarantine path | `~/lp-w3-3` | `lp/intake-w3-3` | — | — | — | — | queued — last |

## Open questions — all 12 RESOLVED in `W3-EXEC-PLAN.md` §0
Headlines: Q1 sender source = `IntakeRecord.clientEmail` (primary only; no per-member household addrs). Q3 no outbound thread/message id stored by Wave 2 → thread-tie best-effort; multi-active-request → quarantine. Q6 NO mail-auth parsing exists → Lane 1 adds `MailAuthResult` (missing→'none', never 'pass'). Q9 attachment persist via a new Rust command (no bytes to renderer). Q10 durable queues in the encrypted Intake SQLCipher store. Q11 audit action `intake_email_reply` (intent/outcome).

## Security focus (this wave)
Mis-filing attacks are THE risk: spoofed sender, look-alike/plus-alias/display-name-only address, replies vs completed/revoked intakes, untrusted email body (prompt-injection). The deterministic gate (Lane 1) runs BEFORE any AI/file write; failed/missing auth or ambiguity → quarantine (no confidence tier, no preselect, no one-click). Every `codex-review` adversarial pass MUST focus on mis-filing.

## Lane 1 review — lead verify + adversarial pass
Lead verify: vitest 90/90 (src/platform/intake), tsc clean, eslint-gate clean. Lead read the SECURITY CORE closely — sound + fail-closed: matcher runs sender-match → auth gate (missing/fail → quarantine, never candidate) → active-request → attachment-metadata → thread-tie/ambiguity → open-items; `emailAuthResult` requires DMARC pass + aligned + (DKIM or SPF pass); `emailAddressMatch` IDNA-normalizes domain + exact compare + look-alike detection. codex-review (mis-filing focus) found 2 real issues the lead missed (batched into `briefs/w3-1-fix.md`):
- **[P1] M365 Graph sync doesn't fetch `internetMessageHeaders`** → every Outlook message stored `authResult source: missing` → matcher quarantines ALL M365 replies → feature quarantine-only for the primary provider. Fix (Rust): `$select`/fetch the auth headers so DMARC-passing Outlook replies yield `dmarc: pass`.
- **[P2] sender parse trusts first `<...>`, ignores trailing** → `Evil <sarah@x> <attacker@evil>` parses as sarah → spoof-gate bypass when only display `from` available. Fix (TS): fail closed on extra angle text.
- Lead-noted (safe, optional): local-part compared case-sensitively → fail-closed false-negative.

## Lane 2 (proposal cards) — lead verify + notes
Lead verify PASS: vitest 136/136 (src/features/intake + src/platform/intake), tsc clean, eslint-gate clean. Accept path (`emailReplyAccept.ts`) is correct — audit INTENT first (`mustLog...` refuses on failure), code-owned destination `emailReplyAttachmentDestination(messageId)` (model chooses nothing), restricted rows gated by explicit approval. Ingestion wired (`useEmailReplyIngestion` + App.tsx + AppSurfaceRouter — not left hollow). Board/tab surfacing wired via OnboardingBoardContainer.
- **The `infra/intake/headers.mjs` "orphan" is RESOLVED:** Lane 2's Codex committed a `OWNED_HEADER_NAMES` improvement to the third-party-origin scanner (scope creep — unrelated to proposal cards, but a correct self-contained security fix reducing CDN-header false-positives) AND leaked the same edit uncommitted into the MAIN worktree (stash@{0}). Decision: KEEP Lane 2's committed version (correct); DROP the redundant main-worktree stash after merge. Provenance = danger-full-access Codex writing outside its --cd worktree.
- **The 3 modified existing tests are BENIGN:** `email-privilege-control.test.tsx`, `EmailViewer.audit.test.tsx`, `EmailViewer.test.tsx` only removed now-optional `authResult`/`threadId`/`attachmentsUnsupported` field-setters from `sampleMessage` FIXTURES (no `expect` assertions weakened).
- codex-review found 4 real issues (batched → `briefs/w3-2-fix.md`, fix round running):
  - **[P1] audit intent gate didn't block** — `App.tsx` registered a VOID emitter → `mustLogIntakeEmailReplyAudit` awaited `undefined` → files/facts could write before the intent row persisted (audit outage still files). Core compliance guarantee broken. Fix: promise-returning emitter, truly await, refuse on failure.
  - **[P1] partial-retry not idempotent** — one row succeeds + one fails → retry reprocesses ALL → attachment persisted twice (unique filename), fact re-superseded. Fix: durable per-row completion, skip done rows on retry.
  - **[P2] unfileable body rows selectable** → dead un-clearable proposal (no dismiss). Fix: non-selectable/manual + add dismiss.
  - **[P2] classifier model path unreachable in prod** (`useEmailReplyIngestion` never passes modelConfidence). Fix: wire the provider (untrusted body sanitized; model chooses no id/path).
  - The adversarial pass again caught what the lead diff-read missed (esp. the void-emitter defeating `mustLog`). cargo runs at merge gate.
- **Fix round 1 (`bf3ce399`):** P1-A ✅ (App.tsx now registers `addAuditEntry` promise via `setIntakeEmailReplyAuditEmitter`; `mustLog` awaits + throws if unregistered — verified by lead), P1-B ✅ (durable per-row completion, retry skips done rows), P2-C ✅ (dismiss + non-selectable unfilable rows). BUT introduced a RED eslint gate: **[P1 privacy] `lantern-egress/no-direct-provider-send`** — the P2-D classifier model call bypassed the egress-audit wrapper (must go through `sendWithEgressAudit`) — plus test-file type-safety lint. → **Fix round 2 running** (`briefs/w3-2-fix2.md`): route the classifier through `sendWithEgressAudit`, fix lint properly (no baseline update).

## Gate-fix (Lane 2) — pre-push full-vitest caught 2 real failures scoped tests missed (worktree ~/lp-w3-gf, branch lp/intake-w3-gatefix)
The pre-push hook runs the FULL suite (not just src/*/intake), which caught:
- **architecture-boundaries**: `platform/intake/useEmailReplyIngestion.ts -> @/features/email/resolveEmailProvider` = platform importing a feature (forbidden upward import). Fix: remove the static import; inject the resolver from the app-layer mount site `AppSurfaceRouter.tsx`.
- **i18n kebab-case + inventory**: `intake.emailReply` namespace is camelCase (violates the kebab rule — MY BRIEF'S fault). Fix: rename `emailReply`→`email-reply` across en/de/es + the 4 EmailReply* code files + the en-json-snapshot inventory.
- `addepar-connect-audit.test.tsx` "chunk load failed" = known concurrent load flake (passes 2/2 in isolation) — NOT intake.
Gate-fix dispatched (`w3-gf-prompt.txt`). After green: merge to lp/intake, push (hook re-runs full vitest), LANE-MERGED, then Lane 3.

## NOTE — coordinator commits to lp/intake in PARALLEL (bench-preflight)
The coordinator (as Jameson) lands bench-preflight fixes directly on lp/intake while this session works: `7040e768` (headers.mjs third-party-origin scan scoped to app-owned headers — my earlier "orphan" was THIS, correctly surfaced), `df4fe8d7` (mail test fixtures aligned to the new MailView/MailAttachmentRef shape), `a395098f` (changelog). **Re-check `git rev-parse HEAD` before operations — the main worktree HEAD can move under you.** All linear, no conflicts; my Lane 2 merge (6b5e5d09) is intact under them.

## Lanes 2 & 3 — briefs to write (scoped in W3-EXEC-PLAN §3)
- Lane 2 (`briefs/w3-2-proposal-cards.md`): proposal card/row/modal, accept path (audit intent → file via the new persist command / fact via `intakeFactUpsert(channel:'email_reply')` → checklist tick → outcome; partial-failure), durable proposal queue in SQLCipher, masked restricted previews, confidence tiers from auth, reuse `CrmWriteReviewCard`/`crmWriteQueueStore`.
- Lane 3 (`briefs/w3-3-quarantine.md`): `emailQuarantinePolicy` (triggers as tests) + durable `emailQuarantineStore` + quarantine card/panel in the Onboarding tab + board count signal; no accept-all/preselect/one-click; manual-file writes `channel:'email_reply'` + advisor-confirmed provenance + audit.

## Ritual (same as Wave 2) + landmines
Per lane: Codex build (prompt-from-file, `^DONE-EXIT:[0-9]+$`-anchored Monitor) → lead diff review + ONE `codex-review --base lp/intake` (mis-filing focus) → batch findings → one fix round → `merge --no-ff` → gate (serialize Lane 1 cargo) → push → `LANE-MERGED`. Gate-fix round after Lane 3. Landmines: one cargo at a time; fresh worktrees need sidecar binaries (`cp -a ~/lp-ux-integrate/src-tauri/binaries/. <wt>/src-tauri/binaries/`) + node_modules symlinks; known baseline flake `commands::mail::tests::backfill_marker_set_is_idempotent_and_clearable` (passes in isolation); anchor monitor sentinels ([[project-monitor-anchor-done-sentinel]]).

## Log
- **2026-07-10:** Wave 2 fully done (+ coordinator final-pass fixes, merged `30f5f47a`). Wave 3 kicked off: pulled `W3-PREP.md` from backup tag `4c133cd8`; resolved all 12 open questions from shipped Wave 1/2 code; wrote `W3-EXEC-PLAN.md` + Lane 1 brief; created `~/lp-w3-1` (binaries + node_modules) and **dispatched Lane 1** (Codex). Docs pushed (`lp/intake` @ `8fac6c98`). Handing off the 3-lane execution to a fresh session (context high; a fresh session reviews the security-critical Lane 1 with fresh eyes). Lane 1 building under Codex; monitor armed.
