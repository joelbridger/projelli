# Lantern Intake — Wave 2 Tracker

**Wave lead:** Opus 4.8 · high. **Branch:** `lp/intake` (worktree `~/lp-intake`), off Wave-1 tip `8ac43d3b` (gate-green).
**Plan:** `W2-EXEC-PLAN.md`. **Briefs:** `briefs/w2-<lane>.md`.

## Lane status

| Lane | Slug | Worktree | Branch | Codex | Review | Adversarial | Merged SHA | Status |
|---|---|---|---|---|---|---|---|---|
| 0 | contract-model + live-sync | `~/lp-w2-0` | `lp/intake-w2-0` | DONE-EXIT:0 | lead PASS + 3 findings | codex-review: 4 findings (2 P1 lead missed) | in `cc1db61a` | **MERGED** |
| 1 | board-ui | `~/lp-w2-1` | `lp/intake-w2-1` | DONE-EXIT:0 | lead PASS | codex-review: 4 P2 (real primary-action break) + fix | in `79be59fd` | **MERGED** |
| 2 | link-lifecycle | `~/lp-w2-2` | `lp/intake-w2-2` | DONE-EXIT:0 | lead PASS | codex-review: CLEAN | in `b479c2c9`+wire `ec7897d9` | **MERGED + wired + pushed** |
| 3 | nudges + E2E | `~/lp-w2-3` | `lp/intake-w2-3` | DONE-EXIT:0 | lead PASS | codex-review: 3 P1 (not reachable) + fix | in `2f413f34` +wire `b91e05d6` | **MERGED + wired** |

## 🟡 OPEN COORDINATOR DECISION (2026-07-10) — scope of Lane 0
**Discovery:** Wave 1 built `IntakeSyncClient` (advisor inbox→decrypt→file→store) as a fully-tested class, and the relay exposes the `/intake/:id/inbox` + `/ack` routes — but **nothing in the running app constructs or polls it.** `IntakeRelayClient` has no `fetchInbox`/`ack` method; no live poller is mounted; the sample/demo workspace seeds no intake record. So in the running app today, client submissions land in the relay mailbox and are never pulled down — the store never updates from real data. The board/nudges/link-lifecycle all read that store → **hollow without a live data source.**
- **Lead recommendation + default:** fold the live-sync mount into Lane 0 (add the inbox client method + a live poller wiring routeSubmission→file+fact+updateItem+`setLastClientActivity`). Makes the board real. Robust path ("no shortcuts on the core app").
- **Alternative:** Wave-2 UI-only on the existing store; treat live-sync as a separate follow-up (faster, hollow board).
- **Status:** surfaced to coordinator; proceeding on the recommended path (Lane 0 = live-sync + contract + model) unless redirected. Lane 0 dispatch held briefly for the window.

## ✅ WAVE 2 COMPLETE — all 4 lanes merged + wired + gate-green + pushed (`lp/intake` @ `6989e929`, 2026-07-10)
Full `npm run gate`: all TS steps GREEN (typecheck, typecheck:tests, i18n completeness, vitest **7266 passed / 4 skipped**, ESLint gate, token/handle guards, tauri contracts, architecture-boundaries incl. the new `intake->email` edge) + cargo `--workspace` green **except the known baseline flake** `commands::mail::tests::backfill_marker_set_is_idempotent_and_clearable` (`Some("1")` vs `None` under parallel cargo — **passes in isolation**, pre-existing, NOT intake). backend `bun test` **214/0** (cross-lane E2E + standing privacy-proof). `HEAD == origin/lp/intake`, tree clean.
- Lane 0 contract+live-sync `cc1db61a` (fix: 2 P1 contract breaks — blob-fetch + guided-answer/multi-file data loss). Lane 1 board `79be59fd` (fix: 4 P2 incl. primary-action tab overwrite). Lane 2 link `ec7897d9` (codex-review clean; privacy rule held — no relay change). Lane 3 nudge `2f413f34` (fix: 3 P1 not-reachable — link reconstruction, App audit emitter) + board wiring `b91e05d6`.
- **Every lane: lead diff review + one `codex-review --base lp/intake` adversarial pass; findings batched into ONE fix round per lane. The adversarial pass earned its keep on EVERY lane** — it caught the deepest integration bugs the lead + scoped tests missed (the "each half fakes the other half" class, exactly the Wave-1 lesson). The cross-lane E2E (`onboarding-e2e.test.tsx`) + redaction tests are the standing guarantee.
- Nudge = `mailSaveDraft` only (never sends — test-enforced). Link signals local-only (no relay probe telemetry — privacy hardening preserved). Client email now persisted. Board reachable + live via the wired inbox sync.
- **BENCH still BLOCKED by the coordinator** (Legion demo indexing) — not run. UI-spec §5 screenshots + the V10 bench are post-WORKER-DONE, coordinator-gated.

## 🟢 Coordinator final-pass fixes (2 P2 + 1 P3) — fix lane `5d488991` (worktree ~/lp-w2-cf, branch lp/intake-w2-cf)
Coordinator's independent Wave-2 pass: NO P1s (board isolation + copy clean). Three fixes (brief `briefs/w2-coord-fix.md`), lead-verified correct + tested:
- **[P2a] Copy-message nudge fallback now guards + audits** (`NudgeReviewModal.handleCopy` + `nudgeSave.recordNudgeCopiedToClipboard`): runs the SAME stale + eligibility check and writes the SAME intent/outcome audit pair + `recordNudgeAttempt` (channel email_draft for cadence; audit notes `copied_message`) as the mailbox path — previously it bypassed the cadence cap with no compliance record.
- **[P2b] Regenerate persists the new secret only AFTER the relay accepts** (`MatterHub.handleRegenerateIntake`): reordered to relay-first, removed the pre-persist + rollback → no crash gap where the keychain holds a secret the relay never accepted (which made "copy link" hand out a dead link). Tests assert relay-before-persist ordering AND `updateIntakeLinkSecret` NOT called on relay reject.
- **[P3] Link panel local-only honesty**: `intake.link.local-note` copy updated (en/de/es, value-only so snapshot counts hold) to say the status reflects what this device last recorded and may not show a change made elsewhere.
- Lead verify: vitest 93/93 (intake), tsc clean, eslint-gate clean, i18n snapshot 6/6, TS-only (no backend/intake-page). Adversarial codex-review + full re-gate + push + re-WORKER-DONE next.

## Board slot API — how Lanes 2/3 wire in at merge (LEAD does this in MattersHome)
`OnboardingBoard` (Lane 1, `377be8b4`) exposes props: `onOpenNudge`, `onOpenLinkSignals`, `onReviewItems`, `onCopyLink`, `renderNudgeSlot(row)`, `renderLinkSignals(row)`. Currently mounted in `MattersHome` with only `onNewClient`. At merge:
- **Lane 2 (link):** pass `renderLinkSignals={(row)=><LinkSignalBadge signals={row.linkSignals}/>}` + `onOpenLinkSignals`. (Lane 2 also mounts `LinkLifecyclePanel` in `OnboardingTab` itself.)
- **Lane 3 (nudge):** pass `renderNudgeSlot`/`onOpenNudge` for the inline board nudge card.
- Lead P3 (batch if codex-review agrees): board `copyLink` reads the in-memory-only `link` → silently no-ops after an app restart (OnboardingTab reconstructs it via `reconstructAdvisorIntakeLink`; the board should too, or delegate).

## Lane 1 review — 4 P2 findings (batched into fix round `briefs/w2-1-fix.md`)
Lead independent verify: vitest 4/4, tsc clean, eslint-gate clean, no raw hex, i18n snapshot 6/6, board test covers sort/labels/stalled/actions/redaction/routing. codex-review found 4 real user-facing P2s (the board test masked #1 by setting state directly, not via the real event bus — same "test fakes the other side" class):
- **[P2 — primary action BROKEN] row click lands on OVERVIEW, not Onboarding:** `openRow` sets onboarding then dispatches `EV_MATTER_LAUNCH surface:'matters'`, which `useGlobalEventBus` handles by setting `overview` synchronously → overwrites onboarding. Fix: set the tab AFTER dispatch (or pass target tab in the event) + a test that reproduces the bus overwrite.
- **[P2] copy-link falsely reports "Copied" after restart:** `link` is stripped from persisted state; board copyLink no-ops but flips to "Copied". Fix: reconstruct via `reconstructAdvisorIntakeLink` (like OnboardingTab); only show Copied on real success.
- **[P2] keyboard: row keydown steals Enter/Space from child buttons** (preventDefault) → inner actions unusable by keyboard. Fix: only handle when `event.target===event.currentTarget`.
- **[P2] enabled-but-dead actions:** board mounted without `onOpenNudge`/link handlers (Lanes 2/3 not merged) → nudge/link buttons enabled but no-op. Fix: disable/hide until the handler/slot is wired (light up when 2/3 merge).

## Lane 2 (link) — lead verify PASS
21 tests pass, tsc clean, token-guard clean (no new hex). **Privacy rule held: no backend/IntakeRelayClient/model files touched** — signals locally-derived; test asserts `IntakeRelayClient` + `fetchInbox` `not.toHaveBeenCalled()`. Covers all signal states (incl regenerate_available + integrity), dismissal rules (info dismissible, revoked/integrity stay), redaction (no ssn/last-4/file-name), Wave-1 controls one-click (refactored into LinkLifecyclePanel, still wired), panel mounted in OnboardingTab. New board helper `renderLinkSignalBadges.ts` for the lead to wire into the board at merge. codex-review pending.

## Lane 3 (nudge) — lead verify PASS
75 tests pass, tsc/token-guard/eslint-gate clean. **No-send guarantee enforced:** no `mailSend` in code; tests reject `mail_send` + assert never called. `nudgeSave`: audit intent BEFORE `mailSaveDraft`, outcome after success, failed-outcome on error, `recordNudgeAttempt` only on success (shared `auditPairId`), no body/restricted values in rows. Stale-draft guard (missing items changed → block + regenerate). Proactively declared the new architecture-boundary edge. **Cross-lane E2E** (`onboarding-e2e.test.tsx`): store→model→board→draft-save→audit + REAL simulated restart (persist+rehydrate via migration) asserts cadence still blocks; redaction test asserts SSN/file-name absent from board/nudge/link. `intake_nudge` audit action added to audit.ts + AuditLog + auditHomeHelpers. codex-review pending. Board wiring (NudgeDraftCard/onOpenNudge) done by lead at merge.

## Lane 3 review — 3 P1 "built but not reachable in production" (same class as Lane 0's unwired sync)
codex-review found the nudge feature well-tested in isolation but not actually functional in the running app:
- **[P1] nudge draft omits the link after restart** (`nudgeDraft.ts:184` falls back to `''`; store strips `link`). Fix (Codex): reconstruct via `reconstructAdvisorIntakeLink({intakeId,publicKeyRawB64})`; block save if no link. → `briefs/w2-3-fix.md` #1.
- **[P1] audit emitter never registered in App.tsx** → `logIntakeNudgeAudit` silently drops every intent/outcome row in prod (compliance record lost). Fix (Codex): register the emitter in App.tsx mirroring `setEmailAuditEmitter`. → fix #2.
- **[P1] nudge UI not wired into the board** (`MattersHome` renders board without `renderNudgeSlot`/`onOpenNudge` → Nudge button disabled). Fix: **LEAD wires it at merge** (like the link-badge wiring `ec7897d9`), since Lane 3 can't touch MattersHome.
- LESSON: the adversarial pass again caught integration gaps unit tests can't see. Same pattern as Lane 0 — "the piece exists and passes its own tests but nothing in the running app reaches it."

## Resolved open questions (from W2-PREP)
See `W2-EXEC-PLAN.md` §0 — all 7 resolved from grounded Wave-1 code. Headlines: (Q2) client email is NOT persisted today → Lane 0 adds it; (Q3) approve = `mailSaveDraft`, never send; (Q5) link signals LOCAL-only, no relay attempt-telemetry (preserves the uniform-410 privacy hardening); (Q7) deterministic templates + optional AI "in my voice" on body only.

## Cross-lane seams the LEAD owns (isolated reviews won't see them)
- The Lane-0 `onboardingModel` is the single shared contract — board/link/nudge all consume it. Reconcile any drift at merge.
- Shared file touchpoints reconciled at each merge: `src/locales/{en,de,es}.json` + `en-json-snapshot.test.ts` (each lane adds its namespace — collisions trivial), `MattersHome.tsx` (Lane 1), `OnboardingTab.tsx` (Lane 2), `audit.ts`/`AuditLog.tsx`/`auditHomeHelpers.ts` (Lane 3).
- The cross-lane E2E + redaction test (Lane 3) is the standing guarantee that store→model→board→nudge→audit connects across a restart.

## Gate-fix round (budgeted, after Lane 3)
Scoped vitest misses: ESLint (`lantern-async/no-silent-failure`, `lantern-i18n/no-hardcoded-string`), token-guard (hex→tokens), i18n locale parity (en→de/es + snapshot inventory/counts), architecture-boundaries (new feature→feature edges). Normal, not a surprise.

## Lane 0 review findings (lead — batch with codex-review into ONE fix round)
Independent verify PASS: vitest 50/50 (src/platform/intake), tsc clean, baseline eslint-gate clean, tree clean. Codex's green claim confirmed. But the lead diff review found real cross-lane contract breaks (the #1 Wave-1 lesson — per-lane tests mocked the other side):
- **[P1 CONTRACT BREAK] inbox cursor param:** `IntakeRelayClient.fetchInbox` sends `?since=<n>`, but the relay `parseCursor` (`backend/src/routes/intake.ts`) reads `?cursor=`, defaulting to 0 → the relay IGNORES the client cursor and returns from 0 on every 30s poll (re-pulls/re-decrypts all submissions; server pagination cursor dead). Dedup prevents double-filing but it's wrong + wasteful. Fix: send `?cursor=`; fix the test that asserts `since=`.
- **[P1 CONTRACT BREAK / silent data loss] guided-question facts dropped:** the client page (`intake-page/src/submission.ts`) seals typed_field answers as `{...,value,display_value}` but guided_question answers as `{...,answer}` (NO `value`). `routeJsonSubmission` guards on `!('value' in body)` → returns `{}` for guided questions → **income + spending (standard-template guided_questions) are never stored as facts, yet the item is marked `received`.** Fix: handle BOTH `value` (typed) and `answer` (guided) bodies; map guided `answer`→FactValue by response_format (money/range/text) + item_id→kind (income→income_annual, spending→spending_monthly); and if a typed/guided submission can't be stored, do NOT mark it cleanly received (flag it) — no silent loss.
- **[P2] `regenerate_available` unreachable:** the `LinkSignalKind` is declared but `deriveLinkSignals` never emits it → Lane 2 can't surface "regenerate available." Fix: emit it when status expired/revoked AND received items exist.
- **[ADD — Wave-1 lesson] pull the cross-lane contract test into THIS fix round:** a `src/platform/intake` test that constructs the TWO real client-page body shapes (typed `value` + guided `answer`, matching `intake-page/src/submission.ts`) and routes them through `routeIntakeSubmission`, asserting dob/ssn/income/spending facts AND a file all land + correct item states + `lastClientActivityAt` stamped. This locks the C↔sync contract at the foundation (would have caught the two P1s).

### codex-review (adversarial) — 4 findings, batched into the fix round. Caught 2 P1s the lead missed:
- **[P1 — lead MISSED, most severe] inbox returns BLOB IDS, not inline chunks:** the relay `handleIntakeInbox` envelope has `blobs:{blob_id,index,size}[]`, and ciphertext must be fetched from `GET /intake/:id/blob/:blob_id`. `fetchInbox` just cast the response → `submission.chunks` undefined → `decryptAndVerify` throws `integrity_mismatch` → **the whole live sync fails against the real relay; nothing ever files.** Fix: fetch each blob (raw bytes, base64) + assemble `ChunkUpload[]`.
- **[P1 — lead MISSED] multi-file uploads concatenated/lost:** `SealedManifest` has `file_names[]` + flat `chunk_count` but NO per-file boundary (the client's `fileIndex`/`filePart` is dropped at the wire). `routeFileSubmission` uses `file_names[0]` + `concatBytes(ALL)` → driver's-license front+back become one corrupt file, 2nd lost, then acked. **Robust fix chosen: client submits ONE file per submission** for doc_upload (intake-page — no wire/crypto change, no risk to the Wave-1 E2E contract) + advisor guard (if file_names>1, flag+don't ack, never concat). This is a Wave-1-surfaced defect (sync was never wired before Lane 0).
- **[P1] guided-answer drop** + **[P2] cursor param** — same as the lead's findings (both confirmed).
- **LESSON reaffirmed:** the mandatory adversarial pass earned its keep — it found the two deepest contract breaks the lead's read missed. Never skip it.

## Log
- **2026-07-10:** Wave 2 kicked off. Read W1-LEAD-HANDOFF + W1-TRACKER + W2-PREP + WAVE-PLAN/PRODUCT-DESIGN §4/§8. Grounded all 7 open questions in the shipped Wave-1 code. Wrote `W2-EXEC-PLAN.md` + 4 briefs (`w2-0..3`). **Discovered the live advisor sync loop is unmounted** → surfaced the Lane-0 scope decision to the coordinator; proceeding on the recommended (fold-in) path. Environment: `~/lp-intake` already has node_modules + sidecar binaries (main worktree).
