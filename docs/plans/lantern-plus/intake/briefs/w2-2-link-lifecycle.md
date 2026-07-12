# CODEX BUILD BRIEF — Lantern Intake Wave 2, Lane 2: Link Lifecycle UI (locally-derived only)

You are a Codex build agent. Build exactly the scope below, TDD, commit on your branch. **Do NOT push.** **Do NOT touch `backend/`, `intake-page/`, or add ANY relay route/event/method** — this lane derives every signal LOCALLY. **Do NOT touch `src/platform/intake/onboardingModel.ts`/`intakeStore.ts`** (Lane 0 owns them; import). Wrapper appends the DONE-EXIT sentinel.

> **Hard privacy rule for this lane:** the relay deliberately reveals NOTHING about who probes a dead/expired/wrong-token link (uniform 410 + rate-limit-before-auth — a deliberate hardening). You must NOT add any "expired-link attempt" / "revoked-link attempt" / probe telemetry, and you must NOT add a relay route or `IntakeRelayClient` method. Every signal comes from LOCAL state only: `intake.status`, `intake.expiresAt`, and `intake.flags` (already produced by the sync engine). If your design needs a server signal, STOP and leave a `// COORDINATOR:` code comment instead of adding it.

## Context to read first
- `docs/plans/lantern-plus/intake/W2-EXEC-PLAN.md` §0 Q5, §1, §3, §4 (V3/V4).
- `docs/plans/lantern-plus/intake/W2-PREP.md` Lane 3 (behavior/acceptance) — but note the "expired-link attempt" telemetry is OUT (privacy).
- **Consume Lane 0:** `src/platform/intake/onboardingModel.ts` → `deriveLinkSignals(intake, now, cfg)`, `LinkSignal`, `LinkSignalKind`. This is your data source — render it, don't recompute.
- **Reuse the UI:** `src/features/intake/OnboardingTab.tsx` (the per-client Onboarding tab — it already has the Wave-1 link controls: copy/extend/revoke/regenerate; keep them one-click visible). `src/ui/kp/` `Badge`/`Callout`/`IconButton`/`SlidePanel`. Light theme, tokens only.

## Scope (build all)
- `src/features/intake/LinkSignalBadge.tsx` — a small badge for one `LinkSignal`: warm amber for `attention`, neutral for `info`, distinct treatment for `integrity` severity. Neutral copy — no alarm language unless `revoked` or `integrity_mismatch`. Used on board rows and the per-client tab.
- `src/features/intake/LinkSignalDetails.tsx` — an expandable/panel detail for a signal (what it means + the safe next action, e.g. expired → "extend or regenerate"). Renders NO submitted value, file name, or last-4.
- `src/features/intake/LinkLifecyclePanel.tsx` — the per-client section that groups: the current link status (from `deriveLinkSignals`), the Wave-1 controls (copy again / extend / turn off / regenerate — reuse the handlers already passed into `OnboardingTab`), and any active signals with details. `regenerate_available` surfaces when a link is expired/revoked but items were already received (regenerating keeps received items, kills the old link — Wave-1 behavior; you only surface it).
- Mount `LinkLifecyclePanel` in `OnboardingTab.tsx` (a new section; keep existing controls working). Export `LinkSignalBadge` for the board (Lane 1 exposed a `renderLinkSignals?` slot — provide a helper the lead wires at merge; if the slot isn't present, render badges inline in the panel only).
- Dismissal rule: `info` signals are dismissible; `attention`/`integrity` (revoked, integrity_mismatch) stay visible until resolved. Track dismissal in local component state (do not persist a security flag away).
- Locale: `intake.link.*` keys in en/de/es + snapshot inventory (same note as other lanes — add to all three; lead reconciles snapshot at gate-fix).

## Tests (Vitest + RTL)
- `src/features/intake/__tests__/linkSignals.test.tsx`: render each `LinkSignalKind` (active/expires_soon/expired/revoked/new_device/duplicate/integrity_mismatch/regenerate_available) → correct badge tone + copy; integrity/revoked NOT dismissible; info dismissible; **redaction**: intake with a planted value/file-name → assert the panel/badge/details render none of it. Assert the Wave-1 controls remain present and one-click.
- A test asserting NO relay call is made by this lane (the panel renders from store/model only — no `IntakeRelayClient.fetchInbox`/new method invoked).

## Constraints
- Locally derived only — NO relay route/event/method, no probe telemetry. If tempted, leave a `// COORDINATOR:` comment.
- Light theme, tokens (no hex). User copy client/household, warm not alarmist. No em dashes, no time estimates.
- Strict TS, `@/` alias. TDD, real assertions. Match `OnboardingTab.tsx` idiom.
- Before done: `npx vitest run src/features/intake` green; `npx tsc --noEmit` clean; `npx eslint src/features/intake` clean. Commit on your branch. Do NOT push.
