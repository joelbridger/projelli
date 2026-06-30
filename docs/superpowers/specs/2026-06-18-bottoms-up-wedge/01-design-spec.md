# Design Spec — "Start on your own": the bottoms-up wedge + firm land-and-expand

**Date:** 2026-06-18
**Status:** Approved (design greenlit by Jameson 2026-06-18). Ready for implementation planning.
**Branch:** `keepance-3.0`
**Origin:** A meeting with Sam Andersen (Investment Partner, Element Ventures, a top Utah pre-seed fund) on 2026-06-18. Sam's key product steer: *"If you can get it so someone can download and use it on their own — without the firm having to approve it first — that would be great."* He sees bottoms-up, individual self-serve adoption as the opportunity. Advisor Prep Hero has been positioned top-down for small firms. This spec turns the existing product into a bottoms-up wedge that also lands-and-expands into firm deals.

---

## 1. The core insight (read this first)

The founder's framing question was: *"How can we make absolutely sure that individuals can download and use this without violating their firm's policies?"*

**You cannot make a firm employee compliant — that governance is not yours to control.** Whether a lawyer may run a given tool on client work is set by their firm's IT policy, their outside-counsel guidelines, and their own ethical duties (ABA Model Rule 1.6 on confidentiality; ABA Formal Opinion 512 on generative AI). No vendor can guarantee a user honors those. Any product claiming "guaranteed compliant" is lying, and this audience can smell it.

What you **can** control, and what actually matters: the thing firms are afraid of is **client data leaking to a third party** (the "an associate pasted the complaint into ChatGPT" nightmare). Advisor Prep Hero's local-first + BYOK architecture already kills that specific fear. So the design does not promise compliance. It does two achievable things instead:

1. **Make solo use safe-by-default** so an individual *cannot* leak client data without a deliberate, informed choice. You can guarantee the *default configuration never egresses* — and that is the firm's number-one fear, handled.
2. **Turn the individual into the path into the firm** — give them an honest, exportable security pack to get Advisor Prep Hero blessed for real client work, converting a solo user into the champion of a firm sale (bottoms-up → land-and-expand).

The honest line that resolves the tension between "no IT ticket required" and "don't violate firm policy," held consistently across all copy:

> **Start on your own today. Get it firm-approved when you're ready for client work.**

---

## 2. Decisions locked (do not relitigate without board input)

| Decision | Choice | Notes |
|---|---|---|
| **Target of the motion** | **Both** — a wedge that serves solo self-buyers directly AND becomes the entry point for a firm rollout | Chosen by Jameson 2026-06-18 |
| **Commercial model** | **Paid from day one, with a free *full* trial** (no free-forever tier) | Jameson's call. Lawyers have high willingness to pay; a free tier risks cheapening a trust product. |
| **Account model** | **Solo = no account** (license key only, activated on-device, BYOK). **Firm = accounts** (SSO/OIDC, seats, collaboration, ethical walls). | Matches existing architecture: solo activates via license key with no login; firm identity already runs on SSO. |
| **Trial generosity** | Generous, not 7 days (exact length is an open question below) | The bottoms-up motion needs the individual to fall in love AND have runway to walk it through a slow firm-approval process before the trial expires. |

**Non-goals (explicitly out of scope):**
- No free-forever tier.
- No forced account for solo users (a license-recovery mechanism replaces it — see §5.1).
- No change to the firm tier's cryptography, SSO, or ethical-wall model.
- No messaging that nudges associates to load privileged client data into unapproved software on a firm-managed device. (This is a hard ethical guardrail — see §6.)

---

## 3. What exists today (so we extend, not reinvent)

| Capability | Where it lives | State |
|---|---|---|
| Confidentiality spectrum (Local-only / Direct / Assured) | `src/platform/privacy/egress.ts`, `src/features/settings/ConfidentialityModeSettings.tsx`, `src/platform/hooks/useConfidentialityMode.ts` | **Default is `direct` (cloud BYOK)** — `DEFAULT_CONFIDENTIALITY_MODE = 'direct'`. This is the main change point. |
| Egress indicator + honest egress facts | `src/platform/privacy/egress.ts`, `src/platform/privacy/ui/EgressIndicator.tsx`, `src/app/shell/layout/TrustBar.tsx` | Live, honest both directions. |
| Data Map (print/PDF-ready, client-shareable) | `src/platform/privacy/ui/DataMapDialog.tsx` (+ `DataMapContent`) | Live. Currently aimed at a *client*. The security pack extends this audience to *firm IT/GC*. |
| Trial mechanism | `src/features/account/trial/` (`TrialBanner`, `TrialStatusChip`), `src/platform/licensing/` (`entitlements.ts`) | Exists; needs the "frictionless, full-feature, generous, local-default" shaping. |
| Pricing (single source of truth) | `src/config/pricing.ts` (codes `personal`/`professional`/`practice` → Solo/Professional/Firm) | Live. No free tier — consistent with the locked decision. |
| Onboarding (8-step guided) | `src/features/onboarding/GuidedOnboarding.tsx` (step 4 Trust = DataMapContent; step 5 AI key = `AiSetupStep`) | Live. The informed-choice safety gate slots in here. |
| Local retrieval/indexing (zero egress) | `src/platform/rag/` (LanceDB + fastembed e5-small, bundled local model) | Indexing, search, and citation retrieval already run **fully locally with no egress**. Only answer *generation* needs a model (local Ollama or cloud BYOK). |
| Firm workspace / seats / SSO | `src/features/firm/`, `src/platform/firm/` | Live (Wave 3a/3b/4). The land-and-expand bridge targets this. |

**Key technical nuance the implementer must respect:** retrieval is always local. The *only* place client text can leave the machine is the answer-**generation** step when a cloud model is chosen. So "safe by default" is precisely about gating that one step.

---

## 4. The five product changes

### Change 1 — Safe-by-default: no generation egress until an explicit, informed choice

**Problem:** today a fresh install defaults to `direct` (cloud BYOK). A non-firm individual who never thinks about egress could send matter text to a cloud provider without a deliberate decision.

**Change:** a personal install must **never egress generated-answer content until the user has made an explicit, informed choice.** Concretely:

- The effective default for a personal (non-firm) install is **no-cloud-egress** until the user chooses. Do **not** silently default to `direct`.
- Indexing, search, and citation retrieval continue to run locally out of the box (they never egress regardless), so the product is useful immediately.
- The **first time** the user does something that would require answer generation, present a one-screen **informed confidentiality choice** with plain-English consequences:
  - **Local-only** — "Nothing leaves this computer. Requires a local model (we'll help you set one up)."
  - **Cloud (BYOK-direct)** — "Sends your prompt and the matter text it needs to [provider]. Check your firm's policy before using this on client work."
- Until they choose, the app behaves as no-egress (local-only semantics): cloud providers are not silently used.
- This is the lever you genuinely control and the heart of the answer to "make absolutely sure": **the default configuration cannot leak.**

**Honest handling of the local-model gap:** local-only answer generation needs Ollama, which may not be installed. If the user picks Local-only with no local model present, guide them ("install a local model" with a link/helper) rather than silently falling back to cloud. Never auto-egress as a fallback. (No silent cloud fallback is already a hard rule in `CLAUDE.md`.)

**Touch points:** `egress.ts` (introduce a personal-install default that is no-egress / unset, distinct from the firm path), `useConfidentialityMode.ts`, the AI-send path (`src/features/ask/hooks/useChatSending.ts`, `src/features/ask/useAsk.ts`), onboarding (`AiSetupStep.tsx` / the AI-key step), and the confidentiality settings card. Firm installs keep their existing behavior.

### Change 2 — The honest "is this OK for me?" first-run moment

**Change:** add a short, lawyer-literate trust moment to onboarding (extend step 4 Trust / step 5 AI key, reusing `DataMapContent`). Exact copy lives in `03-copy-deck.md`; the substance:

> Advisor Prep Hero runs entirely on your computer. In Local-only mode, nothing about your matters leaves this device — not to us, not to any AI provider. Using any tool on client work may still be governed by your firm's policies. Here's exactly what Advisor Prep Hero does, so you can check.

No fake "compliant" badge. The honesty is the differentiator with this audience.

**Touch points:** `src/features/onboarding/GuidedOnboarding.tsx`, `AiSetupStep.tsx`, copy from the copy deck.

### Change 3 — One-click "security pack for my firm" (the bridge + the defensibility)

**Change:** a one-click action that generates a clean, professional PDF aimed at a firm's **IT / General Counsel** (a different audience than the existing client-facing Data Map). It assembles, from existing truthful sources:

- What Advisor Prep Hero is (local-first private intelligence layer) and the architecture in plain terms.
- The Data Map (reuse `DataMapContent`).
- The three confidentiality modes and **exactly what egresses in each**.
- The BYOK model (Advisor Prep Hero never holds keys or sees content).
- The firm-tier security story: E2EE relay (relay only ever stores ciphertext), SSO, ethical walls enforced by key denial, DPA / SOC 2 status.
- A short "what to ask us" / contact line for the firm's evaluator.

This makes an individual's use *defensible* and converts that individual into the champion who walks Advisor Prep Hero into the firm. Reuses the existing print-to-PDF pattern in `DataMapDialog.tsx`.

**Touch points:** new component (e.g. `src/features/privacy/FirmSecurityPack.tsx`) reusing `DataMapContent` + facts from `egress.ts` + the trust/DPA docs under `docs/trust/` and `docs/legal/`; an entry point in the Privacy Center (`src/features/privacy/PrivacyCenterHome.tsx`) and/or Settings → Privacy. Keep copy accurate, no marketing language.

### Change 4 — The land-and-expand bridge

**Change:** when the individual is ready to use Advisor Prep Hero with their firm, a clear path: **"Use this with my firm"** → create or join a firm workspace; their existing local matters come with them; the seat-based Firm tier takes over. The free-trial/solo individual becomes seat #1 of a firm deal.

This mostly wires the existing firm onboarding (`FirmAdminConsole`, `FirmSignIn`, the onboarding "Invite firm" step) to a discoverable, well-placed entry point for a *solo* user who started on their own — plus carrying their local matters into the firm workspace.

**Touch points:** `src/features/firm/`, the onboarding firm step, the account window (`src/features/account/AccountWindow.tsx`), and a matters import/attach path.

### Change 5 — Packaging + positioning

**Change (packaging):** the trial is frictionless — no credit card, no account, full features, **Local-only / no-egress default**, generous length. After the trial, the solo user buys a license key (Solo/Professional) with no account. Firm is where accounts begin.

**Change (positioning):** a new top-of-funnel angle on keepance.com and in-app:

> **Private AI for your practice you can start using today, on your own — no IT ticket required.**

"No IT ticket" is the precise answer to Sam's "can they use it without the firm approving it." It must be deployed under the §6 guardrail.

**Touch points:** `website/` (landing + a section/page for the "start on your own" motion), `src/config/pricing.ts` copy if any tier framing shifts, the trial UI. Website copy is customer-facing: follow `feedback_marketing_copy_voice.md` + `reference_ai_writing_tells.md` + the no-em-dash rule.

---

## 5. Details the implementer must get right

### 5.1 Solo license recovery without an account
A solo user has no account, so license recovery across devices needs a non-account mechanism: a recovery/license code the user keeps (and can re-enter on a new machine), validated by the existing license-validator. Do not introduce a login for solo. Keep it local-first.

### 5.2 Retrieval stays local, always
Reaffirm that indexing/search/citation retrieval never egress. The safe-by-default work is *only* about the generation step. Do not regress the local retrieval path.

### 5.3 Accuracy over polish in the security pack and trust copy
This audience distrusts marketing language. Every claim in the security pack and the trust moment must mirror the real architecture and the canonical facts in `egress.ts`. If a claim can't be made truthfully (e.g. SOC 2 not yet complete), state the real status, don't imply more.

### 5.4 Firm installs unchanged
None of the safe-by-default or solo-packaging changes may alter firm-tier behavior (Assured mode, managed keys, SSO, co-editing, ethical walls). Gate the new personal defaults on "not a firm install."

---

## 6. The ethical guardrail (hard constraint on all customer-facing copy)

"No IT ticket required" is in honest tension with "don't violate firm policy." The resolution, which must hold in every piece of copy (website, onboarding, security pack, emails):

- An individual may freely **evaluate** Advisor Prep Hero on their own: local-only, their own device, their own or non-privileged data.
- The **security pack** is the path to using it for real client work at a firm.
- We must **never** message in a way that encourages associates to put privileged client data into unapproved software on a firm-managed device. That is a real liability for them and a reputational risk for Advisor Prep Hero.
- The canonical line: **"Start on your own today; get it firm-approved when you're ready for client work."**

Treat any copy that violates this as a defect, not a style nit.

---

## 7. Open questions for Jameson (small, non-blocking)

1. **Trial length.** What's the generous-but-bounded number? (Recommendation: long enough to survive a firm-approval cycle — e.g. 30 days — rather than 7/14.)
2. **Positioning aggressiveness.** How hard do we lean on "no IT ticket required" vs a softer "start privately on your own"? (Recommendation: lead with the punchy line, immediately qualified by the §6 honest framing so it never reads as "sneak it past your firm.")

These can be answered during implementation; defaults above are safe to build against.

---

## 8. Success criteria

- A brand-new personal install **cannot** send generated-answer content to a cloud provider without a logged, explicit, informed user choice. (Provable by test: fresh install → attempt generation → no cloud egress until choice is recorded.)
- Indexing, search, and citations work out of the box with zero egress.
- A solo user can go from download → using it on their own → buying a license key, with **no account** at any step.
- A solo user can generate a firm-ready security PDF in one click, and from the same product cross into a firm workspace carrying their matters.
- Every customer-facing string upholds §6 and the house voice rules; no "guaranteed compliant" claim exists anywhere.
- Firm-tier behavior is byte-for-byte unchanged for existing firm installs.
