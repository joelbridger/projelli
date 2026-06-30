# Design Spec — The Client Map (private client intelligence)

**Date:** 2026-06-22
**Status:** Approved (design greenlit by Jameson 2026-06-22 in a one-question-at-a-time brainstorm). Ready for implementation planning.
**Branch:** `keepance-3.0`
**Origin:** The brand repositioning to "private client intelligence" (Jameson's product partner) plus the bottoms-up wedge (Sam Andersen, Element Ventures, 2026-06-18). The website already markets the Client Map and its three sub-features as "coming," so this is a real commitment to ship. This is **Mission 2** in `../2026-06-18-bottoms-up-wedge/00-START-HERE-situation-and-two-missions.md`. Names are **LOCKED** by that brief and are not relitigated here.

---

## 0. Plain-language summary (for Jameson)

The Client Map is a living profile of each client that the app builds *for* you, automatically, from your own files and emails. You open a client and instantly see where things stand: their story, the key people, what's open, what's coming, what to do next, and what you're still missing. Every line links to the exact document or email it came from, so you can click and check it. You can add your own sections (the app fills them in), and a focused "interview" mode walks you through the gaps so a folder of documents becomes a full picture. It stays current by drafting updates for you to approve, never changing things behind your back, and on a personal install it runs entirely on your own machine so nothing leaves your computer. The firm-wide version of this (Firm Philosophy) and the financial-advisor version (households) come in a later release.

---

## 1. The core insight (read this first)

Advisor Prep Hero already answers questions across a lawyer's documents and email with cited answers, scoped to one matter. But every answer starts from a cold question. The lawyer still carries the *client picture* in their head, and re-builds it every time they re-open a matter after weeks away.

The Client Map turns that picture into a **persistent, structured, source-linked artifact** the app maintains for them. It is the difference between "a private search engine over my files" and "a private intelligence layer that actually knows my clients" — which is exactly the repositioning.

Crucially, the seed already exists. `matterAtAGlance.ts` already does a matter-scoped RAG retrieval and asks an AI for `{openIssues, deadlines, nextActions}`, honoring Local-only mode and the safe-by-default cloud gate. The Client Map **grows that transient three-bullet summary into a durable, richer, editable profile.** We are extending proven plumbing, not inventing a new subsystem.

---

## 2. Decisions locked (from the 2026-06-22 brainstorm — do not relitigate without board input)

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | **Core job of v1** | **"Catch me up fast"** — an instant briefing of where the client stands | Delivers value on first open with zero data entry; the other ideas hang off it |
| 2 | **Durability** | **Saved and living** — a stored profile the app keeps current; not rewritten on the fly | Instant on open; editable/correctable; gives Context Completeness a stable thing to measure |
| 3 | **Update model** | **Approve-first** — AI drafts updates into a review tray; you accept/tweak; nothing silent; your edits never overwritten | "AI proposes, the professional decides" made literal |
| 4 | **Sourcing** | **Every item links to the exact document or email it came from** | The Advisor Prep Hero promise: nothing floats unsourced |
| 5 | **Custom categories** | Users add their own sections; the AI populates them from content per the user's plain-language description | Shapes the map to how each professional thinks |
| 6 | **Category reach** | **Three levels:** (1) this client, (2) saved personal template reusable across your clients, (3) firm-wide standard (= Firm Philosophy). v1 ships levels 1–2; level 3 lands with firm work | Custom categories and Firm Philosophy are the same machine at different zoom |
| 7 | **Context Completeness** | **Three honest lists** (what I know / what I'm assuming / what to ask) + a **coarse level** (Thin · Getting there · Solid). **No percentage.** | This audience distrusts false precision; a "73%" on a legal matter overclaims |
| 8 | **Guided Client Interview** | **Focused walk-through is the headline** (one question at a time over the biggest gaps) **plus** in-map quick buttons. Answer-yourself fills the map; flag-to-ask builds a "questions for the client" list | The named feature; fastest way to turn a folder into a full picture |
| 9 | **Firm Philosophy** | Firm-wide standard categories + a written "how we serve clients" guidance note the AI follows + standard intake questions. **v2 (firm-tier).** | Full version of "our way of serving clients," stored and applied, never "learned" |
| 10 | **Local-only behavior** | On a personal install the map **builds itself with the on-device AI by default** (nothing leaves the machine, no account); sharper if the user adds their own cloud key | The "safe to use on your own" promise, made real; matches the safe-by-default work just shipped |
| 11 | **v1 unit** | The lawyer's **matter** (one client's case). Advisor "household" is a v2 reuse of the same model | ICP = litigation-heavy solos and small law firms |
| 12 | **v1 scope** | The **full personal version** (decisions 1–8, 10, 11). v2 = Firm Philosophy, household, richer extras | Ships an impressive, complete-feeling thing fastest; is the "start on your own" story |

**Non-goals (explicitly out of scope for v1):**
- No Firm Philosophy / firm-wide categories (level 3). The data model leaves room; the UI does not ship it.
- No advisor "household" unit. (The model is unit-agnostic so this is a later reuse, not a rewrite.)
- No completeness percentage/score. Coarse level only.
- No cross-matter Client Map. A map is always scoped to exactly one matter.
- No richer extras yet: timeline view, communication style, prior-advice section, relationship graph. (Custom categories can approximate some of these in the meantime.)
- No change to firm-tier cryptography, SSO, ethical walls, or the relay.

---

## 3. The user-facing shape

### 3.1 The Client Map page (per matter), top to bottom

| # | Section | Source | Notes |
|---|---|---|---|
| 1 | **The story so far** | new | A short AI-written narrative (editable). 3–6 sentences. |
| 2 | **Key people** | new | People involved + their relationship to the matter. |
| 3 | **Where things stand** | grows `openIssues` | Open issues / loose threads. |
| 4 | **What's coming** | grows `deadlines` | Dates and deadlines. |
| 5 | **Next actions** | grows `nextActions` | Recommended next steps. |
| 6 | **What I'm missing** (Context Completeness) | new | Three lists (know / assuming / ask) + level chip (Thin · Getting there · Solid). |
| 7 | **Your own sections** (custom categories) | new | Zero or more user-defined sections, AI-populated. |

Every item in every section carries one or more **source links** (a document path or an email) the user can click to verify. Items with no direct supporting source are shown as **assumptions**, not facts (this is also what feeds the "what I'm assuming" list in section 6).

### 3.2 Behaviors

- **Instant on open.** The stored map renders immediately; no AI wait.
- **Approve-first updates.** When the matter's indexed content changes (new files/emails), an incremental AI pass produces **proposed updates** that collect in a review tray surfaced by a small "updates to review" marker. The user accepts, edits, or dismisses each. Accepted changes merge in; dismissed ones don't reappear unless the underlying source changes again.
- **User edits are sovereign.** Any item the user writes or edits is marked user-origin and is **never overwritten** by an AI pass. The AI may *propose* a change next to it, but the user's text stands until the user changes it.
- **Private by default.** Generation uses the same provider-selection as `matterAtAGlance`: Local-only mode → on-device Ollama; personal install with a cloud key → only after `assertCloudGenerationAllowed()`; firm install → unchanged. The map works on a personal install with no cloud key (on-device), and gets sharper with a cloud key.

### 3.3 Guided Client Interview

- **Focused mode (headline):** a calm, one-question-at-a-time flow over the biggest gaps (drawn from the "what to ask" list, decision 7). For each question the user either **answers it** (creates a user-origin item in the relevant section, sourced to "you told me") or **flags it to ask the client** (adds it to a per-matter "questions for the client" list).
- **In-map quick buttons:** the same gaps appear in section 6 with inline "I know this" / "ask the client" buttons, for handling one-off without entering the focused mode.
- **Questions for the client:** a simple per-matter list the user can review/copy before a meeting.

### 3.4 Custom categories and templates (levels 1–2)

- **Add to this client (level 1):** name a section + write a plain-language description of what to track; the AI populates it from matter-scoped content, with sources.
- **Save as template (level 2):** persist the section's title + description as a reusable template the user can drop onto any of their matters.
- **Level 3 (firm-wide) is v2** — the data model carries an optional `scope: 'matter' | 'personal-template' | 'firm'` so v2 adds firm without migration.

---

## 4. Architecture & data model

### 4.1 Where it lives

- **New feature surface:** `src/features/clientMap/` (the page, the review tray, the Guided Interview, the custom-category editor, the template manager). Depends on `platform`/`ui`/`lib` only; entered from the matter hub (`src/features/matters/`). Per the architecture DAG, cross-feature wiring goes through the shell (`src/app/`) or shared platform state, not feature-to-feature imports.
- **New platform capability:** `src/platform/clientMap/` (the store, the generator, the updater, the types). This is where the durable model and the AI passes live, reusing `platform/rag` (MemoryService retrieval + `buildWorkspaceContextBlock`), `platform/providers` (provider selection), and `platform/privacy` (the safe-by-default guard). It mirrors the `platform/matter` + `matterAtAGlance` pattern.
- **Persistence:** a new localStorage key (e.g. `keepance:client-maps`), maps keyed by `matterId`. **Additive only** — do not rename or repurpose the locked matter keys (`keepance:matters`, `keepance:matter-ui-snapshots`, `keepance:matter-at-a-glance`). Templates persist under their own key (e.g. `keepance:client-map-templates`).

### 4.2 Types (sketch — finalize in the plan)

```ts
type CompletenessLevel = 'thin' | 'getting-there' | 'solid';
type ItemOrigin = 'ai' | 'user';
type SectionScope = 'matter' | 'personal-template'; // 'firm' added in v2

interface SourceRef {
  kind: 'document' | 'email';
  ref: string;        // workspace path or mail message id
  snippet: string;    // the supporting quote (from the RagHit)
}

interface ClientMapItem {
  id: string;
  text: string;
  origin: ItemOrigin;          // 'user' items are sovereign — never AI-overwritten
  isAssumption: boolean;       // true => no strong source; feeds the "assuming" list
  sources: SourceRef[];
  updatedAt: string;
}

interface ClientMapSection {
  id: string;
  kind: 'core' | 'custom';
  key: string;                 // 'story'|'people'|'standing'|'upcoming'|'next'|'completeness'| custom uuid
  title: string;
  prompt?: string;             // for custom sections: the user's plain-language description
  scope?: SectionScope;        // custom sections only
  items: ClientMapItem[];
}

interface ProposedUpdate {
  id: string;
  sectionKey: string;
  op: 'add' | 'change' | 'remove';
  itemId?: string;             // for change/remove
  draft?: ClientMapItem;       // for add/change
  reason: string;              // why the AI proposes this (with sources)
  createdAt: string;
}

interface ContextCompleteness {
  level: CompletenessLevel;
  know: ClientMapItem[];       // derived/aggregated view; sourced facts
  assuming: ClientMapItem[];   // isAssumption items
  ask: string[];               // gap questions -> feed the Guided Interview
}

interface ClientMap {
  matterId: string;            // isolation key — always exactly one matter
  sections: ClientMapSection[];
  completeness: ContextCompleteness;
  pendingUpdates: ProposedUpdate[];
  lastBuiltAt: string;
  lastSourceFingerprint: string; // to detect when re-generation is warranted
}

interface CustomCategoryTemplate {
  id: string;
  title: string;
  prompt: string;
  scope: SectionScope;         // 'personal-template' in v1
}

interface ClientQuestion { id: string; text: string; askedSection?: string; }
```

### 4.3 Generation & update flow

1. **Build (first time / on demand):** matter-scoped `MemoryService.retrieve` over a set of section-targeted queries → `buildWorkspaceContextBlock` → one structured AI call per section group → items with `sources` mapped from the RagHits. Provider chosen via the `matterAtAGlance` pattern (Local-only → Ollama; cloud only after `assertCloudGenerationAllowed()`).
2. **Detect staleness:** compute a cheap fingerprint of the matter's indexed set (count + latest timestamps). When it changes vs `lastSourceFingerprint`, schedule an incremental pass.
3. **Incremental pass → proposed updates:** the AI compares the current map against new retrieval and emits `ProposedUpdate`s rather than mutating the map. These land in `pendingUpdates`; the UI shows the marker.
4. **User review:** accept → merge; edit → merge as user-origin; dismiss → drop. User-origin items are excluded from AI overwrite at merge time.
5. **Assumptions:** an item with no strong supporting source (or AI-flagged low confidence) gets `isAssumption: true`; these populate the "what I'm assuming" list and downweight the completeness level.

### 4.4 Matter isolation (hard requirement)

Every retrieval for a Client Map uses `{ kind: 'matter', matterId }`. **Never `allMatters`.** Sources may only reference content indexed under that matter. The `matterScopeGuard` / privileged-matter rules apply unchanged. A Client Map cannot surface another client's data.

---

## 5. v1 vs later

**v1 (this spec → plan → build):** core sections 1–6, custom categories levels 1–2 (+ templates), Context Completeness (lists + coarse level), Guided Interview (focused + in-map + questions-for-the-client list), per-item source links, approve-first update tray, on-device default with cloud-after-consent, full editability, matter-scoped isolation.

**v2 (later, lands with the firm work — Mission 1 Phase 4 + firm subsystem):** Firm Philosophy (level-3 firm-wide categories + the "how we serve clients" guidance note applied during generation + firm-wide standard intake questions), advisor "household" unit, richer extras (timeline, communication style, prior-advice, relationships). The v1 model is built unit-agnostic and scope-aware so v2 is additive.

---

## 6. Hard rules (violating any is a defect, not a style nit)

- **Matter isolation:** Client Map retrieval is single-matter only; never `allMatters`; sources only from that matter.
- **No silent cloud egress:** generation respects `isLocalOnlyMode()` and `assertCloudGenerationAllowed()` exactly as `matterAtAGlance` does. Personal installs never auto-egress.
- **AI proposes, the professional decides:** all AI changes flow through the approve-first tray; user-origin items are never overwritten.
- **Everything is sourced:** every AI item carries source links or is explicitly marked an assumption.
- **Firm installs unchanged:** branch on `isFirm`/`useFirm`; v1 adds no firm behavior.
- **Never claim "compliant"/"guaranteed":** there are tests asserting this.
- **Voice:** no em dashes in any user-facing string (there is a test); no AI tells (no "leverage/seamless/transform/empower/elevate/unlock"); first-person, concrete nouns. Microcopy stays minimal; the marketing session owns final wording and does one harmonization pass.
- **Locked names:** "Client Map," "Context Completeness," "Guided Client Interview," "Firm Philosophy." Frame Firm Philosophy as "stores and applies," never "learns."
- **No build/deploy** without Jameson's explicit go.

---

## 7. Open questions to settle in the implementation plan

1. **Update trigger cadence:** on matter open + on index-change event (debounced) vs a periodic background sweep. Recommendation: on-open + on-index-change, debounced; no always-on background loop in v1.
2. **Assumption detection:** purely "no strong source" vs also an AI self-reported confidence flag. Recommendation: both — no-source OR AI-flagged-low-confidence ⇒ assumption.
3. **Section-targeted retrieval:** one retrieval reused across sections vs a few targeted queries (people, dates, issues). Recommendation: a small fixed set of targeted queries, capped, to keep token cost bounded.
4. **Surface entry point & route:** a tab inside the matter hub vs a top-level surface. Recommendation: open from the matter hub; the map is the matter's "home."
5. **First-render when empty:** a matter with no indexed content yet → an honest empty state inviting indexing/Guided Interview (mirror `matterAtAGlance`'s empty result).

---

## 8. Testing posture

- **Isolation tests:** a Client Map for matter A never includes content/sources from matter B (extend the existing matter-scope tests).
- **Privacy tests:** Local-only mode forces on-device generation; personal cloud generation is gated by `assertCloudGenerationAllowed()` (mirror the `matterAtAGlance` privacy tests).
- **Sovereignty tests:** an AI incremental pass never mutates a user-origin item; proposed changes land in the tray instead.
- **Voice test:** no em dashes in any Client Map user-facing string (the repo-wide test already enforces this).
- **Model/store tests:** persistence round-trips, template reuse, completeness-level derivation, proposed-update accept/edit/dismiss.
- Gates green per task: `npm run typecheck` (0) · `npx vitest run` · `node scripts/eslint-gate.mjs` · `npm run gate`.
