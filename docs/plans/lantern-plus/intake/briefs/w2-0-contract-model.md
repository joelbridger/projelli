# CODEX BUILD BRIEF — Lantern Intake Wave 2, Lane 0: Live sync mount + store contract + onboarding model

You are a Codex build agent. Build exactly the scope below, TDD, commit on your branch. **Do NOT push.** **Do NOT touch `backend/` or `intake-page/`** (their relay routes already exist — you CONSUME them). Wrapper appends the DONE-EXIT sentinel.

This lane is the shared FOUNDATION every other Wave-2 lane sits on. Correctness of the read-model types is a hard gate: the board, nudges, and link signals all consume it, and a value/file-name leaking into the model would break the redaction promise everywhere at once.

## Context to read first
- `docs/plans/lantern-plus/intake/W2-EXEC-PLAN.md` §0 (resolved questions), §1 (non-negotiables), §3 (file table), §4 (VERIFY).
- `docs/plans/lantern-plus/intake/PRODUCT-DESIGN.md` §4 (board sort/stall), §8 (nudge cadence).
- **Read these real files (you extend/consume them):**
  - `src/platform/intake/intakeStore.ts` — `IntakeRecord`, `IntakeItemState`, `IntakeStatus`, `IntakeChecklistState`, `IntakeReceivedItem`, `IntakeFlag`, the `persist` config with `partializeIntakeStateForPersistence` (strips `link`/secrets), `sanitizePersistedIntakeState`.
  - `src/platform/intake/IntakeSyncClient.ts` — the ALREADY-BUILT sync engine (`IntakeSyncClient`, `IntakeRelayInboxClient`, `IntakeInboxPage`, `RoutedIntakeSubmission`, `IntakeRouteResult`, `IntakeSubmissionFlag`). It is fully tested but **nothing constructs it yet** — you wire it live.
  - `src/platform/intake/IntakeRelayClient.ts` — advisor relay client (has create/extend/revoke/regenerate; you ADD `fetchInbox`/`ackSubmission`).
  - `src/platform/intake/intakeKeychain.ts` — `loadIntakePrivateKey`/secret access (private key per intake).
  - `src/platform/intake/intakeFiling.ts` — `fileIntakeDocument`/`intakeOnboardingFolder` (documents → client folder).
  - `src/platform/intake/factsStore.ts` — `intakeFactUpsert` (typed facts → SQLCipher).
  - `src/features/matters/NewClientDialog.tsx` — collects `email`/`phone` in local state, calls `upsertIntake` (~line 268). Currently DROPS email/phone.
  - `src/features/matters/MatterHub.tsx` — per-client hub; where an active-intake context exists (`intake`, `makeIntakeRelay`, seatToken/accessToken).
  - Relay inbox/ack response shape: `backend/src/routes/intake.ts` `handleIntakeInbox` returns `{intake_id, cursor, latest_cursor, has_more, submissions}`; ack is `POST /intake/:id/ack` with the submission + cursor.

## Scope (build all)

### 1. Store contract additions (`src/platform/intake/intakeStore.ts`)
- Extend `IntakeRecord` with: `clientEmail?: string`, `clientPhone?: string`, `lastClientActivityAt?: string` (ISO), `nudges: IntakeNudgeAttempt[]` (default `[]`).
- New file `src/platform/intake/nudgeTypes.ts`:
  - `IntakeNudgeAttempt { sequence: number; at: string; missingItemIds: string[]; auditPairId: string; channel: 'email_draft' | 'call_suggested' }`
  - `OnboardingConfig { stallDays: number; cadenceDays: number; maxUnanswered: number; expiresSoonDays: number }` + `DEFAULT_ONBOARDING_CONFIG = { stallDays: 5, cadenceDays: 4, maxUnanswered: 3, expiresSoonDays: 3 }`.
- New store actions: `recordNudgeAttempt(intakeId, attempt: IntakeNudgeAttempt)`, `setLastClientActivity(intakeId, at: string)` (monotonic — only advance).
- **Persist migration `version: 1 → 2`:** existing records get `nudges: []`; keep stripping `link` + any secret in `partialize` (unchanged); `migrate`/`merge` must default `nudges` and never resurrect a `link`. Update `intakeStore.test.ts` for the new fields + a v1→v2 migration test.

### 2. Persist client email/phone (`NewClientDialog.tsx`)
- Pass `clientEmail: email.trim() || undefined` and `clientPhone: phone.trim() || undefined` into the `upsertIntake({...})` call. Nothing else in that flow changes. (These are non-secret contact fields — fine to persist.)

### 3. The shared onboarding model (`src/platform/intake/onboardingModel.ts`) — THE CONTRACT
Pure, deterministic functions (take `now: Date` / ISO string as an arg — NEVER call `Date.now()` inside; the caller passes it, so tests are deterministic). Types carry **labels, ids, counts, timestamps, and signals ONLY — no fact value, no last-4, no file name field may exist on any exported type.**

- `interface OnboardingRow { matterId; requestId; clientFirstName; kind; requiredCount; receivedCount; missingItemIds: string[]; missingItemLabels: string[]; lastActivityAt?: string; stalledDays: number; isStalled: boolean; pendingReviewCount: number; status: IntakeStatus; linkSignals: LinkSignal[]; nudgeEligibility: NudgeEligibility; sortBucket: number }`
- `deriveOnboardingRow(intake: IntakeRecord, now: Date, cfg: OnboardingConfig): OnboardingRow` — missing = required items whose `state` ∈ {`not_started`,`needs_followup`}; received = items ∈ {`received`,`accepted`}; pendingReview = items `received` not yet `accepted`; stalledDays from `lastClientActivityAt` (or link creation) to `now`; labels come from `item.label` ONLY.
- `sortOnboardingRows(rows): OnboardingRow[]` — sort order (PRODUCT-DESIGN §4): (1) items awaiting advisor review, (2) stalled, most-stalled first, (3) link signals needing action, (4) quietly progressing, (5) complete-but-unreviewed. Encode as `sortBucket` + tiebreak by stalledDays desc.
- `type LinkSignalKind = 'active' | 'expires_soon' | 'expired' | 'revoked' | 'new_device' | 'duplicate' | 'integrity_mismatch' | 'regenerate_available'`; `interface LinkSignal { kind: LinkSignalKind; severity: 'info' | 'attention' | 'integrity'; at?: string; dismissible: boolean }`.
- `deriveLinkSignals(intake, now, cfg): LinkSignal[]` — from `status` + `expiresAt` (expired if past; expires_soon if within `expiresSoonDays`; revoked if status revoked; active otherwise) + `intake.flags` (map `new_device`/`duplicate`/`integrity_mismatch`). `integrity_mismatch` severity `integrity`, `dismissible:false`; info signals dismissible. **NO relay data — locally derived only.**
- `interface NudgeEligibility { eligible: boolean; reason: 'ok' | 'nothing_missing' | 'cadence_wait' | 'link_inactive' | 'max_unanswered_suggest_call'; nextSequence: number; suggestCall: boolean; daysUntilEligible?: number }`.
- `deriveNudgeEligibility(intake, now, cfg): NudgeEligibility` — eligible only if: link active (status active, not expired/revoked) AND missing items exist AND ≥ `cadenceDays` since the last `channel:'email_draft'` attempt AND unanswered-count < `maxUnanswered`. "Unanswered" = count of trailing `email_draft` attempts whose `at` is AFTER `lastClientActivityAt` (i.e. no client activity since). At `maxUnanswered` → `eligible:false, suggestCall:true, reason:'max_unanswered_suggest_call'`. `nextSequence` = last sequence + 1.

### 4. Live advisor inbox sync — WIRE IT ON (make the board real)
The engine exists but is dead code. Bring it to life so real client submissions flow into the store.
- **`IntakeRelayClient` (`src/platform/intake/IntakeRelayClient.ts`):** add `fetchInbox(intakeId: string, sinceCursor: number): Promise<IntakeInboxPage>` (GET `/intake/:id/inbox?since=<cursor>`) and `ackSubmission(intakeId, submissionId, cursor): Promise<void>` (POST `/intake/:id/ack`). Map the relay response `{cursor, has_more, submissions}` to `IntakeInboxPage`. Reuse the existing `request<T>` helper + `getCorsSafeFetch`.
- **A live sync service/hook** `src/platform/intake/useIntakeInboxSync.ts` (or a service `intakeInboxSync.ts` + a thin hook) that, for each **active** intake in the store, runs `IntakeSyncClient.syncOnce()` on an interval (default 30s) AND on window focus, wired with:
  - `relay`: an adapter binding `IntakeRelayClient.fetchInbox/ackSubmission` to a single intakeId (implements `IntakeRelayInboxClient`).
  - `loadPrivateKey`: from `intakeKeychain`.
  - durable `hasSubmission`/`rememberSubmission`: use a persisted set (extend the store with `knownSubmissionIds` per intake, or a small persisted keychain/store set) — MUST survive restart (ack-last dedup depends on it).
  - `isKnownSession`/`rememberSession`: the store's `knownSessionIds` + `rememberSession`.
  - `flagSubmission`: → `useIntakeStore.addFlag` (map `IntakeSubmissionFlag.kind` → `IntakeFlag`).
  - `routeSubmission`: file documents via `fileIntakeDocument` (needs the matter folder path — resolve from `matterStore`), upsert typed facts via `intakeFactUpsert`, update the checklist item state (`updateItem` → `received`, provenance `intake_link`), `addReceivedItem`, and **`setLastClientActivity(intakeId, submission.submittedAt)`**. Also stamp `setLastClientActivity` on the duplicate path (client still acted). Persist the cursor via `setCursor`.
- Mount the hook once at the advisor shell level (e.g. in `MatterHub` or a top-level lifecycle host — follow how `MatterSyncClient`/mail sync is mounted). Guard: desktop-only where keychain/tauri is required; no-op cleanly in browser/dev.
- **Do NOT change any relay route or the wire contract.** You only ADD a client method + wiring.

## Tests (Vitest — this lane is TS-only, no Rust, no cargo)
- `onboardingModel.test.ts`: sort order across a 5-client fixture; stall math; each link signal state; cadence (before/after `cadenceDays`; 3 unanswered → `suggestCall`; "unanswered" resets when `lastClientActivityAt` advances past the last attempt); nextSequence; **redaction-by-type**: a test that constructs a row from an intake whose items carry values in labels-only and asserts the row exposes no value field (compile-time via types + a runtime `JSON.stringify(row)` scan for a planted SSN string that must be ABSENT because the model never reads values).
- `intakeStore.test.ts`: new fields default; `recordNudgeAttempt`/`setLastClientActivity` (monotonic); v1→v2 migration defaults `nudges` and never persists `link`.
- Inbox sync: extend/reuse `IntakeSyncClient.test.ts` patterns for the new `IntakeRelayClient.fetchInbox/ackSubmission` (mock `getCorsSafeFetch`) and the adapter; a routeSubmission wiring test that asserts `setLastClientActivity` is called and the item state advances. (Do NOT re-test the already-covered `IntakeSyncClient` internals.)

## Constraints
- Never rename `matter`/`matter_id`. Light theme (no UI here beyond the NewClientDialog one-line change). User copy says client/household. No em dashes, no time estimates in copy.
- Pure model functions take `now` as an arg — never `Date.now()` inside them.
- No secret/`link` to persisted state. Restricted values never enter the store or the model (facts stay in SQLCipher via `factsStore`).
- Strict TS, `@/` alias, Zustand `use*Store` idiom. TDD, real assertions.
- Before done: `npx vitest run src/platform/intake` green; `npx tsc --noEmit` clean; `npx eslint src/platform/intake` clean. Commit on your branch. Do NOT push.
