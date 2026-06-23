# Design Spec — Firm Philosophy (Client Map v2, first cut)

**Date:** 2026-06-23
**Status:** Approved (brainstormed with Jameson 2026-06-23, one question at a time; all recommendations accepted).
**Branch:** `keepance-3.0`
**Parent:** This is the detailed design for **decision 9 / §5 "v2: Firm Philosophy"** of [`01-design-spec.md`](./01-design-spec.md) (the Client Map). It is also Mission 2's firm-tier layer. Names are LOCKED: "Firm Philosophy", framed as "stores and applies," never "learns."

---

## 0. Plain-language summary (for Jameson)

A firm sets up, once, its "way of serving clients," and it quietly applies to every lawyer's Client Maps at that firm. Three parts: **standard sections** that appear on every client (e.g. "Fee arrangement," "Conflict check"), a written **guidance note** ("how we serve our clients here") that shapes the AI whenever it writes or updates any client's map, and **standard intake questions** the Guided Interview asks for every new client. The firm's **admin** sets it. It is a **baseline each lawyer builds on**: the firm's sections always appear and the guidance note always applies, but a lawyer can still add their own sections and notes on top and can't delete the firm's. When the firm changes its philosophy, new sections arrive as **proposed additions a lawyer approves** (never a silent rewrite, never touching what a lawyer typed). Solo users are unaffected. The household-for-advisors unit and the richer sections come in later rounds.

---

## 1. Decisions locked (from the 2026-06-23 brainstorm — do not relitigate without board input)

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | **v2 focus** | **Firm Philosophy** first (household + richer sections deferred to their own rounds) | Builds directly on the just-shipped solo-to-firm bridge; serves the locked law-firm ICP; the strongest "our way of serving clients" differentiator |
| 2 | **Control model** | **Baseline they build on** — firm sections always appear + the guidance note always applies; a lawyer adds their own on top but can't delete the firm's | Firm consistency + individual professional autonomy; matches v1's "you stay in control" ethos |
| 3 | **Components (this cut)** | **All three** — standard sections + guidance note + standard intake questions | They reinforce each other into a complete "stored and applied" philosophy; each reuses v1 machinery |
| 4 | **Who sets it** | The **firm admin**, in the existing firm admin area | Firm-wide governance belongs with the admin role the firm subsystem already has |
| 5 | **On change** | New/changed standard sections arrive as **proposed additions in the approve-first tray** (AI-populated, user approves); the guidance note applies to future AI passes; user-origin items are never touched | Preserves v1's approve-first + sovereignty hard rules; no silent rewrite |

**Non-goals (explicitly out of scope for this cut):**
- The advisor **household** unit (its own later round).
- **Richer sections** (timeline, communication style, prior-advice, relationship graph) — its own later round.
- No change to firm-tier cryptography, SSO, ethical walls, or the relay.
- No "learning" — the philosophy is authored by the firm and applied verbatim; the AI never infers or mutates it.
- Solo (non-firm) behavior is unchanged; Firm Philosophy only exists on a firm install with an active seat.

---

## 2. What exists to reuse (build on v1, do not reinvent)

- **The data model already anticipates this.** The v1 Client Map types carry `SectionScope = 'matter' | 'personal-template' | 'firm'` and `CustomCategoryTemplate.scope`; the v1 spec explicitly says "'firm' added in v2 without migration." Firm standard sections are **templates with `scope: 'firm'`**, reusing the level-1/level-2 custom-section + template machinery (`src/platform/clientMap/customSection.ts`, `templatesStore.ts`).
- **Generation already takes shaping input.** `src/platform/clientMap/generator.ts` builds the structured AI call (the `matterAtAGlance` provider pattern, honoring Local-only + `assertCloudGenerationAllowed()`). The **guidance note** is injected into that prompt as firm-authored context for firm matters.
- **The Guided Interview is gap-driven.** `src/platform/clientMap/guidedInterview.ts` + `ContextCompleteness.ask`. Firm **standard intake questions** are firm-scoped gap questions seeded into the interview queue for firm matters (deduped against answered/resolved gaps per the v1 hardening BUG-106 work).
- **The firm subsystem holds org-level state.** `src/platform/firm/firmStore.ts` (`useFirmStore`) carries persisted org/session metadata; `FirmApiClient` talks to the firm backend; `FirmAdminConsole.tsx` / `MemberRoster.tsx` are the admin surfaces. Firm Philosophy is **firm configuration** distributed to members the same way other org settings are (NOT via the E2EE matter relay, which only ever carries client content).
- **Approve-first + sovereignty are built.** `updater.ts` (`proposeUpdates`, `mergePendingUpdates`, dismissals) and the user-origin sovereignty from the v1 hardening pass are reused for "on change" behavior.

---

## 3. User-facing shape

### 3.1 Setting the philosophy (firm admin)
A new "Firm Philosophy" area in the firm admin surface (`FirmAdminConsole`), visible only to a firm **admin**. Three editors:
- **Standard sections:** add/edit/remove firm sections (a title + a plain-language description of what to track), exactly like a personal template but saved at `scope: 'firm'`.
- **Guidance note:** a single multi-line text field, "How we serve our clients" — plain prose the firm writes.
- **Standard intake questions:** an ordered list of questions the Guided Interview should ask for every new client.

Non-admin members see a read-only view ("Your firm's standard sections / guidance / intake questions") so they understand what's applied; they cannot edit it.

### 3.2 How it lands on a lawyer's Client Map
- **Standard sections** appear on every matter's Client Map, AI-populated from that matter's own content (same per-item sourcing + assumption rules as v1). They are visually marked as firm-standard and **cannot be deleted by the member** (the member can still add their own `matter`/`personal-template` sections on top).
- **Guidance note** is applied on every generation/update pass for firm matters (it shapes what the AI surfaces and how), without ever appearing as a map item itself.
- **Standard intake questions** are merged into the Guided Interview's question queue for firm matters (deduped against already-answered/flagged gaps).
- **Solo / no active seat:** none of the above applies; the member's personal templates (level 2) are unchanged.

### 3.3 When the firm changes its philosophy
- A newly-added (or edited) standard section is **proposed** onto existing matters via the approve-first tray (`proposeUpdates` → `pendingUpdates`); the lawyer accepts/edits/dismisses. Never a silent overwrite; user-origin items untouched.
- A removed standard section stops appearing on future passes; already-accepted items the lawyer kept remain theirs (sovereign) unless they remove them.
- A changed guidance note applies to the next generation/update pass; it never force-rewrites existing items (it can only produce new *proposed* changes).

---

## 4. Architecture & data model

### 4.1 Where it lives
- **New firm config object** (e.g. `FirmPhilosophy = { standardSections: CustomCategoryTemplate[] /* scope:'firm' */, guidanceNote: string, intakeQuestions: { id, text }[], updatedAt, version }`), stored at the **org level** and fetched/distributed to members through the existing firm-config path (org metadata via `FirmApiClient` / `firmStore`), NOT the E2EE matter relay. It is firm configuration, never client content, so it carries no client-data egress concern.
- **Admin editor UI** in `src/features/firm/` (a `FirmPhilosophy` panel mounted in `FirmAdminConsole`); read-only member view alongside.
- **Generation integration** in `src/platform/clientMap/` (generator + the section list + the interview queue): when building/updating a firm matter's map, (a) include `scope:'firm'` sections, (b) inject `guidanceNote` into the structured AI prompt, (c) seed `intakeQuestions` into the interview gaps.

### 4.2 Resolution order (the "baseline + freedom" rule)
On a firm matter, the effective section set = **firm standard sections (locked, always present)** + the member's personal-template sections + the matter's own custom sections. Firm sections are flagged `scope:'firm'` and `origin`-protected from member deletion; everything the member adds behaves exactly as v1.

### 4.3 Privacy / egress
The guidance note + firm sections shape the **generation prompt**; on a firm matter that already uses cloud (BYOK/Assured), the prompt + that matter's content go to the provider exactly as v1 generation does; on a local-only matter, on-device. No new egress path; matter isolation is unchanged (generation is still `{ kind:'matter', matterId }`-scoped; Firm Philosophy is firm config applied during that scoped pass, not cross-matter data).

### 4.4 Permissions
Only a firm **admin** can write `FirmPhilosophy` (enforced at the firm backend + gated in the UI). Members read it. Reuse the existing admin-role check used by `FirmAdminConsole` / member management.

---

## 5. This cut vs later

**This cut:** firm admin authors standard sections + guidance note + standard intake questions; they distribute to members as firm config; they apply to every firm matter's Client Map as a non-deletable baseline a lawyer builds on; changes flow through the approve-first tray. Read-only member view. Solo unchanged.

**Later rounds (each its own spec):** the advisor **household** unit; **richer sections** (timeline, communication style, prior-advice, relationship graph); any firm-philosophy analytics/versioning beyond a simple updatedAt.

---

## 6. Hard rules (a violation is a defect, not a style nit)

- **Matter isolation** unchanged: generation stays single-matter (`{ kind:'matter', matterId }`); Firm Philosophy is firm config, never another client's data.
- **Approve-first:** all AI changes (incl. firm-section population on change) flow through the review tray; user-origin items are never overwritten.
- **No silent cloud egress:** generation respects `isLocalOnlyMode()` + `assertCloudGenerationAllowed()` exactly as v1.
- **Firm config, not client content:** the philosophy rides the firm settings/config channel; it is NEVER put on the E2EE matter relay, and a member's client content is never sent to the firm.
- **"Stores and applies," never "learns":** the philosophy is firm-authored and applied verbatim; nothing infers or mutates it.
- **Admin-only authoring;** members read-only.
- **Firm installs only:** branch on firm + active seat; solo is byte-for-byte unchanged.
- **Voice:** no em dashes in any user-facing string (there is a test); no AI tells; never claim "compliant"/"guaranteed"; locked name "Firm Philosophy."
- **No build/deploy** without Jameson's explicit go.

---

## 7. Open / board items

None are board-level (this is a firm-tier feature for the locked law ICP, no pricing/strategy change). Implementation-plan open question: the exact org-config distribution mechanism (whether `FirmPhilosophy` rides existing org metadata fetched on sign-in or needs a small dedicated endpoint) — resolve by reading `firmStore` + `FirmApiClient` at plan time.

---

## 8. Testing posture

- **Baseline + freedom:** firm sections always present on a firm matter and not member-deletable; member can still add `matter`/`personal-template` sections; solo install shows none of it.
- **Guidance note applied:** the generation prompt for a firm matter includes the firm guidance note (assert via the provider mock); a local-only firm matter still injects it on-device with no egress.
- **Intake questions merged:** firm standard questions appear in the Guided Interview queue for firm matters, deduped against answered/resolved gaps (reuse the BUG-106 dedup).
- **On change = approve-first:** adding a firm standard section proposes it onto an existing matter via the tray (never a silent overwrite); user-origin items untouched.
- **Permissions:** a non-admin member cannot write `FirmPhilosophy` (UI gated + backend-enforced); read-only view renders.
- **Isolation + privacy:** matter isolation unchanged; no firm-relay path carries client content; no new cloud egress.
- **Voice:** no em dashes in any new user-facing string.
- Gates green per task: `npm run typecheck` (0) · `npx vitest run` · `node scripts/eslint-gate.mjs` · `npm run gate` before merge.

---

## 9. Success criteria

- A firm admin can author standard sections + a guidance note + standard intake questions in one place; members see them (read-only).
- Every firm matter's Client Map shows the firm standard sections (AI-populated, non-deletable) and is shaped by the guidance note; the Guided Interview asks the firm's standard questions; a lawyer can still add their own on top.
- Changing the philosophy proposes additions through the approve-first tray; nothing a lawyer wrote is ever overwritten.
- Solo installs and existing firm-tier security/keys/relay behavior are unchanged; no new cloud egress path exists.
- Every new user-facing string upholds the voice + honesty rules.
