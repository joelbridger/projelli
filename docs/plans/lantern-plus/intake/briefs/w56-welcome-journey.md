TASK: Lantern Intake Wave 5 Lane W5b — welcome journey wiring (firm-authored what-happens-next page + template editor).

You are Codex (gpt-5.6), building in an isolated git worktree on branch `lp/w56-welcome-journey` off `lp/intake-w56`. TS/React (advisor side) + the client `intake-page/` (rendering). Follow TDD. WIRE the existing copy — do NOT rewrite it.

## Read first — THE COPY IS ALREADY WRITTEN
- **`docs/plans/lantern-plus/welcome-journey/CONTENT-PACK.md`** — 816 lines, the finished content. It is NOT in this branch's working tree; read it with:
  `git show f54643b7:docs/plans/lantern-plus/welcome-journey/CONTENT-PACK.md`
  Your spec is that file's **§3 "Acceptance Criteria For The Wave 5 Welcome Journey Build Lane"** (product shape, default template, timeline/next move, resume & completion behavior, "your team" block, firm template editing, advisor-approved emails, board/per-client surfaces, phone-walkthrough & email-fallback labels, edge cases, copy & quality gates). Use the exact copy from Screens A–G and the merge-field/people/timeline defaults (§1). Do not invent new copy; wire what is written.
- `docs/plans/lantern-plus/intake/PRODUCT-DESIGN.md` §6 (client flow — welcome card + done screen + what-happens-next), §5 (finish onboarding), §3 (compose/send).
- `docs/plans/lantern-plus/intake/ARCHITECTURE.md` §2/§3 (firm text + checklist are sealed under `k_page`; the RELAY MUST NEVER SEE firm name, item labels, or what-happens-next text — they ride inside the sealed checklist ciphertext, same as today's `firm` object).
- Existing code:
  - `intake-page/src/App.tsx` — client SPA; `normalizeFirm`, the `completion` item, welcome/loading/fallback screens. The what-happens-next content renders HERE on completion, decrypted from the sealed checklist.
  - `intake-page/src/types.ts` — `IntakeChecklist` / `IntakeFirm` shape (extend for the welcome-journey fields: steps, timeline, people/your-team, resume copy).
  - `src/features/intake/newHouseholdTemplate.ts` — the default template (welcome card + what-happens-next card exist as `readonly_card` items today; populate them from the content pack defaults).
  - Advisor compose/finish surfaces: `src/features/intake/OnboardingTab.tsx`, the New-client compose flow (`NewClientDialog` extension), `src/features/intake/createIntake`/`advisorIntakeLink.ts` (where the sealed checklist is built).

## Deliverables
1. **Data shape**: extend the sealed checklist/`firm`-journey payload (advisor side + `intake-page/src/types.ts`) to carry the welcome-journey content: welcome-screen copy, active-checklist support copy, resume-state copy, completion (what-happens-next) steps + timeline + "your team" people (names/roles/photos-optional), staff-handoff note, phone-walkthrough label. All firm-authored, all sealed under `k_page` (never plaintext to the relay). Provide the content-pack defaults as the template baseline (`src/features/intake/welcomeJourneyDefaults.ts` or extend `newHouseholdTemplate.ts`).
2. **Advisor template editor** — `src/features/intake/WhatHappensNextEditor.tsx` (new): lets the firm edit the editable defaults (per CONTENT-PACK §2 "Editable firm defaults"); ENFORCE the "Not editable by firms" list (§2) — those stay fixed (privacy/honesty copy must not be firm-editable). Saved as firm blueprint defaults; applied when composing an intake; per-intake tweak allowed before send. Reachable from compose and/or firm settings.
3. **Client rendering** — `intake-page/src/`: render Screen A (first welcome) at start, resume-state copy (Screen C) on return, and Screen D (completion / what-happens-next) with the firm's steps + timeline + your-team + handoff note. Screen E privacy explainer copy wired (fixed, not firm-editable). Screen G phone-walkthrough label + email-fallback labels where relevant. Keep the page self-contained (NO third-party origins/CDN/analytics — page-integrity rule), light theme, tokens, no em dashes.
4. **Emails (secondary, reuse existing rails)** — seed the nudge/advisor-approved-email draft library with the 14 templates from the content pack, wired into the EXISTING W2 nudge draft + approve-to-send flow (`src/platform/intake/nudgeDraft.ts` / `nudgeSave.ts` and the mail rails). Do NOT build a new send system. If wiring all 14 is heavy, wire the welcome/reminder/complete core ones and leave a `TODO(W5b-followup)` note listing the rest — flag it in your final notes rather than expanding scope silently.

## TDD — write first (vitest + intake-page tests)
1. `welcomeJourneyDefaults` matches the content-pack defaults (people, timeline, screen copy) — a snapshot/shape test so drift from the pack is caught.
2. Advisor editor: editing an editable field updates the blueprint; a "not editable" field is not exposed/enforced-immutable.
3. Sealing: the what-happens-next content is inside the `k_page`-sealed checklist; a test asserts the relay-visible payload/metadata contains NONE of the firm text (extend or mirror the privacy-proof test pattern — no firm name / people / steps in plaintext outbound).
4. `intake-page` render tests (Playwright or the page's test harness): welcome screen renders firm copy; completion renders steps + timeline + your-team; resume shows resume copy; no em dashes; axe basics don't regress.
5. Merge fields resolve (client first name, firm name, advisor name) from the sealed checklist, never from the URL/relay.

## Non-negotiables
- WIRE the written copy; don't paraphrase. Honesty/privacy copy (CONTENT-PACK §2 "not editable") is firm-IMMUTABLE.
- Firm text is sealed under `k_page`; the relay sees none of it (privacy-proof gate stays green).
- Page-integrity: intake-page stays self-contained, CSP-pinned, no third-party. Light theme, tokens, no em dashes, client/household language.
- `matter`/`matter_id` never renamed.

## Out of scope
- Phone mode data entry (W5a — but DO wire the phone-walkthrough LABEL copy, Screen G), KPI strip (W6a), key sharing (W5c), relay hardening (W6b), the a11y audit itself (W6d — just don't regress axe basics), IT-pack (W6c). No new nudge send infrastructure (reuse W2's).

## Verify
`npx vitest run src/features/intake src/platform/intake` (scoped to your changed files), `npm --prefix intake-page run build`, intake-page tests (`cd intake-page && npx playwright test` if you touched the page), `npx tsc --noEmit`, `npm run lint:gate`. Report exact counts. When done + committed, print `W56-WELCOME-JOURNEY-WIRED-DONE` then `DONE-EXIT:0`.
