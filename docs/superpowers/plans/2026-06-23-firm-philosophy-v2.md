# Firm Philosophy (Client Map v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Read first, in order:** [`../specs/2026-06-22-client-map/03-firm-philosophy-v2-design.md`](../specs/2026-06-22-client-map/03-firm-philosophy-v2-design.md) (the approved design), the v1 [`01-design-spec.md`](../specs/2026-06-22-client-map/01-design-spec.md), `~/keepance/CLAUDE.md` (model/effort + voice + no-shortcuts), and `~/keepance/ARCHITECTURE.md`.
>
> **Sequencing:** This touches the desktop app (`src/`) AND the firm backend (`backend/`). It does not conflict with current work once the BUG-099 branch is merged (BUG-099 touches `src-tauri/rag` + the rag UI; Firm Philosophy touches `clientMap` + `firm` + `backend`). Branch off the latest `keepance-3.0`. **The backend deploy is a commercial boundary — build + test it, but do NOT deploy `api.keepance.com` without Jameson's explicit go.**

**Goal:** Let a firm admin author standard sections + a guidance note + standard intake questions ("Firm Philosophy") that distribute to members and apply to every firm matter's Client Map as a baseline each lawyer builds on.

**Architecture:** Mirror the existing SSO org-config feature: an admin-only backend config record (new non-encrypted table), distributed to members inside the `/auth/me` org payload that sign-in already fetches. The desktop app stores it in the firm session, threads the guidance note into Client Map generation, generates `scope:'firm'` sections, and seeds firm intake questions into the Guided Interview. Authoring UI is a new `FirmAdminConsole` section copied from the SSO section.

**Tech Stack:** React 18 + TS (strict) + Zustand (desktop); the firm backend (`backend/` — its existing Hono/SQLite-style stack); Vitest + cargo unaffected.

## Global Constraints

- **Matter isolation** unchanged: generation stays `{ kind:'matter', matterId }`; Firm Philosophy is firm config, never another client's data.
- **Approve-first:** firm-section population on change flows through `proposeUpdates` → the review tray; user-origin items are never overwritten.
- **No silent cloud egress:** generation respects `isLocalOnlyMode()` + `assertCloudGenerationAllowed()` exactly as v1 (reuse `buildProviderForClientMap`).
- **Firm config, never client content:** the philosophy rides the firm config/`me()` path; NEVER the E2EE matter relay; a member's client content is never sent to the firm.
- **"Stores and applies," never "learns";** admin-only authoring, members read-only; firm-installs-only (branch on active seat); solo byte-for-byte unchanged.
- **Voice:** NO em dashes in any user-facing string (test-enforced); no AI tells; never "compliant"/"guaranteed"; locked name "Firm Philosophy".
- **Gates per task:** `npm run typecheck` = 0 · scoped `npx vitest run` · `node scripts/eslint-gate.mjs` adds ZERO new (NEVER `--update-baseline`); backend uses its own test runner. `npm run gate` before merge.
- **No deploy** (backend or app) without Jameson's explicit go.

---

## Phase A — Types + the FirmPhilosophy model

### Task A1: Add `'firm'` scope + the `FirmPhilosophy` type

**Files:**
- Modify: `src/platform/clientMap/types.ts` (`SectionScope` line ~6)
- Create: `src/platform/clientMap/firmPhilosophy.ts`
- Test: `tests/unit/clientMap/firmPhilosophy-types.test.ts`

**Interfaces:**
- Produces: `SectionScope = 'matter' | 'personal-template' | 'firm'`; and
  ```ts
  export interface FirmPhilosophy {
    sections: CustomCategoryTemplate[];   // each scope:'firm'
    guidanceNote: string;                 // "" when unset
    intakeQuestions: GapQuestion[];       // { text, sectionKey }
    updatedAt: string;
    version: number;
  }
  export const EMPTY_FIRM_PHILOSOPHY: FirmPhilosophy;
  ```

- [ ] **Step 1: Write the failing test** asserting `EMPTY_FIRM_PHILOSOPHY` has empty sections/note/questions and `version: 0`, and that a `CustomCategoryTemplate` accepts `scope: 'firm'` (type-level: construct one in the test).
- [ ] **Step 2: Run** `npx vitest run tests/unit/clientMap/firmPhilosophy-types.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement.** Change `SectionScope` to include `'firm'`. Create `firmPhilosophy.ts`:
  ```ts
  import type { CustomCategoryTemplate, GapQuestion } from './types';
  export interface FirmPhilosophy {
    sections: CustomCategoryTemplate[];
    guidanceNote: string;
    intakeQuestions: GapQuestion[];
    updatedAt: string;
    version: number;
  }
  export const EMPTY_FIRM_PHILOSOPHY: FirmPhilosophy = {
    sections: [], guidanceNote: '', intakeQuestions: [], updatedAt: '', version: 0,
  };
  ```
- [ ] **Step 4: Run** the test → PASS. `npm run typecheck` → 0 (fix any `SectionScope` exhaustiveness fallout — search usages).
- [ ] **Step 5: Commit** `feat(clientMap): add 'firm' scope + FirmPhilosophy type` (co-author trailer).

---

## Phase B — Backend: store + distribute firm config (mirror SSO)

> Mirror the SSO org-config triplet exactly. It is the proven, admin-gated, org-keyed settings pattern. No encryption (this is non-secret config, unlike the SSO `client_secret_enc`).

### Task B1: Backend table + store methods

**Files (in `backend/`):**
- Modify: `backend/src/lib/db.ts` (add table mirroring `org_idp_config` schema ~line 287; add Store methods mirroring `getOrgIdpConfig` ~1498 / `upsertOrgIdpConfig` ~1525)
- Test: backend store test (mirror the existing `org_idp_config` store test)

- [ ] **Step 1: Read** `db.ts` around the `org_idp_config` table (line ~287) and `getOrgIdpConfig`/`upsertOrgIdpConfig` (lines ~1498-1561) to copy the exact pattern.
- [ ] **Step 2: Write a failing backend test** (mirror the org_idp_config store test): upsert a `firm_philosophy` JSON blob for an org, get it back; get for an org with none returns null/default.
- [ ] **Step 3: Implement** a `org_firm_philosophy` table (PK `org_id`, a `config_json TEXT`, `updated_at`) + `getFirmPhilosophy(orgId)` / `upsertFirmPhilosophy(orgId, config)` Store methods. No encryption.
- [ ] **Step 4: Run** the backend test → PASS.
- [ ] **Step 5: Commit** `feat(backend): org firm-philosophy config store` (co-author trailer).

### Task B2: Backend routes (admin write, member read) + me() distribution

**Files (in `backend/`):**
- Create/modify: a route handler mirroring `backend/src/routes/sso.ts` (handlers ~lines 42-96, `requireAdminClaims` ~line 31)
- Modify: `backend/src/routes/auth.ts` (`handleMe` ~line 68 — include philosophy in the org payload)
- Modify: `backend/src/server.ts` (register routes ~line 176), `backend/src/contract.ts` (`MeResponse.org` ~lines 41-50; endpoint paths)
- Test: backend route tests (mirror the SSO route tests)

- [ ] **Step 1: Read** `sso.ts` (the get/set/delete handlers + `requireAdminClaims`), `auth.ts` `handleMe`, and `contract.ts` `MeResponse`.
- [ ] **Step 2: Write failing route tests:** (a) an admin can PUT the firm philosophy and GET it; (b) a non-admin PUT is rejected (403); (c) `GET /auth/me` for a member returns the org's firm philosophy in the org payload.
- [ ] **Step 3: Implement:** a `handleFirmPhilosophyGet` (authenticate only — members read) + `handleFirmPhilosophySet` (`requireAdminClaims`), backed by Task B1's store. Extend `handleMe` to attach the philosophy to the org block. Register routes in `server.ts`; add the endpoint paths + `MeResponse.org` field in `contract.ts`.
- [ ] **Step 4: Run** the backend tests → PASS.
- [ ] **Step 5: Commit** `feat(backend): firm-philosophy admin write + member-read via /auth/me` (co-author trailer). NOTE: do NOT deploy the backend (Jameson's go).

---

## Phase C — Desktop transport + session distribution

### Task C1: Client contract + FirmApiClient + firm session slot

**Files:**
- Modify: `src/platform/firm/contract.ts` (`MeResponse.org` + endpoint paths in `FIRM_ENDPOINTS` ~line 494; add the `FirmPhilosophy` wire type)
- Modify: `src/platform/firm/FirmApiClient.ts` (add `firmPhilosophyGet()` / `firmPhilosophySet(config)` mirroring `ssoConfigGet`/`ssoConfigSet` ~lines 519-537)
- Modify: `src/platform/firm/firmStore.ts` (`FirmOrg` ~line 60 + `PersistedFirmSession` ~line 69 gain an optional `firmPhilosophy`; populate it in `establishSessionFromLogin` ~line 151 from `me.org`)
- Test: `tests/unit/firm/firm-philosophy-session.test.ts`

**Interfaces:**
- Consumes: `FirmPhilosophy` (A1).
- Produces: `useFirmStore().session.org.firmPhilosophy?: FirmPhilosophy`; `FirmApiClient.firmPhilosophyGet/Set`; a selector `selectFirmPhilosophy(state): FirmPhilosophy` (returns `EMPTY_FIRM_PHILOSOPHY` when none / not a firm).

- [ ] **Step 1: Read** `FirmApiClient.ssoConfigGet/Set` (~519-537), `firmStore.establishSessionFromLogin` (~151), `contract.ts` `MeResponse`/`FIRM_ENDPOINTS`.
- [ ] **Step 2: Write a failing test:** establishing a session from a `me()` payload that carries an org `firmPhilosophy` stores it; `selectFirmPhilosophy` returns it; for a solo/no-seat state it returns `EMPTY_FIRM_PHILOSOPHY`.
- [ ] **Step 3: Implement** the contract type + endpoint paths, the two `FirmApiClient` methods, the `FirmOrg`/session slot + population, and `selectFirmPhilosophy`.
- [ ] **Step 4: Run** the test → PASS; `npm run typecheck` → 0.
- [ ] **Step 5: Commit** `feat(firm): distribute firm philosophy via session + client methods` (co-author trailer).

---

## Phase D — Apply it during Client Map generation + interview

### Task D1: Thread the guidance note + firm sections + intake questions into generation

**Files:**
- Modify: `src/platform/clientMap/generator.ts` (`buildClientMap` ~line 65; `sectionPrompt` ~line 59; the gap prompt ~96-99)
- Modify: `src/platform/clientMap/guidedInterview.ts` (`interviewQuestions` ~line 20)
- Create: `src/platform/clientMap/firmPhilosophyApply.ts` (pure helpers, easily testable)
- Test: `tests/unit/clientMap/firmPhilosophyApply.test.ts`

**Interfaces:**
- Consumes: `selectFirmPhilosophy` (C1), `FirmPhilosophy` (A1), `buildCustomSection` (`customSection.ts`), `buildProviderForClientMap`.
- Produces:
  - `applyGuidanceToPrompt(basePrompt: string, guidanceNote: string): string` (appends the firm note as an instruction block when non-empty; returns basePrompt unchanged when empty)
  - `firmIntakeGaps(philosophy: FirmPhilosophy): GapQuestion[]`
  - generation now produces firm `scope:'firm'` sections (non-deletable flag) alongside core sections.

- [ ] **Step 1: Write failing tests** for `applyGuidanceToPrompt` (empty note → unchanged; non-empty → contains the note as a labeled instruction, NO em dashes) and `firmIntakeGaps` (maps `intakeQuestions` to `GapQuestion[]`, deduped by normalized text).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `firmPhilosophyApply.ts`. Then wire `buildClientMap`: read `selectFirmPhilosophy(useFirmStore.getState())`; when on a firm matter with an active seat, (a) `sectionPrompt`/gap prompt are wrapped with `applyGuidanceToPrompt(..., guidanceNote)`, (b) generate a `scope:'firm'` section per firm `sections` entry (reuse `buildCustomSection`, then set `scope:'firm'`), (c) merge `firmIntakeGaps(...)` into the `ask` list. Mark firm sections non-deletable (a `scope:'firm'` check the UI honors). Solo/no-seat → no change (guard so v1 behavior is identical).
- [ ] **Step 4: Run** tests → PASS; run the full clientMap suite → green.
- [ ] **Step 5: Commit** `feat(clientMap): apply firm philosophy in generation + interview` (co-author trailer).

### Task D2: Approve-first on philosophy change + non-deletable firm sections in UI

**Files:**
- Modify: `src/features/matters/ClientMapView.tsx` (hide/disable the delete control for `scope:'firm'` sections; label them firm-standard)
- Modify: `src/platform/clientMap/updater.ts` if needed (ensure a newly-added firm section is proposed via `proposeUpdates`, not force-applied)
- Test: `tests/unit/matters/clientmap-firm-sections.test.tsx`

- [ ] **Step 1: Read** `ClientMapView.tsx` (the section render + delete control) and `updater.ts` `proposeUpdates`/`mergePendingUpdates`.
- [ ] **Step 2: Write a failing test:** a `scope:'firm'` section renders a "firm standard" marker and NO delete control; a member-added section still has delete; adding a firm section to an existing map yields a proposed update (tray), not a silent overwrite; user-origin items untouched.
- [ ] **Step 3: Implement** the UI guard + confirm the updater proposes firm sections through the tray (reuse v1 approve-first; no new overwrite path).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(clientMap): firm sections are non-deletable + arrive approve-first` (co-author trailer).

---

## Phase E — Admin authoring UI + read-only member view

### Task E1: Firm Philosophy admin panel (mirror the SSO section)

**Files:**
- Modify: `src/features/firm/FirmAdminConsole.tsx` (add a `<Section>` mirroring the SSO section ~lines 733-931; gate writes on `firm.role === 'admin'` per its existing pattern ~line 124/384)
- Modify: `src/locales/{en,de,es}.json` (+ `tests/unit/i18n/en-json-snapshot.test.ts` counts) under `firm.admin.philosophy.*`
- Test: `tests/unit/firm/firm-philosophy-admin.test.tsx`

- [ ] **Step 1: Read** the SSO `<Section>` in `FirmAdminConsole.tsx` (~733-931) — the load-on-mount, edit fields, Save/Remove via the authed client, `run(...)` wrapper, i18n pattern. This is your template.
- [ ] **Step 2: Write a failing component test:** an admin sees editors for standard sections (add/edit/remove), the guidance note (textarea), and intake questions (ordered list); Save calls `FirmApiClient.firmPhilosophySet` with the assembled `FirmPhilosophy`; a non-admin (`firm.role==='member'`) sees a READ-ONLY view (no Save). Assert no em dashes in the new strings.
- [ ] **Step 3: Implement** the panel + the read-only member view, all strings via the new i18n keys (kebab-case, en/es/de) + bump the snapshot count.
- [ ] **Step 4: Run** → PASS; `node scripts/eslint-gate.mjs` clean.
- [ ] **Step 5: Commit** `feat(firm): Firm Philosophy admin authoring + read-only member view` (co-author trailer).

---

## Phase F — Integration + gate

### Task F1: Whole-feature gate + review

- [ ] **Step 1:** `npm run typecheck` → 0.
- [ ] **Step 2:** `npx vitest run tests/unit/clientMap tests/unit/firm tests/unit/matters tests/unit/i18n` → green; backend test suite → green.
- [ ] **Step 3:** `node scripts/eslint-gate.mjs` → ZERO new (fix in code, never `--update-baseline`).
- [ ] **Step 4:** `npm run gate` (full) → green. Coordinate so no other session compiles Rust concurrently.
- [ ] **Step 5:** Whole-branch Codex review (`codex-task --read-only` on `git diff keepance-3.0...HEAD`): confirm matter isolation intact, firm config never on the relay, no silent egress, approve-first + sovereignty preserved, admin-only writes enforced backend-side, solo unchanged, no em dashes. Address findings.
- [ ] **Step 6:** Real-app verification on the Legion Windows bench (firm matter shows firm sections; guidance applied; member read-only) — per `reference_keepance_desktop_control`. NOTE: full firm-tier behavior needs a firm seat; exercise what's reachable + rely on unit/integration tests for the rest. Do NOT deploy the backend.

---

## Self-review (completed by plan author)

- **Spec coverage:** decision 1 (Firm Philosophy) → whole plan; decision 2 (baseline + freedom) → D1 (firm sections always generated) + D2 (non-deletable); decision 3 (all three components) → D1 (sections, guidance note, intake questions) + E1 (authoring all three); decision 4 (admin sets) → B2 (`requireAdminClaims`) + E1 (UI gate); decision 5 (approve-first on change) → D2. §4 storage (firm config via me(), not relay) → B1/B2/C1. §6 hard rules → Global Constraints + F1 review. §8 testing → A1/B/C1/D/E1 tests.
- **Placeholder scan:** logic/type tasks (A1, C1, D1) carry complete code/contracts; backend (B1/B2) and UI (D2/E1) follow the repo precedent with explicit "read + mirror the SSO config triplet / SSO section at these exact anchors" steps + concrete test contracts (the precise code mirrors existing, proven code — accurate instruction, not a TBD).
- **Type consistency:** `FirmPhilosophy`, `EMPTY_FIRM_PHILOSOPHY`, `selectFirmPhilosophy`, `applyGuidanceToPrompt`, `firmIntakeGaps`, `SectionScope = 'matter'|'personal-template'|'firm'` are consistent across tasks.

## Landmines / gotchas

- **Backend deploy is a commercial boundary** — build + test the backend changes, but `api.keepance.com` deploy needs Jameson's explicit go.
- **Build AFTER BUG-099 merges** to avoid churn; branch off the latest `keepance-3.0`.
- **Firm config is NEVER client content** — it rides `/auth/me`/config, never the E2EE matter relay. A member's client content never goes to the firm.
- **Guard generation on active seat** so solo behavior is byte-for-byte unchanged.
- **i18n:** new keys kebab-case across en/es/de + bump the snapshot count; never `i18n:extract`.
- **eslint-gate runs separately**, never `--update-baseline`.
