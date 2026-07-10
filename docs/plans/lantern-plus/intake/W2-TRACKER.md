# Lantern Intake — Wave 2 Tracker

**Wave lead:** Opus 4.8 · high. **Branch:** `lp/intake` (worktree `~/lp-intake`), off Wave-1 tip `8ac43d3b` (gate-green).
**Plan:** `W2-EXEC-PLAN.md`. **Briefs:** `briefs/w2-<lane>.md`.

## Lane status

| Lane | Slug | Worktree | Branch | Codex | Review | Adversarial | Merged SHA | Status |
|---|---|---|---|---|---|---|---|---|
| 0 | contract-model + live-sync | `~/lp-w2-0` | `lp/intake-w2-0` | — | — | — | — | **BLOCKED on coordinator scope call** |
| 1 | board-ui | `~/lp-w2-1` | `lp/intake-w2-1` | — | — | — | — | queued (after Lane 0) |
| 2 | link-lifecycle | `~/lp-w2-2` | `lp/intake-w2-2` | — | — | — | — | queued (after Lane 0) |
| 3 | nudges + E2E | `~/lp-w2-3` | `lp/intake-w2-3` | — | — | — | — | queued (last) |

## 🟡 OPEN COORDINATOR DECISION (2026-07-10) — scope of Lane 0
**Discovery:** Wave 1 built `IntakeSyncClient` (advisor inbox→decrypt→file→store) as a fully-tested class, and the relay exposes the `/intake/:id/inbox` + `/ack` routes — but **nothing in the running app constructs or polls it.** `IntakeRelayClient` has no `fetchInbox`/`ack` method; no live poller is mounted; the sample/demo workspace seeds no intake record. So in the running app today, client submissions land in the relay mailbox and are never pulled down — the store never updates from real data. The board/nudges/link-lifecycle all read that store → **hollow without a live data source.**
- **Lead recommendation + default:** fold the live-sync mount into Lane 0 (add the inbox client method + a live poller wiring routeSubmission→file+fact+updateItem+`setLastClientActivity`). Makes the board real. Robust path ("no shortcuts on the core app").
- **Alternative:** Wave-2 UI-only on the existing store; treat live-sync as a separate follow-up (faster, hollow board).
- **Status:** surfaced to coordinator; proceeding on the recommended path (Lane 0 = live-sync + contract + model) unless redirected. Lane 0 dispatch held briefly for the window.

## Resolved open questions (from W2-PREP)
See `W2-EXEC-PLAN.md` §0 — all 7 resolved from grounded Wave-1 code. Headlines: (Q2) client email is NOT persisted today → Lane 0 adds it; (Q3) approve = `mailSaveDraft`, never send; (Q5) link signals LOCAL-only, no relay attempt-telemetry (preserves the uniform-410 privacy hardening); (Q7) deterministic templates + optional AI "in my voice" on body only.

## Cross-lane seams the LEAD owns (isolated reviews won't see them)
- The Lane-0 `onboardingModel` is the single shared contract — board/link/nudge all consume it. Reconcile any drift at merge.
- Shared file touchpoints reconciled at each merge: `src/locales/{en,de,es}.json` + `en-json-snapshot.test.ts` (each lane adds its namespace — collisions trivial), `MattersHome.tsx` (Lane 1), `OnboardingTab.tsx` (Lane 2), `audit.ts`/`AuditLog.tsx`/`auditHomeHelpers.ts` (Lane 3).
- The cross-lane E2E + redaction test (Lane 3) is the standing guarantee that store→model→board→nudge→audit connects across a restart.

## Gate-fix round (budgeted, after Lane 3)
Scoped vitest misses: ESLint (`lantern-async/no-silent-failure`, `lantern-i18n/no-hardcoded-string`), token-guard (hex→tokens), i18n locale parity (en→de/es + snapshot inventory/counts), architecture-boundaries (new feature→feature edges). Normal, not a surprise.

## Log
- **2026-07-10:** Wave 2 kicked off. Read W1-LEAD-HANDOFF + W1-TRACKER + W2-PREP + WAVE-PLAN/PRODUCT-DESIGN §4/§8. Grounded all 7 open questions in the shipped Wave-1 code. Wrote `W2-EXEC-PLAN.md` + 4 briefs (`w2-0..3`). **Discovered the live advisor sync loop is unmounted** → surfaced the Lane-0 scope decision to the coordinator; proceeding on the recommended (fold-in) path. Environment: `~/lp-intake` already has node_modules + sidecar binaries (main worktree).
