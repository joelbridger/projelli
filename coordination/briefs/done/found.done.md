# Lane L0 — FOUNDATION — DONE

Branch: `lp/ux-found` (pushed). Worktree: `/home/jameson/lp-ux-found`.
HEAD: `b142c5e6` (3 commits: primitives → F1 egress → F3 README).

## What shipped (all four brief items)

### Item 2 — `TrustNote` primitive ✅  (pushed first, in commit 1 so lanes could consume early)
- `src/ui/kp/TrustNote.tsx` + CSS in `globals.css` + exported from `src/ui/kp/index.ts`.
- Trust-ladder rung 2 ("one short line at action time"): quiet muted text by default; `variant="warning"` (amber) and `variant="blocker"` (red) for real risk only; long copy on demand via `details` (native tooltip). Never a framed box (that's Callout). Blocker renders `role="alert"`.
- Tests: `src/ui/kp/TrustNote.test.tsx` (4 cases).

### Item 3 — `QuietStatus` primitive ✅  (commit 1)
- `src/ui/kp/QuietStatus.tsx` + CSS + export.
- Normal-good states said quietly: muted tick + text, or **nothing** when `state="ok"` and no children. Only loud when caller passes `state="failure"` (red, `role="alert"`).
- Tests: `src/ui/kp/QuietStatus.test.tsx` (4 cases).

### Item 1 — Single-source egress (F1) ✅  (commit 2)
- **Root cause found:** the top-bar `TrustBar` (`useActiveEgressProvider`) and Ask's banner (`resolveActiveAskProviderId`) computed egress independently. Two drifts: (a) only Ask fell back to the on-device engine when no cloud key was present — so the top bar said "No AI connected" while Ask said "Using local AI"; (b) they even read the user's default provider from different code.
- **Fix:** one canonical resolver `src/platform/privacy/activeEgressProvider.ts` with a **pure, unit-tested core** (`pickEgressProviderId`). Both the top-bar hook and Ask's `resolveActiveAskProviderId` now delegate to it, so every consumer renders identical state. The real send (`buildResolvedAskProvider`) shares the same cloud-selection helper (`resolveActiveCloudResolution`), so the badge can never name an engine the send won't use.
- **Unit test proving both paths use the same selector:** `tests/unit/privacy/single-source-egress.test.ts` (pure-core matrix + both render paths return identical results, incl. the exact old-contradiction scenario).
- **Top-bar pill** shortened to the status form (`Using local AI` / `Using cloud AI` / `No AI connected`), full detail in tooltip (`TrustBar.tsx`: `variant="compact"` → `variant="status"`).
- **Removed the duplicate egress pills:** Ask header (`Ask.tsx`), Client Map header (`MatterHub.tsx`). Dead `openAiOptions`/imports cleaned up.
- **Workflow template detail** (`AssociateHome.tsx`): pill replaced with a quiet **TrustNote** line above Run (trust at action time), driven by the egress provider/mode. New i18n keys `workflow.associate.egress-{local,cloud,none}`.

### Item 4 — Red-usage rule (F3) ✅  (commit 3)
- Swept `src/ui/kp` primitives: red is already a deliberate opt-in everywhere (`Button` default is primary; `danger` is explicit; `link` is navy; `IconButton` has no red; `Badge` danger is explicit). **No primitive defaults to red** — no restyle needed.
- Added `src/ui/kp/README.md` with the exact mandated line plus the trust-ladder + single-source-egress guidance for other lanes.

## Skipped / notes for the coordinator (merge)
- **Nothing skipped.** All four items done, no capability removed (FOLD honoured):
  - The Ask header pill's incidental "click → open AI settings" affordance is gone with the pill, but AI settings remain reachable from Settings and the top bar. The **composer/send-time trust signal in Ask is unaffected** (it's a separate surface, `AIChatViewer`/`ChatInputBanners`).
- **`data-testid` handles:** none removed. `egress-indicator-compact` still lives in `EgressIndicator.tsx` (used by PrivacyCenterHome), so the handle guard passes. I **updated one desktop spec** `tests/desktop/specs/19-global-shell.mjs` to grip `egress-indicator` (the top bar is now the status variant) — please confirm on the desktop harness run (I did not run desktop/Playwright per the brief).
- **`egress-banner-mode-switch.test.tsx` rewrite (correctness-critical, please review):** this B-PRIV-1 test gripped the **removed** Ask header pill. I re-based it: kept the unique load-bearing case (SEND-SIDE PRIVACY: flipping to local-only mid-resolve never sends to cloud, via the real `<Ask>` send path), and documented in-file that the badge-DOM honesty moved to `single-source-egress.test.ts` + `active-egress-provider.test.ts` + `local-only-egress-guard.test.ts` (which already cover the resolver across every mode). Also fixed its incomplete `workspaceCommand` mock (was missing exports; now spreads actual).
- **`active-egress-provider.test.tsx`:** added deterministic local-probe mocks (this dev box has Ollama reachable, so the no-key case now correctly falls back to local; mocks pin it "unavailable" so the none-sentinel cases stay deterministic). Positive local-fallback is proven in `single-source-egress.test.ts`.
- **i18n snapshot:** updated leaf count `1547 → 1550` and `workflow` namespace `62 → 65` with an honest comment (the 3 new egress-line keys).
- Other lanes can `git fetch origin lp/ux-found` and reuse `TrustNote` / `QuietStatus` from `@/ui/kp` and the single-sourced egress.

## Files touched: 20
New (6): `src/ui/kp/TrustNote.tsx`, `QuietStatus.tsx`, `README.md`, `src/platform/privacy/activeEgressProvider.ts`, `tests/unit/privacy/single-source-egress.test.ts`, plus the 2 new kp test files.
Modified (14): `src/ui/kp/index.ts`, `src/styles/globals.css`, `src/platform/hooks/useActiveEgressProvider.ts`, `src/features/ask/askHelpers.ts`, `Ask.tsx`, `MatterHub.tsx`, `AssociateHome.tsx`, `TrustBar.tsx`, `src/locales/en.json`, and the affected tests (`active-egress-provider`, `egress-banner-mode-switch`, `en-json-snapshot`, `19-global-shell.mjs`).

## Test output (real)

```
$ npm run typecheck
> tsc --noEmit
(no output — clean)

$ node scripts/eslint-gate.mjs
✅ No ESLint regression vs baseline. (18 fingerprint(s) cleaned up vs baseline)

$ node scripts/ui-system/handle-guard.mjs
✅ Handle guard passed — no permanent handle vanished, and no new ambiguous (duplicate) handles (33 frozen).
(12 NEW handles listed are from other lanes already in the base branch — email-*; none mine.)

$ npx vitest run src/ui/kp/ tests/unit/privacy/ tests/unit/ask/ tests/unit/matter/ tests/unit/workflows/ tests/unit/i18n/en-json-snapshot.test.ts
 Test Files  86 passed (86)
      Tests  727 passed (727)
```

(Did NOT run full gate / cargo / Playwright / desktop — coordinator's job, per the common brief.)

---

## Fix round 1 (adversarial Codex review — 2 BLOCKER + 3 MAJOR + coverage)

HEAD: `9ccb5ce5`. Branch pushed. One combined round, TDD per item.

All six items fixed:

1. **BLOCKER — mode-switch display race** (`useActiveEgressProvider.ts`). The mode and the resolved provider came from two independent hooks, so a Local-only → Direct switch could paint a local destination under Direct for one frame (recreated the old B-PRIV-1 bug). Fix: the hook now **mode-tags** the resolved value and returns `null` ("checking") until the tag matches the requested mode. New `useActiveEgressDestination` returns provider + assuredAvailable, tagged. Test: `egress-topbar-mode-switch.test.tsx` (held-async one-frame guarantee).
2. **BLOCKER — assured routes ignored** (`activeEgressProvider.ts`). The resolver picked only by cloud-key presence, so in assured mode the badge could say "No AI connected" while sends used the firm proxy. Fix: it now checks `resolveAssuredRoute` FIRST (assured wins over personal BYOK, mirroring `resolveEmailProvider`), returns the real `{providerId, assuredAvailable}` DESTINATION, and the top bar passes `assuredAvailable` through `EgressIndicator`. Tests: assured columns in `single-source-egress.test.ts` + `egress.test.tsx` + `egress-topbar-mode-switch.test.tsx`.
3. **MAJOR — strict local probe** (`activeEgressProvider.ts`). Local-only fell back to 'ollama' with no reachability check. Fix: it uses the SAME strict probe the send uses (`resolveAvailableLocalGenerationProvider`); when nothing is usable it returns the new **`LOCAL_PENDING`** sentinel → badge shows "Local AI setting up", never a false "Using local AI". New i18n: `privacy.egress.local-pending.{label,note}`. Tests updated in `local-only-egress-guard.test.ts` + `active-egress-provider.test.tsx` + `single-source-egress.test.ts`.
4. **MAJOR — duplicate testids** (`EgressIndicator.tsx`, `AskComposer.tsx`, `ChatInputBanners.tsx`). The composer's action-time indicator shared `egress-indicator`/`-label` with the top bar. Fix: `EgressIndicator` takes a `testId` override (default preserved as the literal `egress-indicator*` so the handle guard still tracks them); the Ask composer uses `egress-indicator-composer`, the chat composer `egress-indicator-chat`. Migrated `local-ai-privacy-race.test.tsx` (it intends the chat composer). The bench e2e (`bench-mirror-cross-cutting.spec.ts`) grips `egress-indicator-label` = the top bar only now, so it's unambiguous — **please confirm on the e2e run** (I don't run Playwright).
5. **MAJOR — top-bar pill is the AI-settings click path** (`TrustBar.tsx`). Made the status pill an `onClick` → opens AI settings; the status variant renders a real `<button>` with `aria-label` "…Open AI options" + focus ring (keyboard reachable) + a hover affordance. Test: `egress.test.tsx` (button + aria-label).
6. **DOM coverage restored** — `egress-topbar-mode-switch.test.tsx` renders the real hook + real badge + real resolver: per-mode destination agreement (direct/BYOK, none, local, local-pending, assured) + the one-frame guarantee. The `single-source-egress.test.ts` matrix gained assured + pending columns.

Files touched this round: 16 (10 src, 6 tests incl. 1 new). Notes: the pure core is now `pickEgressDestination` (destination + assuredAvailable); `pickEgressProviderId` was replaced (the single-source test was updated). The Ask/chat composer indicators still take their provider id from `useAsk` (`displayedProvider`), which is not yet assured-aware — the **top bar is the authoritative assured signal**; threading assured into the composers is an Ask-lane follow-up, not in this packet.

### Test output (real)

```
$ npm run typecheck        → clean (no output)
$ node scripts/eslint-gate.mjs
✅ No ESLint regression vs baseline. (18 fingerprint(s) cleaned up vs baseline)
$ node scripts/ui-system/handle-guard.mjs
✅ Handle guard passed — no permanent handle vanished, and no new ambiguous (duplicate) handles (33 frozen).
$ npx vitest run src/ui/kp/ tests/unit/privacy/ tests/unit/ask/ tests/unit/chat/ tests/unit/matter/ tests/unit/workflows/ tests/unit/i18n/en-json-snapshot.test.ts tests/unit/newNav-settings-gear.test.tsx tests/unit/reimagined-ask.test.tsx tests/unit/local-ai-privacy-race.test.tsx
 Test Files  101 passed (101)
      Tests  834 passed (834)
```

(Did NOT run full gate / cargo / Playwright / desktop — coordinator's job.)

---

## Fix round 2 (re-review residuals + scope ruling)

HEAD: `791b4953`. Branch pushed. One combined round, TDD per item.

1. **BLOCKER (conservative resolution per the coordinator ruling):** the GLOBAL top-bar badge now mirrors TODAY'S Ask/Workflows reality — personal BYOK wins over the firm Assured route. I dropped the round-1 global assured-preference in `activeEgressProvider.ts` (with a documented ruling comment) but KEPT the destination enum + `assuredAvailable` in the return shape. Ask/Workflows routing was NOT rewired (the send-side inconsistency is a pre-existing bug for a separate lane). **Email stays assured-honest on its own**: `DraftFollowUpModal`/`EmailViewer` already resolve through `resolveEmailProvider()` (assured-preferred) and feed its `assuredAvailable` into `resolveEgress` — independent of the global hook. Matrix tests: `single-source-egress.test.ts` (global badge = BYOK with a key; = none with no key in assured mode) + `resolveEmailProvider.test.ts` (email note = assured with a firm route).
2. **MAJOR — sentinel leak (type-level fix):** added `RealEgressProviderId` + `toRealProviderId()` in `activeEgressProvider.ts`. `useActiveEgressProvider` now returns the precise `ActiveEgressProviderId | null` (sentinels included), so a plain `as ChatProviderId` no longer type-checks. `MainPanel.tsx` narrows through `toRealProviderId` before redline/inline-edit resolution; `resolveRedlineProvider` takes `ChatProviderId | null` and resolves the local engine directly in Local-only (never echoes a sentinel). Tests: `resolve-redline-provider.test.ts` (null/sentinel cases) + `single-source-egress.test.ts` (`toRealProviderId` matrix).
3. **MAJOR — stale "Local AI setting up":** new `src/platform/privacy/localAiReadiness.ts` bridges the Tauri local-model readiness event; the egress hook subscribes and re-resolves on it, so the badge flips to "Using local AI" the moment the download finishes — no reload. Test: `egress-topbar-mode-switch.test.tsx` (fires the captured readiness callback, asserts local-pending → local).
4. **Residual (old finding 3):** `resolveEmailProvider.ts` local fallback (both local-only and the no-cloud-key branch) now uses the STRICT `resolveAvailableLocalGenerationProvider` probe and throws an honest message (`EMAIL_LOCAL_AI_NOT_READY_MESSAGE` / `EMAIL_NO_PROVIDER_MESSAGE`) instead of building a guaranteed-broken Ollama. Tests: `resolveEmailProvider.test.ts`; updated `EmailViewer.audit.test.tsx` mock to expose `detectOllama` (reachable) so its no-cloud-key path still resolves local.
5. **MINOR:** removed the leftover `querySelector('[data-testid="egress-indicator"]')` (and the dead `bannerAtSend` field) from the mocked cloud-send branch in `egress-banner-mode-switch.test.tsx`.

Files touched this round: 12 (5 src incl. 1 new `localAiReadiness.ts`, 7 tests incl. 1 new `resolveEmailProvider.test.ts`). No new i18n keys (email error strings are hardcoded consts, same pattern as Ask's).

### Test output (real)

```
$ npm run typecheck        → clean (no output)
$ node scripts/eslint-gate.mjs
✅ No ESLint regression vs baseline. (18 fingerprint(s) cleaned up vs baseline)
$ node scripts/ui-system/handle-guard.mjs
✅ Handle guard passed — no permanent handle vanished, and no new ambiguous (duplicate) handles (33 frozen).
$ npx vitest run src/ui/kp/ tests/unit/privacy/ tests/unit/ask/ tests/unit/chat/ tests/unit/email/ \
    tests/unit/mail/ tests/unit/race/ tests/unit/matter/ tests/unit/workflows/ tests/unit/documents/ \
    tests/unit/resolve-redline-provider.test.ts tests/unit/inline-edit-provider.test.ts \
    tests/unit/local-ai-privacy-race.test.tsx tests/unit/draft-follow-up-modal.test.tsx \
    tests/unit/i18n/en-json-snapshot.test.ts tests/unit/newNav-settings-gear.test.tsx \
    tests/unit/reimagined-ask.test.tsx
 Test Files  133 passed (133)
      Tests  1070 passed (1070)
```

(Did NOT run full gate / cargo / Playwright / desktop — coordinator's job.)
