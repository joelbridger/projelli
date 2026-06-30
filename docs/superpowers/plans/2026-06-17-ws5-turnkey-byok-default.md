# WS5 — Turnkey Setup + BYOK-Frontier Default: Implementation Plan

> Parent: master plan WS5. Niche: litigation. In-app `src/` (rides the desktop release). Gates per task: `npm run typecheck` (0) + `npx vitest run` (green). Commit per task; do NOT push.

**Scoping (from recon):** BYOK-direct is ALREADY the technical default (`DEFAULT_CONFIDENTIALITY_MODE = 'direct'` in `src/platform/privacy/egress.ts`; telemetry off-by-default; keys in OS keychain). The gap is **positioning**: the onboarding AI-setup step undersells BYOK. The live onboarding orchestrator is **`GuidedOnboarding`** (App.tsx:960; the FirstRunWizard-is-live comment at App.tsx:116 is stale), and both orchestrators share `AiSetupStep`, so positioning changes there land on the live flow.

**Goal:** Make the BYOK-direct frontier path the unmistakable RECOMMENDED default, present local-model honestly as the maximum-privacy / lower-quality option (never co-equal for legal work), and keep config homework minimal. Mostly UI/copy.

## Global Constraints
- Honest, not dismissive: BYOK-frontier is recommended because it gives the best quality AND keeps data under the user's own key (no Advisor Prep Hero server). Local-model is genuinely more private but meaningfully less capable for legal drafting/analysis — say so plainly.
- **NO em dashes in any user-facing copy** (badges, headings, body). Use colons/periods.
- Don't change the technical default (already `direct`); this is presentation. Reuse `ui/kp` primitives.

---

### Task 1: Make BYOK the recommended default in `AiSetupStep` ChooseView
**Files:** `src/features/onboarding/AiSetupStep.tsx` (the ChooseView ~lines 171-198 + the LocalView), test `tests/unit/onboarding-ai-setup.test.tsx`.
- [ ] Re-order the three cards to **BYOK first, then Skip, then Local** (today it's Skip → BYOK → Local with Skip visually dominant).
- [ ] Give the **BYOK card** the prominent styling (the navy border + shadow currently on the Skip card) and change its badge from `"Recommended when ready"` to **`"Recommended for legal work"`** (drop the hedge).
- [ ] Change the **Local card** badge from `"Most private"` to **`"Maximum privacy. Less capable for legal work."`** and strengthen the LocalView heading/body: the quality trade-off must be in the heading/sub-heading, not buried (e.g. "Local models keep everything on your machine, but are meaningfully less capable for legal drafting and analysis than Claude or GPT. Most attorneys use their own cloud key."). Honest, plain.
- [ ] Keep the **Skip card** available (reducing friction is good) but render it last with lighter/secondary styling (no navy border/shadow).
- [ ] TDD: assert (a) the BYOK path card renders BEFORE the local path card in the DOM; (b) the BYOK badge text does NOT contain "when ready"; (c) the local card carries the quality caveat. Run the existing onboarding tests (must still pass). Green. Commit.

### Task 2: Add a "Recommended" indicator to the Direct card in Settings
**Files:** `src/features/settings/ConfidentialityModeSettings.tsx`, test.
- [ ] The Direct (BYOK) card has no recommended indicator though the schema says it's the default. Add a small `"Recommended"` badge (reuse the existing Badge primitive) to the Direct card. Keep the Local-only card's honest "most sensitive work" framing. TDD the badge appears on Direct. Green. Commit.

### Task 3: BYOK-first nudge in the AI-setup reminder
**Files:** `src/features/onboarding/AiSetupReminder.tsx` (or wherever the deferred-setup reminder copy lives), test.
- [ ] Update the reminder copy from the generic "connect a model whenever you are ready" to a BYOK-first nudge for the legal ICP: "Connect your Claude or OpenAI account for the best results on legal work. Local models are available but are less capable for legal analysis." No em dashes. TDD/snapshot the copy. Green. Commit.

### Task 4: Gates
- [ ] `npm run typecheck` (0) + `npx vitest run` (green, >= current 3170). Confirm the onboarding-copy-3-0 test + onboarding-ai-setup test still pass. Commit any test additions.

## Deferred (NOT in WS5)
- Removing the dead `FirstRunWizard` + fixing the stale App.tsx:116 comment: hygiene, deferred to the final code/git-cleanup pass (removal needs its own careful unused-confirmation; positioning changes here go in the SHARED `AiSetupStep`, so they land regardless).
- The "wedge first-value" guided flow: overlaps WS4's first-run email-search TTV (already built); not duplicated here.
- A telemetry opt-in onboarding surface: overlaps WS6 (design-partner diagnostics).

## Self-review
- Goal (b) BYOK-frontier recommended default + honest local framing → Tasks 1-3 (onboarding card, Settings, reminder). Goal (a) turnkey/low-config is already largely met (off-by-default telemetry, keychain, no-server-in-direct-mode); the remaining friction (AI key, Ollama for local) is inherent. Honest-framing constraint enforced in Task 1's copy. No em dashes. Rides the desktop release.
