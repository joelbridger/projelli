# Design Spec — Phase 4: Solo-to-Firm Bridge + Matter Carry-Over

**Date:** 2026-06-23
**Status:** Approved (brainstormed with Jameson 2026-06-23, one question at a time; all recommendations accepted).
**Branch:** `keepance-3.0`
**Parent:** This is the detailed design for **Change 4 / Phase 4** of [`01-design-spec.md`](./01-design-spec.md) ("the land-and-expand bridge"). It does not relitigate that spec's locked decisions; it specifies how the bridge actually works.

---

## 0. Plain-language summary (for Jameson)

A lawyer who's been using Keepance alone clicks **"Use this with my firm."** Two equal doors: **start/lead a firm** (they become the admin and first seat) or **join an existing firm** (sign in, claim a seat). Then a friendly one-time step shows all their existing matters and, **for each one**, they choose: **leave it private** (stays just theirs, on their computer) or **share it with the firm** (colleagues can collaborate). When you share, what travels to colleagues (encrypted) is the **shared notes plus any documents you choose to co-edit** — your actual files, email, and search index stay on your computer. If a matter is **privileged** (most sensitive) and you choose to share it, you get a clear warning first and decide. You can skip and do it later. Their solo license stays valid; the firm plan is a separate purchase (sorting out credits is a later business call).

---

## 1. Decisions locked (from the 2026-06-23 brainstorm — do not relitigate without board input)

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | **Primary scenario** | **Both** create-a-firm AND join-a-firm are co-equal headline flows | Neither path is second-class; matches the bottoms-up motion (champion becomes seat #1) AND the associate joining an existing firm account |
| 2 | **Carried-matter privacy** | **Decide per matter at move time** — each matter is marked private or shared during the carry-over step | Maximum control; honors that a solo person's matters may include personal or prior-job work |
| 3 | **What "share" moves (v1)** | **Collaboration layer only** — shared notes + chosen co-edited documents (encrypted). Files, email, and the RAG index stay local | Matches the existing E2EE architecture; honest; far lower risk than building bulk content transfer |
| 4 | **Privileged matters** | **Allowed to be shared, behind an explicit informed-consent warning** that sharing turns on the encrypted relay sync | User-in-control; an informed choice, not a silent weakening |
| 5 | **Billing on crossover (v1)** | **No automatic billing change.** Solo license stays valid; the firm tier is a separate purchase. Credits/proration deferred | Keeps v1 lean; the money side is a separate board decision (approved deferred by Jameson 2026-06-23) |

**Non-goals (explicitly out of scope for v1):**
- No copying of the matter's actual files / imported email / RAG index to colleagues (collaboration layer only — decision 3).
- No automatic refund/credit/proration of the solo license at crossover (decision 5).
- No bulk "un-share" or "move a matter back to solo" flow.
- No change to firm-tier cryptography, SSO, ethical walls, or the relay.
- No per-member re-mapping of folder/mail paths (only needed if files transferred, which they don't in v1).

---

## 2. What exists today (reuse, do not reinvent)

From the code map of `keepance-3.0`:

- **A matter is a pointer, not a container.** `Matter` (`src/platform/types/matter.ts`) is metadata mapping a client to **local** `folderPaths[]` + `mailFolderPaths[]`. The actual documents, email, and RAG index live on disk / in LanceDB, resolved by path — they are **not** inside the matter object. Created via `createMatter` (`src/platform/matter/matterStore.ts:288`); persisted under `keepance:matters` etc.
- **A firm-shared matter = the same matter plus four optional fields:** `firmMatterId`, `orgId`, `role` (`owner|editor|viewer`), `shared`. Added by `linkFirmMatter` (`matterStore.ts:476`), removed by `unlinkFirmMatter` (`matterStore.ts:486`). The matter keeps its original local `id`; sync/keys key off `firmMatterId`.
- **Only the collaborative streams sync, via the E2EE relay** (the relay is a dumb ciphertext pipe): the per-matter `_notes` Yjs stream and per-`.docx` co-edit streams, through `MatterSyncClient` (`src/platform/firm/MatterSyncClient.ts`), built by `matterNotesSync.ts` + `coedit/MatterDocSyncClient.ts`. **No file sync, no email sync, no RAG-index sync exists.** This is exactly the v1 scope (decision 3) — nothing new to build on the sync side.
- **Per-matter AES-256 key** in the OS keychain, managed by `src/platform/firm/matterKeyService.ts` (`getOrCreateMatterKey`, `obtainMatterKey`, `publishMatterKeyToMembers`), wrapped per device via ECDH-P256 (`keyWrap.ts` + `deviceKeys.ts`), with admin escrow + epoch rotation. Ethical walls = key denial (`eligibleDevices`).
- **Get into a firm today (license-key driven):**
  - **Create = "claim org":** `FirmSignIn.tsx` claim panel → `firm.claimOrg(licenseKey, email, password, orgName)` → `firmStore.claimOrg`. Needs the firm-tier LemonSqueezy license key.
  - **Join:** `firm.signIn` / `firm.signInSso` → `activateSeat(licenseKey, machineLabel)`. Members are provisioned by an admin (`FirmAdminConsole.tsx` / `MemberRoster.tsx`).
  - Entry point: Account window → **Firm** tab (`src/features/account/AccountWindow.tsx:236`) renders `<FirmSignIn />` + `<FirmAdminConsole />`.
- **The single most reusable building block — promote one local matter to shared, in place:** `handleShare(matterId, clientName)` (`src/features/matters/MatterManagerDialog.tsx:198`). Its 6 steps: `client.createMatter(clientName)` (a backend **shell** carrying NO content) → `linkFirmMatter(...)` → `getOrCreateMatterKey(firmMatterId)` → `registerDevice(client)` → `publishMatterKeyToMembers(...)` → audit `matter_shared`. The inverse `handleOpenShared` (`MatterManagerDialog.tsx:274`) opens a remote firm matter as a **new empty local matter** (consistent with "files stay local").
- **Guards the bridge must respect:** `matterScopeGuard.ts` (`pathInMatterScope`), Privileged Matter Mode (`src/platform/privacy/privilegedMatterMode.ts` — forces network + MCP off when a privileged matter is active), per-matter `mcpAccessGranted` (explicit, separate from "active").

---

## 3. The user-facing shape

### 3.1 Entry point — "Use this with my firm"
A discoverable action for a solo user. Primary home: the Account window (alongside the existing Firm tab). Plus one non-intrusive in-app affordance (e.g. a dismissible prompt where firm value is obvious). Tactical placement is the implementer's call; it must be discoverable without nagging.

### 3.2 Get into a firm (two co-equal doors)
A choice screen: **Start/lead a firm** vs **Join an existing firm.**
- **Start/lead:** route into the existing claim-org flow (`FirmSignIn` claim panel → `claimOrg` → activate seat #1). Because the firm tier is paid, the flow guides the user to obtain the firm plan/license (link to purchase), then claim. Plain copy explaining what a firm adds (colleagues, shared matters, SSO, the firm security setup).
- **Join:** route into the existing sign-in/SSO + `activateSeat` flow.
Both reuse `FirmSignIn` / `FirmAdminConsole`; the bridge adds the framing + a clean front door, not new auth.

### 3.3 The guided carry-over step (the new heart of the feature)
Immediately after the user has an active firm seat (`firm.isSignedIn && firm.hasActiveSeat`), present a **one-time guided step** listing **all their existing local matters** (exclude already-shared and archived). For each matter, a per-matter choice (decision 2):
- **Leave private** (default for anything untouched): the matter is left exactly as-is — a local solo matter, no firm link. Nothing happens to it.
- **Share with the firm:** run the existing promote-to-shared routine (`handleShare`) for that matter, wrapped for multi-select (bulk). Key published once per matter.
- **Privileged matter + Share:** before proceeding, show an explicit informed-consent dialog: *"Sharing turns on encrypted internet sync for this privileged matter. Continue?"* Proceed only on confirm; otherwise leave it private. (Decision 4.)
- **Skip / do it later:** the whole step is skippable; the user can share any matter later from the normal matter screen (already exists). A subtle reminder may surface later, never a nag.

Empty/edge states: a user with no matters sees a friendly "nothing to bring over yet" and lands in the firm. A matter that fails to promote surfaces a clear, plain error and leaves that matter private (no partial/ambiguous state).

### 3.4 Ongoing
After the bridge, sharing more matters one at a time uses the **existing** per-matter share button (`MatterManagerDialog`) — unchanged. The bridge is the welcome moment; the per-matter button is the steady state.

---

## 4. Architecture & reuse

- **New surface:** a guided **bridge flow** in `src/features/firm/` (the "Use this with my firm" choice + the carry-over step), entered from `AccountWindow` and the in-app affordance. Depends on `platform`/`ui`/`lib`; cross-feature wiring through the shell/shared state per the architecture DAG.
- **Bulk carry-over = a thin wrapper around `handleShare`.** Multi-select the matters, then for each "share" selection run the proven 6-step routine; "leave private" is a no-op. **Do not re-implement** the local-id-vs-`firmMatterId` reconciliation or key publishing — reuse `linkFirmMatter` + `matterKeyService` exactly as `handleShare` does. Sequence per-matter to avoid hammering the relay/keychain; surface progress + per-matter result.
- **No new sync or crypto.** v1 rides entirely on the existing notes/co-edit streams. No file/email/RAG transfer code is added (decision 3). No folder/mail path remapping is needed because nothing is transferred to other machines.
- **Privileged handling** lives at the carry-over decision point: detect `matter.privileged`, gate the share behind the informed-consent dialog. Do not auto-disable the privileged protection globally; this is a per-action informed choice.
- **Firm installs unchanged:** branch on firm state; this is solo→firm onboarding only. Existing firm members and the relay see no behavior change.

---

## 5. v1 vs later

**v1 (this spec → plan → build):** the entry point; both create-firm and join-firm doors (reusing existing auth); the guided per-matter carry-over step (collaboration-layer sharing via the existing `handleShare`); the privileged informed-consent warning; skip/later; honest empty/error states.

**Later (deferred):** encrypted transfer of the matter's actual documents/email/RAG to colleagues; billing credit/proration at crossover; bulk un-share / move-back-to-solo; folder/mail re-mapping per member (only if content transfer ships); ties into Firm Philosophy (Client Map v2).

---

## 6. Hard rules (a violation is a defect, not a style nit)

- **Matter isolation:** one client's data never crosses into another matter; `matterScopeGuard` rules apply unchanged.
- **E2EE-only relay:** sharing only ever puts ciphertext on the relay; never add a path the relay could read. Reuse the existing key wrapping / escrow / epoch rotation.
- **Privileged = informed consent:** never silently put a privileged matter on the relay; require the explicit confirm.
- **Reuse, don't re-implement:** carry-over goes through `handleShare` / `linkFirmMatter` / `matterKeyService`; do not hand-roll firm-matter creation or key publishing.
- **Firm installs unchanged;** **solo stays accountless** (no login introduced for solo).
- **Locked tier codes** `personal | professional | practice` — never rename.
- **Voice:** NO em dashes in any user-facing string (there is a test); no AI tells; first-person, concrete nouns; never claim "compliant"/"guaranteed".
- **No build/deploy** without Jameson's explicit go (commercial boundary).

---

## 7. Open / board items

- **Billing on crossover (decision 5):** v1 keeps the solo license valid and treats the firm tier as a separate purchase. Credit/proration of the unused solo term is a **board-level commercial decision deferred to later** (approved deferred by Jameson 2026-06-23). The bridge must not promise or imply any automatic refund/credit.

---

## 8. Testing posture

- **Routing:** "Use this with my firm" → start/lead routes into claim-org; join routes into sign-in + activate-seat. (Mock the firm client.)
- **Carry-over logic:** given a set of local matters and per-matter choices, "share" selections call the promote routine (assert `linkFirmMatter` + a single key publish per matter, via mocks); "leave private" selections are untouched (no `firmMatterId`).
- **Privileged gate:** sharing a `privileged` matter shows the confirm dialog and only proceeds on confirm; declining leaves it private.
- **Idempotence / safety:** already-shared and archived matters are excluded; a failed promote leaves that matter private with a clear error (no partial state).
- **Isolation + firm-unchanged:** carry-over never widens matter scope; firm-install behavior is byte-for-byte unchanged (branch on firm state).
- **Voice:** no em dashes in any new user-facing string (repo-wide test covers it).
- Gates green per task: `npm run typecheck` (0) · `npx vitest run` · `node scripts/eslint-gate.mjs` · `npm run gate` before merge.

---

## 9. Success criteria

- A solo user can, from one discoverable action, **create or join a firm and bring selected matters over**, choosing private vs shared per matter, in one guided flow.
- Sharing a matter through the bridge produces the same correct firm-shared state as the existing per-matter share button (collaboration layer only; files stay local).
- A privileged matter is never shared without an explicit informed confirm.
- Existing firm-tier behavior is unchanged; solo remains accountless; no automatic billing change occurs.
- Every new user-facing string upholds the voice + honesty rules.
