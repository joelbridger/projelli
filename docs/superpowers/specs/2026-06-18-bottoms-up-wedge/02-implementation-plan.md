# "Start on your own" — Bottoms-up Wedge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Read first, in order:** `01-design-spec.md` (this folder), `~/keepance/CLAUDE.md` (esp. the model/effort policy + voice rules), `~/keepance/ARCHITECTURE.md` (the 5-layer DAG), and the named source files at the top of each phase. Jameson is **not a developer** — never surface raw stack traces to him; translate.

**Goal:** Turn Advisor Prep Hero into a bottoms-up wedge an individual can download and use safely on their own, that lands-and-expands into firm deals — without ever claiming "firm-compliant" or leaking client data by default.

**Architecture:** Extend existing surfaces, do not build new infrastructure. The crux is flipping the confidentiality default from `direct` (cloud) to a no-egress-until-informed-choice state for personal installs, then layering an honesty moment, a firm-ready security PDF, a solo→firm bridge, and frictionless paid-trial packaging on top. Firm-tier behavior must remain unchanged.

**Tech Stack:** React 18 + TypeScript (strict) + Zustand + Tailwind + shadcn/ui; Tauri 2; Vitest. Confidentiality lives in `src/platform/privacy/egress.ts` + settings store. No new deps expected.

**Gates (every phase ends green):** `npm run typecheck` = 0 · `npx vitest run` green · `npm run lint` introduces nothing new · the no-em-dash test passes on any user-facing string. Commit per task. Do **not** cut a build or deploy — that is Jameson's explicit go (commercial boundary).

---

## Phasing (by value + risk, lowest-risk first)

- **Phase 1 — Safe-by-default (the crux).** Personal installs never egress generated answers until an explicit, informed choice. Highest value, fully testable, no UI risk.
- **Phase 2 — The honest first-run moment.** Onboarding trust copy + the informed-choice screen.
- **Phase 3 — Security pack for the firm.** One-click firm-IT/GC PDF (extends the Data Map).
- **Phase 4 — Land-and-expand bridge.** Solo → firm workspace, carrying matters.
- **Phase 5 — Packaging + positioning.** Frictionless paid trial shaping + website "start on your own" angle, under the §6 ethical guardrail.

Each phase is independently shippable and leaves the app green. Phase 1 alone is worth shipping.

---

## Phase 1 — Safe-by-default: no generation egress until informed choice

**Context to load:** `src/platform/privacy/egress.ts` (the `ConfidentialityMode` type, `DEFAULT_CONFIDENTIALITY_MODE = 'direct'` at line ~65, `CONFIDENTIALITY_MODE_SETTING_KEY`), `src/platform/hooks/useConfidentialityMode.ts`, `src/features/ask/hooks/useChatSending.ts`, `src/features/ask/useAsk.ts`, `src/platform/hooks/useFirm.ts` (to detect firm installs). The model-send path is where egress actually happens; the goal is to block cloud generation when the user has not chosen.

**Design decision locked by the spec:** introduce a distinct "not yet chosen" state for personal installs rather than silently defaulting to `direct`. Implement it as an explicit unset marker so retrieval still works (always local) but cloud *generation* is blocked until a choice is recorded. Firm installs are unaffected.

### Task 1.1: Add a "confidentiality choice made" marker + personal-default resolver

**Files:**
- Modify: `src/platform/privacy/egress.ts`
- Create: `src/platform/privacy/resolvePersonalEgressDefault.ts`
- Test: `tests/unit/privacy/resolvePersonalEgressDefault.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/privacy/resolvePersonalEgressDefault.test.ts
import { describe, it, expect } from 'vitest';
import { resolveEffectiveEgress } from '@/platform/privacy/resolvePersonalEgressDefault';

describe('resolveEffectiveEgress (personal installs)', () => {
  it('blocks cloud generation when no choice has been made', () => {
    const r = resolveEffectiveEgress({ isFirm: false, storedMode: undefined, choiceMade: false });
    expect(r.allowCloudGeneration).toBe(false);
    expect(r.effectiveMode).toBe('local-only');
    expect(r.needsChoice).toBe(true);
  });

  it('honors an explicit cloud (direct) choice once made', () => {
    const r = resolveEffectiveEgress({ isFirm: false, storedMode: 'direct', choiceMade: true });
    expect(r.allowCloudGeneration).toBe(true);
    expect(r.effectiveMode).toBe('direct');
    expect(r.needsChoice).toBe(false);
  });

  it('honors an explicit local-only choice', () => {
    const r = resolveEffectiveEgress({ isFirm: false, storedMode: 'local-only', choiceMade: true });
    expect(r.allowCloudGeneration).toBe(false);
    expect(r.effectiveMode).toBe('local-only');
    expect(r.needsChoice).toBe(false);
  });

  it('firm installs keep their stored mode and never need the personal choice gate', () => {
    const r = resolveEffectiveEgress({ isFirm: true, storedMode: 'assured', choiceMade: false });
    expect(r.allowCloudGeneration).toBe(true);
    expect(r.effectiveMode).toBe('assured');
    expect(r.needsChoice).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/privacy/resolvePersonalEgressDefault.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the resolver + the marker constant**

```ts
// src/platform/privacy/resolvePersonalEgressDefault.ts
import type { ConfidentialityMode } from './egress';

/** Settings key recording that a personal user made an explicit confidentiality choice. */
export const CONFIDENTIALITY_CHOICE_MADE_KEY = 'confidentialityChoiceMade';

export interface EgressResolutionInput {
  isFirm: boolean;
  storedMode: ConfidentialityMode | undefined;
  choiceMade: boolean;
}

export interface EgressResolution {
  effectiveMode: ConfidentialityMode;
  allowCloudGeneration: boolean;
  needsChoice: boolean;
}

/**
 * Safe-by-default: a PERSONAL install never permits cloud answer generation
 * until the user has made an explicit, informed choice. Retrieval is always
 * local and unaffected. Firm installs keep their stored mode untouched.
 */
export function resolveEffectiveEgress(input: EgressResolutionInput): EgressResolution {
  if (input.isFirm) {
    const mode = input.storedMode ?? 'direct';
    return { effectiveMode: mode, allowCloudGeneration: mode !== 'local-only', needsChoice: false };
  }
  if (!input.choiceMade) {
    return { effectiveMode: 'local-only', allowCloudGeneration: false, needsChoice: true };
  }
  const mode = input.storedMode ?? 'local-only';
  return { effectiveMode: mode, allowCloudGeneration: mode !== 'local-only', needsChoice: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/privacy/resolvePersonalEgressDefault.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/platform/privacy/resolvePersonalEgressDefault.ts tests/unit/privacy/resolvePersonalEgressDefault.test.ts
git commit -m "feat(privacy): add personal-install safe-by-default egress resolver"
```

### Task 1.2: Record the choice from the confidentiality picker

**Files:**
- Modify: `src/platform/hooks/useConfidentialityMode.ts` (add a `useRecordConfidentialityChoice` setter that sets both the mode and `CONFIDENTIALITY_CHOICE_MADE_KEY = true`)
- Modify: `src/features/settings/ConfidentialityModeSettings.tsx` (selecting any mode records the choice)
- Test: `tests/unit/privacy/recordConfidentialityChoice.test.ts`

- [ ] **Step 1: Read** `useConfidentialityMode.ts` and `src/platform/settings/settingsStore.ts` to match the existing `getSetting`/`setSetting` pattern exactly.
- [ ] **Step 2: Write a failing test** asserting that recording a choice writes the mode AND sets `CONFIDENTIALITY_CHOICE_MADE_KEY` to `true` in the settings store (use the store's test utilities the same way `tests/unit/` siblings do).
- [ ] **Step 3:** Add `useRecordConfidentialityChoice()` to `useConfidentialityMode.ts` that calls `setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, mode)` and `setSetting(CONFIDENTIALITY_CHOICE_MADE_KEY, true)`.
- [ ] **Step 4:** Wire `ConfidentialityModeSettings.tsx` to call it instead of the bare setter.
- [ ] **Step 5:** Run `npx vitest run tests/unit/privacy/` → PASS. Commit `feat(privacy): record explicit confidentiality choice when a mode is chosen`.

### Task 1.3: Block cloud generation in the send path until choice is made

**Files:**
- Modify: `src/features/ask/hooks/useChatSending.ts` (and/or `src/features/ask/useAsk.ts` — read both; block at the point a cloud provider would be invoked)
- Test: `tests/unit/ask/no-egress-until-choice.test.ts`

- [ ] **Step 1: Read** `useChatSending.ts` end-to-end to find where the provider is resolved/invoked and where `useConfidentialityMode` / firm state are read.
- [ ] **Step 2: Write a failing test:** a personal install with `choiceMade=false` that attempts a send routes to the informed-choice gate (a `needsChoice` signal / callback) and does **not** call a cloud provider. Mock the provider and assert it was never called. Assert a firm install is unaffected.
- [ ] **Step 3: Implement:** before invoking a cloud provider, compute `resolveEffectiveEgress({ isFirm, storedMode, choiceMade })`; if `needsChoice`, surface the gate (emit the existing pattern the codebase uses to prompt the user — e.g. the same mechanism `AiSetupStep` uses) instead of sending; if `allowCloudGeneration` is false and the user picked local-only with no local model, show the "install a local model" guidance (reuse existing local-model messaging). **Never** silently fall back to cloud.
- [ ] **Step 4:** Run the test → PASS. Run the full Ask test suite → green.
- [ ] **Step 5:** Commit `feat(ask): block cloud generation on personal installs until an explicit confidentiality choice`.

### Task 1.4: Regression-lock retrieval-stays-local

**Files:**
- Test: `tests/unit/privacy/retrieval-never-egresses.test.ts`

- [ ] **Step 1:** Write a test asserting indexing/search/citation retrieval does not depend on `allowCloudGeneration` (retrieval works with `choiceMade=false`). Read `src/platform/rag/` to target the right entry point; assert the local path runs and no cloud provider is constructed.
- [ ] **Step 2:** Run → PASS (this should already hold; the test guards it). Commit `test(privacy): lock retrieval-stays-local invariant`.

**Phase 1 gate:** `npm run typecheck` 0 · full `npx vitest run` green · manual reasoning check against Success Criterion #1 in the spec.

---

## Phase 2 — The honest first-run moment

**Context to load:** `src/features/onboarding/GuidedOnboarding.tsx` (step 4 Trust = `DataMapContent`, step 5 AI key = `AiSetupStep`), `src/features/onboarding/AiSetupStep.tsx`, the copy in `03-copy-deck.md`.

### Task 2.1: Add the informed-choice screen to onboarding
- [ ] Read `GuidedOnboarding.tsx` + `AiSetupStep.tsx` to match the step/Frame pattern.
- [ ] Replace the implicit AI-key default with the explicit two-option informed choice from `03-copy-deck.md` §"Informed choice screen": **Local-only** vs **Cloud (BYOK)**, each with its plain-English consequence line. Selecting either calls `useRecordConfidentialityChoice` (Task 1.2). "Decide later" is allowed and leaves the app in no-egress state.
- [ ] Add the trust sentence from `03-copy-deck.md` §"Trust moment" near the Trust step, reusing `DataMapContent`.
- [ ] Tests: a component/state test that choosing an option records the choice and advances; "Decide later" advances without recording. Verify no em dashes (the lint test covers it).
- [ ] Commit `feat(onboarding): explicit informed confidentiality choice + honest trust moment`.

---

## Phase 3 — Security pack for the firm (one-click PDF)

**Context to load:** `src/platform/privacy/ui/DataMapDialog.tsx` (the print/PDF pattern + `DataMapContent`), `src/platform/privacy/egress.ts` (canonical facts), `src/features/privacy/PrivacyCenterHome.tsx` (entry point), `docs/trust/` + `docs/legal/` (DPA / SOC 2 status — use the REAL current status), `03-copy-deck.md` §"Security pack".

### Task 3.1: Build the firm security-pack document
- [ ] Read `DataMapDialog.tsx` to reuse its print-to-PDF mechanism and `DataMapContent`.
- [ ] Create `src/features/privacy/FirmSecurityPack.tsx`: a print-optimized document aimed at firm IT/GC, assembling (from real sources, no marketing language): what Advisor Prep Hero is, the architecture, `DataMapContent`, the three modes + exact per-mode egress, BYOK, the firm-tier security story (E2EE relay, SSO, ethical walls by key denial, DPA/SOC 2 **actual** status), and a "what to ask us" contact line. All copy from `03-copy-deck.md`.
- [ ] Add an entry point in `PrivacyCenterHome.tsx` (and/or Settings → Privacy): "Generate a security overview for my firm".
- [ ] Tests: renders without crashing; contains the per-mode egress facts; passes the no-em-dash + no-"guaranteed compliant" assertion (add a test that the string "guaranteed compliant" / "fully compliant" never appears).
- [ ] Commit `feat(privacy): one-click firm security pack (PDF) for IT/GC review`.

---

## Phase 4 — Land-and-expand bridge

**Context to load:** `src/features/firm/FirmAdminConsole.tsx`, `src/features/firm/FirmSignIn.tsx`, the onboarding "Invite firm" step, `src/features/account/AccountWindow.tsx`, `src/platform/matter/` (matter store + persistence, to carry local matters into a firm workspace).

### Task 4.1: "Use this with my firm" entry point + matter carry-over
- [ ] Read the firm onboarding + matter store to understand how a firm workspace is created/joined and how matters persist.
- [ ] Add a discoverable "Use this with my firm" action (Account window + a non-intrusive in-app spot) that routes a solo user into create-or-join-firm (reusing `FirmAdminConsole` / `FirmSignIn`).
- [ ] Ensure the solo user's existing local matters are available in/attachable to the firm workspace (specify and implement the attach path; do not duplicate data).
- [ ] Tests: the entry point routes correctly; a solo user's matters are visible after joining a firm workspace in a test harness.
- [ ] Commit `feat(firm): solo-to-firm bridge with matter carry-over`.

---

## Phase 5 — Packaging + positioning

**Context to load:** `src/features/account/trial/` (`TrialBanner`, `TrialStatusChip`), `src/platform/licensing/entitlements.ts`, `src/config/pricing.ts`, `website/` (landing pages), `03-copy-deck.md`, plus `feedback_marketing_copy_voice.md` + `reference_ai_writing_tells.md` + the no-em-dash rule for ALL website copy.

### Task 5.1: Shape the frictionless paid trial
- [ ] Read the trial + entitlements code to confirm current trial length + gating.
- [ ] Set the trial to: no credit card, no account, full features, **personal no-egress default** (Phase 1), generous length (default 30 days unless Jameson sets otherwise — see spec §7). Update `TrialBanner`/`TrialStatusChip` copy accordingly.
- [ ] Add a solo license-recovery affordance (recovery code re-entry, no account) per spec §5.1 — read `src/platform/hooks/useLicense.ts` + the license-validator contract first; if recovery already exists, just surface it.
- [ ] Tests: trial length + no-account assertions; recovery-code path.
- [ ] Commit `feat(account): frictionless generous paid trial + solo license recovery`.

### Task 5.2: Website "start on your own" positioning (under the §6 guardrail)
- [ ] Read `website/` landing structure + the voice rules.
- [ ] Add the "Private AI for your practice you can start using today, on your own — no IT ticket required" angle, immediately qualified by the honest framing from `03-copy-deck.md` §"Website" so it never reads as "sneak it past your firm". Link to the security pack concept ("get it firm-approved when you're ready").
- [ ] Verify: no em dashes, no AI-writing tells, no "guaranteed compliant", upholds spec §6. Do **not** deploy (Jameson's go).
- [ ] Commit `feat(website): "start on your own" bottoms-up positioning (not deployed)`.

---

## Self-review (completed by plan author)

- **Spec coverage:** Change 1 → Phase 1; Change 2 → Phase 2; Change 3 → Phase 3; Change 4 → Phase 4; Change 5 → Phase 5. §5 details mapped (5.1 → Task 5.1; 5.2 → Task 1.4; 5.3 → Task 3.1 test; 5.4 → Task 1.1 firm-branch test). §6 guardrail → enforced by tests in 3.1/5.2 (no "guaranteed compliant") and review in 2.1/5.2. Success criteria → Phase 1 gate + 3.1 + 4.1 + 5.1.
- **Placeholder scan:** UI-heavy tasks (2.1, 3.1, 4.1, 5.x) intentionally start with a "read these exact files" step because their precise code depends on internal patterns not fully resolvable from outside; this is an accurate instruction, not a TBD. Phase 1 (the crux + the testable logic) carries complete code.
- **Type consistency:** `resolveEffectiveEgress`, `EgressResolution`, `CONFIDENTIALITY_CHOICE_MADE_KEY`, `useRecordConfidentialityChoice` are named consistently across tasks.

## Landmines / gotchas (from the codebase)
- **No silent cloud fallback** is a hard rule (`CLAUDE.md`). Phase 1 must never auto-egress.
- **Firm installs must be byte-for-byte unchanged.** Always branch on `isFirm` (`useFirm`).
- **Locked tier codes** `personal|professional|practice` — never rename (license + backend depend on them).
- **Voice rules apply to every user-facing string** (no em dashes — there's a test; no "leverage/seamless/transform"; first-person; the AI-writing-tells list). The security pack + trust copy must read as honest legal-grade prose, not marketing.
- **Do not cut a build or deploy.** Commercial boundary — Jameson's explicit go only.
- **Parallel-agent worktree gotcha:** after any parallel batch, re-check `git status` + grep distinctive markers; a stray agent worktree has bitten this repo before.
