# WS6 — Learning Loop + Pricing Presentation: Implementation Plan

> Parent: master plan WS6. In-app `src/` + one website edit. Gates per task: `npm run typecheck` (0) + `npx vitest run` (green). Commit per task; do NOT push. (The financial-model rebuild is a separate strategy doc the orchestrator writes; not in this build.)

**Scoping (from recon):** Telemetry is off-by-default (`useTelemetryConsent`, tri-state `'unset'`), 5 lifecycle events only, gated hard in `telemetry.ts`; `PrivacySettings` is the toggle; `installId` has no PII; the `AuditService` is a rich LOCAL-only log. No design-partner mode exists. Pricing is data-driven from `pricing.ts` (`PRICING_TIERS` order Solo/Pro/Firm; only `professional` is `featured`); `PricingTiers.tsx` renders it; `website/index.html` is a manual parallel.

**Goal:** (a) an explicitly OPT-IN, user-visible, structure-only **design-partner diagnostics** mode so we can learn from the first lawyers without breaking the no-telemetry-by-default promise; (b) **solo-first** pricing presentation; (c) fill the telemetry-consent test gap.

## Global Constraints
- **Diagnostics is strictly opt-in (default off), user-visible, and STRUCTURE-ONLY: never send content, file names, matter names, prompt text, or email bodies.** Only counts/enums (feature used, workflow template id, search count, error component+code, onboarding step, matter count, provider name). It must be reflected HONESTLY in the printable Data Map and PrivacySettings, and must keep the existing "no telemetry by default" claims true.
- No em dashes in user-facing copy. Don't touch the existing telemetry events/endpoint. Don't remove the Firm tier (wire codes are stable) — only de-emphasize visually.

---

### Task 1: The design-partner diagnostics core (opt-in, structure-only)
**Files:** create `src/platform/hooks/useDesignPartnerConsent.ts` (mirror `useTelemetryConsent.ts`, key `keepance_design_partner_consent`, tri-state, default off, cross-tab event); create `src/platform/utils/diagnostics.ts` (`sendDiagnosticEvent(event, fields)` gated on `getDesignPartnerConsent() === 'enabled'`, posts to the forms endpoint with `source: 'design-partner'`, reusing `installId`/`app_version`/`platform`; STRUCTURE-ONLY payloads); test `tests/unit/diagnostics.test.ts`.
- [ ] Define the allowed event set as a typed union: `feature_used` (`{ feature: 'ask'|'workflow'|'search'|'dictation'|'email_import' }`), `workflow_run` (`{ templateId }`), `search_count` (`{ count }`), `error_caught` (`{ component, code }`), `onboarding_step` (`{ step }`), `matter_count` (`{ count }`), `provider_connected` (`{ provider }`). The TYPES must make it impossible to pass content (no free-text body field). TDD: `sendDiagnosticEvent` is a no-op unless consent is `'enabled'`; payload contains only structural fields; no content leaks. Green. Commit.

### Task 2: Wire a few capture points (minimal, structural)
**Files:** the Ask send path (`useChatSending.ts` / `useAsk.ts`), workflow runner (`useWorkflowRunner.ts`), email search (`EmailWorkspace.tsx`), provider-connect (onboarding `AiSetupStep`).
- [ ] Add `sendDiagnosticEvent('feature_used', { feature })` at: an Ask/chat send, a workflow run (+ `workflow_run` with templateId), an email search, and `provider_connected` on key setup. All are fire-and-forget but gated (and use the WS7 floating-promise-safe `void ...catch` pattern). No content captured. TDD that the calls fire only when consent enabled. Green. Commit.

### Task 3: PrivacySettings card + Data Map row + i18n (honest disclosure)
**Files:** `src/features/settings/PrivacySettings.tsx`, `src/platform/privacy/ui/DataMapDialog.tsx` (add a `MapRow`), `src/locales/{en,de,es}.json` (new `settings.privacy.design-partner.*` keys + hashes for de/es).
- [ ] Add a "Design-partner diagnostics" card BELOW the telemetry card: explicit framing ("You are among the first lawyers using Advisor Prep Hero in practice. With this on, Advisor Prep Hero sends structured usage counts only: which features you use and where you get stuck. Never your content, file names, matter names, or prompts. Off by default; turn it off any time."), an itemized "what is sent, exactly" list, and a toggle (default off). Add a `DATA_MAP_ROWS` entry stating the same honestly (it is printable; keep it on the right side of the promise). Keep the existing "no telemetry by default" copy TRUE (both telemetry and diagnostics default off). TDD the card renders + toggles + the DataMap row exists. Green. Commit.

### Task 4: Solo-first pricing presentation
**Files:** `src/config/pricing.ts` (the `featured` flags + a new optional `dimmed?: boolean`), `src/features/settings/PricingTiers.tsx` (dimmed treatment + badge copy), `website/index.html` (lines ~574-626 pricing cards — manual mirror), `tests/unit/pricing-config.test.tsx`.
- [ ] In `pricing.ts`: set `personal.featured = true`, `professional.featured = false`, add `dimmed?: boolean` to the `PricingTier` type and set `practice.dimmed = true`. In `PricingTiers.tsx`: the featured (Solo) card gets the prominent treatment + a "Start here" badge; Professional keeps a lighter "More features" label; the `dimmed` (Firm) card renders muted (e.g. `opacity-80`) with an honest sublabel ("For growing firms; SSO and co-editing included, SOC 2 and DPA on the roadmap"). DON'T remove any tier. Mirror in `website/index.html` (move the `featured` class to the Solo card, adjust badges). Update `pricing-config.test.tsx` (assert `personal.featured === true`, `practice.dimmed === true`). No em dashes. Green. Commit. *(Note: the website edit needs a `bash infra/deploy.sh` after merge — orchestrator handles.)*

### Task 5: Telemetry-consent test coverage (fill the gap) + gates
**Files:** `tests/unit/telemetry-consent.test.ts` (new); gates.
- [ ] Add the missing unit coverage: `useTelemetryConsent` tri-state read/write + the cross-tab event; `sendEvent` no-op unless `'enabled'` + payload shape; the `PrivacySettings` telemetry toggle. (This guards the promise the trust story depends on.) `npm run typecheck` (0) + `npx vitest run` (green, >= current 3182). Commit.

## Self-review
- (a) learning loop → Tasks 1-3 (opt-in, structure-only, honestly disclosed). (b) solo-first → Task 4 (in-app + website). (c) test gap → Task 5.
- Honesty/no-telemetry promise preserved: diagnostics is default-off + structure-only + in the printable Data Map. Firm tier de-emphasized, not removed. No em dashes. In-app rides the desktop release; the website pricing edit deploys via `infra/deploy.sh`.
