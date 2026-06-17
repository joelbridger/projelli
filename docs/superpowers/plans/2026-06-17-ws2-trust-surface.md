# WS2 — Trust as a Visible Product Surface: Implementation Plan

> Parent: `docs/strategy/2026-06-17-keepance-master-plan.md` (WS2). Niche: litigation solo/small-firm. Recon map (read for exact signatures): the WS2 reconnaissance captured the egress logic, Data Map, confidentiality modes, audit log, and shell-routing patterns. Execute subagent-driven; gates per task: `npm run typecheck` (0) + `npx vitest run` (green). No production deploy without explicit go (already granted for this program).

**Goal:** Turn the trust story from a feature into a screenshot-worthy, demo-able product surface: (a) a full-screen **"Where your data is" Privacy Center**, and (b) a one-click, printable, per-matter **"Confidentiality Report"** a lawyer can keep in the client file ("this matter's AI ran locally / under your own key; nothing was disclosed to a third-party Keepance server").

**Architecture:** Reuse the existing, tested primitives — `resolveEgress` (`src/platform/privacy/egress.ts`), `DATA_MAP_ROWS`/`DataMapContent` (`src/platform/privacy/ui/DataMapDialog.tsx`), the audit log (`src/platform/audit/AuditService.ts`), and the matter store. Add (1) matter scope to the `egress` audit event, (2) a pure report-assembler, (3) a printable report component, (4) a new `privacy` shell surface following the `AuditHome` pattern.

**Tech stack:** React 18 + TS, Zustand, vitest. Print via the DataMapDialog hidden-iframe pattern. `ui/kp/` primitives + inline `--kp-*` CSS vars.

## Global Constraints
- Honesty is the asset: never claim SOC 2 / signed DPA as delivered (roadmap only). The report must state the BYOK-direct nuance truthfully (data goes to the user's own provider under their key; only local-only mode means "nothing leaves").
- No em dashes in user-facing copy. Locked identifiers unchanged.
- Reuse `DATA_MAP_ROWS` as the canonical claim registry; do not duplicate claims.

---

### Task 1: Add matter scope to the `egress` audit event (closes recon Gap 1)
**Files:** `src/platform/types/audit.ts` (egress event payload ~line 313), `src/features/ask/hooks/useChatSending.ts` (where the egress event is logged, ~line 549/558), test `tests/unit/audit-provenance-events.test.tsx`.
- [ ] Add optional `scope?: AuditScope` to the `egress` event payload type.
- [ ] At the egress-log call site, pass `getActiveScope()` (from `@/platform/matter/matterStore`).
- [ ] Extend the audit-provenance test to assert the `egress` event now carries `scope` matching the active matter. Run it → green. Commit.
- **Produces:** `egress` audit entries with `scope`, so the report assembler correlates per-matter without fragile timestamp matching.

### Task 2: The Confidentiality Report assembler (pure function — closes Gap 2)
**Files:** Create `src/platform/privacy/confidentialityReport.ts`; test `tests/unit/privacy/confidentialityReport.test.ts`.
- [ ] `buildConfidentialityReport(entries: AuditEntry[], opts: { matterId: string | null; matterName: string; generatedAt: string }): ConfidentialityReport` — group the matter's AI sends, and for each summarize `{ at, model, provider, mode, destination, dataLeaves }` from the correlated `egress`/`model_call`/`scope_active` entries; compute rollups (`totalCalls`, `byMode`, `anyDataLeftMachine`, `allUnderOwnKeyOrLocal`). `generatedAt` passed in (no `Date.now()` in pure code).
- [ ] Define `ConfidentialityReport` type (summary + per-call rows + the honest attestation sentence chosen by mode mix).
- [ ] TDD: fixtures for all-local, all-BYOK-direct, mixed, and assured; assert the attestation text + rollups. Green. Commit.
- **Produces:** `buildConfidentialityReport`, `ConfidentialityReport` — consumed by Task 3.

### Task 3: The printable Confidentiality Report artifact
**Files:** Create `src/platform/privacy/ui/ConfidentialityReportDialog.tsx`; test `tests/unit/privacy/ConfidentialityReportDialog.test.tsx`.
- [ ] A dialog/printable that renders a `ConfidentialityReport`: matter name, generated date, the attestation sentence, the per-call table, and a footer referencing the architecture (Florida Bar Op. 24-1 / no third-party-Keepance). Reuse the DataMapDialog hidden-iframe `handlePrint` pattern (printableId `keepance-confidentiality-report-printable`). `data-testid="confidentiality-report"`.
- [ ] Honest copy: if any call left the machine (BYOK-direct/assured), say so plainly (to the user's own provider under their key, no Keepance content server); only claim "nothing left this machine" when all calls were local-only.
- [ ] Test: render with each fixture, assert the attestation + row count. Green. Commit.

### Task 4: The "Where your data is" Privacy Center surface (closes Gap 3)
**Files:** `src/app/lifecycle/useGlobalEventBus.ts` (add `'privacy'` to `AppSurface`), `src/app/shell/layout/Spine.tsx` (nav item + content slot + `SpineProps`), `src/app/shell/AppSurfaceRouter.tsx` (route case + props), `src/App.tsx` (pass audit entries + active matter), create `src/features/privacy/PrivacyCenterHome.tsx`; test `tests/unit/privacy/PrivacyCenterHome.test.tsx`.
- [ ] `PrivacyCenterHome` (follow the `AuditHome` template): a `SurfaceHeader` ("Where your data is"), the live egress status (current mode + what it means, via `resolveEgress`/`useConfidentialityMode`), the embedded `DataMapContent variant="expanded"`, and a "Confidentiality Report for this matter" action that opens `ConfidentialityReportDialog` for the active matter (built from `auditService.query(...)`).
- [ ] Wire the new surface into the shell (the documented 4-file change). Add a `ShieldCheck` nav item.
- [ ] Test: surface renders, mode reflects settings, the report button opens the dialog. Green. Commit.

### Task 5: Discoverability + demo polish
**Files:** `src/app/shell/layout/TrustBar.tsx` (the egress indicator's shell home), maybe `src/features/settings/PrivacySettings.tsx`.
- [ ] Make the TrustBar's Data Map affordance also offer "Open Privacy Center" (dispatch the surface-open event), so the trust story is one click from anywhere. Keep the existing Data Map dialog too.
- [ ] Verify full gates: `npm run typecheck` (0) + `npx vitest run` (green). Commit.

## Self-review
- Gap 1 (scope on egress) → Task 1. Gap 2 (assembler) → Task 2. Gap 3 (surface) → Task 4. Report artifact → Task 3. Discoverability → Task 5.
- Honesty constraint enforced in Tasks 2-3 (attestation text varies by mode; never overclaims).
- Reuses tested primitives (resolveEgress, DATA_MAP_ROWS, DataMapContent, audit query) rather than reinventing.
- The in-app changes here (the trust surface + report) ride the next desktop release (task #8).
