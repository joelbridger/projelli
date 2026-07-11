# 02 — Data model + storage design (CRM core)

**Lane B deliverable. Status: DRAFT for freeze review.** This spec is written to be
**frozen and built against without iteration** (per `LANTERN-CRM.md` §"one-shot
workflow"), so it errs toward completeness. Every claim about existing code cites a
repo path in `/home/jameson/lantern-crm`.

Scope: the typed CRM core — entities, identity/merge, storage, the matter-facade
mapping, provenance/dating, and retention/audit. Sync transport, notification
envelopes, and the workflow-propagation merge **algorithm** are lane C
(`03-sync-and-notifications.md`); this doc defines the **doc shapes** those algorithms
operate on and the exact merge semantics per field, but not the wire protocol beyond
what already ships.

---

## 0. Foundational decisions (read first — everything below follows from these)

These are locked by `LANTERN-CRM.md` §"Pre-made architecture decisions" and the
feasibility read (`~/lantern-plus/user-research/analysis-drafts/crm-core-feasibility.md`).
Restated as the four rails this model is built on:

- **D0.1 — Doc is truth, SQL is a disposable index.** Every shared CRM record is a
  **Yjs CRDT document** (feasibility caveat #2). The **SQLCipher tables are a
  materialized read-model rebuilt deterministically from the decrypted docs** — never
  the source of truth. If the index is deleted, it is rebuilt from docs with no data
  loss. This is the single most important rule in this spec. It mirrors how the app
  already treats the CRM connector mirror: `crm_objects.json` holds the raw record and
  the render/index state (`crm_render_state`) is derived and rebuildable
  (`src-tauri/src/commands/crm/store.rs:176-214`).

- **D0.2 — All records live in the Rust SQLCipher store from day one, never browser
  `localStorage`.** The matter list (`src/platform/matter/matterStore.ts`) and Client
  Map (`src/platform/clientMap/clientMapStore.ts`) live in `localStorage` today; both
  are re-homed here. New encrypted DB `crm-core-enc.db`, following the established
  per-connector `store.rs` template exactly (`src-tauri/src/commands/crm/store.rs:150-227`).

- **D0.3 — The `matter_id` facade is never renamed.** A `Household` **attaches to**
  exactly one `matter_id`; it does not replace it. `Matter` stays the confidentiality/
  retrieval boundary it is today (`src/platform/types/matter.ts:1-13`). Nothing in this
  model renames `matter`, `Matter`, or `matter_id`.

- **D0.4 — The relay is server-blind; shared views are computed client-side after
  decrypt.** No CRM field is ever queryable server-side. The relay only ever stores
  opaque ciphertext keyed by plaintext scope metadata (`matter_id`, `doc_id`, cursor),
  exactly as the co-editing oplog does today (`src/platform/firm/contract.ts:232-252`,
  `MatterSyncClient.ts:1-26`). Every "who's overdue / team task list" answer is a local
  index query over docs this device has synced.

### 0.5 Conventions used in this document

Field specs are given as TypeScript interfaces (the app is TS-first; the Rust store
mirrors the shapes, as `model.rs` already mirrors the connector DTOs). Per-field CRDT
merge class is tagged in §2 with these markers:

| Marker | Meaning | Yjs representation |
|---|---|---|
| **LWW** | Last-writer-wins register | value in a `Y.Map` + companion `…#hlc` field (see §2.1) |
| **SEQ** | Character/element sequence, true co-edit merge | `Y.Text` or `Y.Array` |
| **SET** | Add-wins observed-remove set (OR-Set) | `Y.Map<id, member>` keyed by element id |
| **CNT** | Monotonic counter (grow-only or PN) | `Y.Map` of per-actor partial counts |
| **IMM** | Immutable once set; concurrent writes must converge to the same value | plain field, written once |
| **APP** | Append-only log; entries never mutate or delete | `Y.Array`, insert-only |

Timestamps are ISO-8601 UTC strings unless noted. IDs are defined in §2.1.

---

## 1. Entities

Every entity extends a shared base. The base carries identity + provenance + dating so
§5 (provenance) and §6 (retention) apply uniformly.

```ts
// Shared base for every CRM-core entity (the "record is a claim with provenance" rule,
// path4-deep-dive §4 principle 2).
interface CrmBase {
  id: string;              // IMM — stable typed id, §2.1
  kind: EntityKind;        // IMM — discriminator, e.g. 'household' | 'person' | ...
  matterId: string;        // IMM — the locked facade scope key (D0.3). '__firm__' for firm-level docs.
  createdAt: string;       // IMM — ISO, first write
  createdBy: ActorRef;     // IMM — who/what created it
  updatedAt: string;       // LWW — newest field write across the whole record (§5)
  updatedBy: ActorRef;     // LWW — actor of the newest write
  source: Provenance;      // LWW — where this record most-recently came from (§5)
  deleted: boolean;        // LWW — soft-delete tombstone (mirrors crm_objects.deleted, store.rs:83)
  externalRefs: ExternalRef[]; // SET — provider ids this maps to (Wealthbox/SFDC/Redtail), §4
  schemaVersion: number;   // LWW — doc schema version for forward migration
}

type EntityKind =
  | 'household' | 'person' | 'account' | 'fact' | 'note' | 'task'
  | 'workflowTemplate' | 'workflowInstance' | 'servicePolicy'
  | 'activityEvent' | 'firmDoc' | 'tag' | 'customFieldDef'
  | 'opportunity' | 'savedView';

interface ActorRef {
  userId: string;          // firm member id, or 'system'
  seat?: string;           // author_seat from the relay oplog (contract.ts:238) when known
  display: string;         // cached display name for offline render
  kind: 'user' | 'ai' | 'system' | 'import';
}

// Provenance — where a value came from. Reuses/extends the Client Map SourceRef union
// (src/platform/clientMap/types.ts:31-41) so citations stay first-class end-to-end.
interface Provenance {
  origin: 'user' | 'ai' | 'import' | 'connector' | 'meeting' | 'system';
  sources: SourceRef[];    // 0..n citations (document/email/crm/meeting/…), types.ts:31
  importBatchId?: string;  // set when origin === 'import' (§4 migration)
  note?: string;           // freeform "how we know this"
}

interface ExternalRef {
  provider: 'wealthbox' | 'salesforce' | 'redtail' | string; // CrmRecordProvider, model.rs:21-27
  externalId: string;      // provider-native id, e.g. wealthbox '10002' or 'sfdc:001…'
  crmKey: string;          // the provider-safe crm_key() value, model.rs:314-317
  lastSyncedAt?: string;
}
```

`SourceRef`, `CrmStreetAddress`, `CrmEmailAddress`, `CrmPhoneNumber`, `CrmTag` are reused
verbatim from existing code (`src/platform/clientMap/types.ts:31`,
`src-tauri/src/commands/crm/model.rs:118-180`). Reuse over reinvention keeps the migration
importer (which already produces these, `model.rs:288-303`) a near-passthrough.

### 1.1 Household

The first-class client entity that the `Matter` scope tag never was
(`src/platform/types/matter.ts:25` — "a household is not a first-class object" today).

```ts
interface Household extends CrmBase {
  kind: 'household';
  name: string;                 // LWW — display name, e.g. "The Andersons" (mirrors CrmContact.name for type=household, model.rs:213)
  greeting?: string;            // LWW — salutation for client-facing docs
  status: 'prospect' | 'active' | 'inactive' | 'former'; // LWW — lifecycle (extends CrmContact.status, model.rs:246)
  clientSince?: string;         // LWW — date (CrmContact.client_since, model.rs:236)
  memberIds: string[];          // SET — Person ids in this household (the household graph)
  primaryContactId?: string;    // LWW — the "Head" member (CrmHouseholdMember.title, model.rs:84)
  servicePolicyId?: string;     // LWW — ref to ServicePolicy (§1.9)
  tagIds: string[];             // SET — Tag ids (§1.12)
  customFields: CustomFieldValueMap; // §1.13
  addresses: Keyed<CrmStreetAddress>;// SET — household-level addresses (model.rs:120)
  primaryAdvisorId?: string;    // LWW — "is that my client or Seattle's" (E-085)
  ownership: 'mine' | 'shared' | 'other'; // LWW — book-of-business ownership (E-085)
  pinnedFactIds: string[];      // SET — facts pinned as permanent memory (E-073)
  archived: boolean;            // LWW — organizational hide (mirrors Matter.archived, matter.ts:167)
}
```

### 1.2 Person (including external parties)

One row per human/trust/org, whether a household member OR an external professional
(accountant, attorney, trusted contact). External parties are Persons flagged `external`
with a **verified-recipient link** so client-facing sends to them are gated (E-095).

```ts
interface Person extends CrmBase {
  kind: 'person';
  personType: 'person' | 'trust' | 'organization'; // mirrors CrmContact type ∈ person|trust|org (model.rs:186)
  householdIds: string[];       // SET — households this person belongs to (usually 1; trusts/orgs may span)
  role?: string;                // LWW — household role: Head/Spouse/Partner/Child (CrmHouseholdMember.title, model.rs:84)

  // identity (all LWW) — mirror CrmContact identity block, model.rs:215-231
  firstName: string; middleName?: string; lastName: string;
  nickname?: string; prefix?: string; suffix?: string;
  companyName?: string; jobTitle?: string;

  // key dates (all LWW) — CrmContact dates, model.rs:233-238
  birthDate?: string; anniversary?: string; retirementDate?: string; dateOfDeath?: string;
  maritalStatus?: string;       // model.rs:242

  // investor profile (all LWW) — model.rs:262-268
  investmentObjective?: string; timeHorizon?: string; riskTolerance?: string;

  // financial profile — modeled as FACTS (§1.4), NOT flat fields.
  // Rationale: money is a dated claim, not a bare number (path4 §4 principle 2). The
  // connector's flat gross_annual_income/assets/liabilities (model.rs:270-277) migrate
  // into Fact records (§4.3), so staleness is visible.

  // contact channels (SET, keyed) — reuse connector sub-structs verbatim, model.rs:118-146
  addresses: Keyed<CrmStreetAddress>;
  emails: Keyed<CrmEmailAddress>;
  phones: Keyed<CrmPhoneNumber>;

  // narrative (LWW) — CrmContact prose, model.rs:256-260
  background?: string; importantInfo?: string; personalInterests?: string;

  tagIds: string[];             // SET
  customFields: CustomFieldValueMap;

  // ── external party fields (present when isExternal) ─────────────────────────
  isExternal: boolean;          // LWW — true for accountant/attorney/etc. (path4 §5.1)
  externalRole?: 'accountant' | 'attorney' | 'cpa' | 'doctor' | 'insurance'
    | 'business_manager' | 'family_officer' | 'trusted_contact' | 'other'; // maps CrmContact professional-relationship pointers, model.rs:279-286
  servesHouseholdIds: string[]; // SET — households this external party serves
  verifiedRecipient?: VerifiedRecipientLink; // LWW — gate for client-facing sends (E-095)
}

interface VerifiedRecipientLink {
  verified: boolean;
  verifiedAt?: string;
  verifiedBy?: ActorRef;
  channel: 'email' | 'esign' | 'portal';
  address: string;              // the verified email / recipient id
}
```

**Professional-relationship migration:** the connector stores attorney/cpa/etc. as
**contact ids on the person** (`model.rs:279-286`, `attorney: Option<i64>`). On import
these become: (a) an external `Person` for the professional, and (b) a `Fact` of type
`professional_relationship` linking household→person (§4.3), so the link wears a date and
source like every other claim.

### 1.3 Account

**The genuine gap** — no `Account` struct exists anywhere today (feasibility §1;
`model.rs` has only flat financial fields on the contact). This is the fix for E-076/E-073
("account purpose", "Wells Fargo — rentals").

```ts
interface Account extends CrmBase {
  kind: 'account';
  householdId: string;          // IMM — owning household
  ownerPersonIds: string[];     // SET — owning person(s)
  custodian: string;            // LWW — "Schwab", "Wells Fargo", "Fidelity"
  accountType: string;          // LWW — IRA / Roth / Joint / Trust / 401k / Taxable / …
  registration?: string;        // LWW — legal registration text
  last4?: string;               // LWW — masked account number (never full number; §6 privacy)
  purpose?: string;             // LWW — THE fix for E-073: "rentals", "college", "emergency"
  ownership: 'individual' | 'joint' | 'trust' | 'entity'; // LWW
  status: 'open' | 'closed' | 'pending' | 'transferring'; // LWW
  openedAt?: string; closedAt?: string; // LWW
  // Balances are FACTS (§1.4, factType 'account_balance'), not a field — a balance is a
  // dated observation. Latest-balance queries read the newest such Fact (§5.2).
  tagIds: string[];             // SET
  customFields: CustomFieldValueMap;
}
```

### 1.4 Fact — the promoted Client Map

The Client Map today is **freeform bullets** (`ClientMapItem { id, text, sources[] }`,
`src/platform/clientMap/types.ts:43-51`) — no typed value, no status, no `asOf`. `Fact`
promotes a bullet into a **typed, dated, sourced claim** (path4 §4 principle 2, §5.1).

```ts
interface Fact extends CrmBase {
  kind: 'fact';
  householdId: string;          // IMM — scope
  subjectRef?: EntityRef;       // LWW — what the fact is about (person/account/household)
  factType: FactType;           // LWW — typed claim category
  label: string;                // LWW — short human label ("Gross income", "Risk tolerance")
  value: FactValue;             // LWW — typed value (see below)
  text: string;                 // LWW — human-readable rendering (back-compat with a ClientMapItem's `text`)
  status: 'current' | 'superseded' | 'stale' | 'disputed'; // LWW — staleness is visible, never silent (§4 principle 2)
  isAssumption: boolean;        // LWW — no strong source (ClientMapItem.isAssumption, types.ts:47)
  pinned: boolean;              // LWW — "can't disappear" permanent memory (E-073)
  sectionKey?: CoreSectionKey | string; // LWW — which Client Map section it renders in (types.ts:17)

  // dating (§5) — a fact carries THREE dates:
  asOf: string;                 // LWW — the date the fact is TRUE AS OF (e.g. balance as of 2026-06-30)
  observedAt: string;           // LWW — when we learned it
  supersededBy?: string;        // LWW — id of the Fact that replaced this one (audit trail of value history)
}

type FactType =
  | 'income' | 'asset' | 'liability' | 'net_worth' | 'tax_bracket' | 'account_balance'
  | 'goal' | 'risk_tolerance' | 'time_horizon' | 'beneficiary'
  | 'professional_relationship' | 'preference' | 'life_event' | 'note_fact' | 'custom';

type FactValue =
  | { t: 'money'; amount: number; currency: string }
  | { t: 'text'; v: string }
  | { t: 'date'; v: string }
  | { t: 'number'; v: number }
  | { t: 'enum'; v: string }
  | { t: 'entity'; ref: EntityRef }
  | { t: 'none' };              // pure-prose fact (a promoted freeform bullet)
```

**Value history is preserved by chaining, not mutation.** Editing a fact's value mints a
**new** Fact with `supersededBy` set on the old one, so "what was the income last year"
is answerable. This mirrors the connector's soft-delete-plus-new-row shape
(`store.rs:83` tombstone) and the Client Map's `editHistory` append log (`types.ts:59-71`).

### 1.5 Note

Today notes are the connector's `CrmNote { content, linked_to }` (`model.rs:349-359`) —
no audience lane, no pin, no provenance beyond the link. `Note` adds the **two-audience
hard wall** (path4 §4 principle 5, E-050) and pinnability (E-073).

```ts
interface Note extends CrmBase {
  kind: 'note';
  householdId: string;          // IMM
  links: EntityRef[];           // SET — what this note is about (mirrors CrmNote.linked_to, model.rs:358)
  audience: 'internal' | 'client-facing'; // IMM — the hard wall (E-050). IMM because reclassifying is a new note, not a mutation.
  body: string;                 // SEQ — Y.Text, true co-edit merge (reuses the docCrdt Y.Text pattern, docCrdt.ts:33)
  pinned: boolean;              // LWW — pinned notes as permanent memory (E-073)
  title?: string;               // LWW
  format?: 'plain' | 'meeting-note' | 'template'; // LWW — firm's format is sacred (E-032)
  templateId?: string;          // LWW — note template used
  authoredVia?: 'manual' | 'jump-push' | 'meeting-capture' | 'ai'; // LWW — Jump→note push provenance (E-029/030)
  tagIds: string[];             // SET
}
```

### 1.6 Task

Today `CrmTask` has **no assignee, no recurrence, no notifications**
(`model.rs:371-391`; feasibility §1 "It's a read-mirror… not a first-class assignable
task"). `Task` is the first-class, assignable, recurring, CRDT-merged task (path4 §4
principle 3 — "tasks carry judgment").

```ts
interface Task extends CrmBase {
  kind: 'task';
  householdId?: string;         // IMM — scope (optional: firm-level tasks exist)
  title: string;                // LWW (CrmTask.name, model.rs:377)
  description: string;          // SEQ — Y.Text (CrmTask.description, model.rs:381)
  status: 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled'; // LWW (richer than CrmTask.complete bool, model.rs:379)
  assigneeIds: string[];        // SET — one or many firm members (the missing field)
  dueDate?: string;             // LWW (CrmTask.due_date, model.rs:378)
  startDate?: string;           // LWW
  priority: 'low' | 'normal' | 'high' | 'urgent'; // LWW (CrmTask.priority, model.rs:380)
  recurrence?: RecurrenceRule;  // LWW — the missing recurrence semantics (E-049/E-075)
  parentTaskId?: string;        // IMM — subtask/recurrence-parent link
  category?: string;            // LWW — team/category (the missing field)
  contextRefs: EntityRef[];     // SET — meeting/account/note/opportunity this task hangs off (E-119 judgment context)
  links: EntityRef[];           // SET — CrmTask.linked_to equivalent (model.rs:390)
  workflowInstanceId?: string;  // IMM — set when this task is a workflow step's task
  workflowStepId?: string;      // IMM
  completedAt?: string; completedBy?: ActorRef; // LWW
  tagIds: string[];             // SET
  customFields: CustomFieldValueMap;
}

interface RecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;             // every N units
  byWeekday?: number[];         // 0..6
  byMonthDay?: number[];        // 1..31
  count?: number;               // end after N occurrences
  until?: string;               // end date
  regenerateOnComplete: boolean;// true = "next due N after completion" (advisor pattern) vs. fixed calendar
}
```

Recurrence expansion is **materialization, not storage**: the rule is stored once; the
next concrete instance is spawned as a child Task on completion (mirrors how the connector
never stores expansions). The propagation-merge risk is lane C's.

### 1.7 WorkflowTemplate (versioned)

The existing `WorkflowTemplate`/`WorkflowStep` types are **AI-run pipelines, not human
task checklists** (feasibility §6; `src/platform/types/workflow.ts:6-46` — steps are
`interview | generate | review | analyze` model calls). This is a **new, differently
shaped** entity: an ordered human checklist with owners/roles, versioned so edits can
propagate to open instances (the marquee feature, E-098/E-099).

```ts
interface WorkflowTemplate extends CrmBase {
  kind: 'workflowTemplate';
  matterId: '__firm__';         // IMM — firm-level, not per-household (§2.6)
  name: string;                 // LWW
  description: string;          // SEQ — Y.Text
  category?: string;            // LWW — "Money Movement", "Post-Meeting", "Onboarding" (E-092/093)
  version: number;              // LWW/CNT — monotonic; bumped on any step-set change
  status: 'draft' | 'published' | 'archived'; // LWW
  steps: Keyed<WorkflowStepDef>;// SEQ+SET — ordered, id-keyed (order is a SEQ of ids; bodies are a SET)
  stepOrder: string[];          // SEQ — Y.Array of step ids (the order sequence)
  triggerHints: string[];       // SET — patterns that suggest "convert this ad-hoc task?" (E-092/093)
  tagIds: string[];             // SET
}

interface WorkflowStepDef {
  id: string;                   // IMM — STABLE across versions (this is what makes propagation mergeable, §2.7)
  title: string;                // LWW
  description: string;          // SEQ
  ownerRole?: string;           // LWW — role that owns this step ("advisor", "ops", "CSA")
  defaultAssigneeId?: string;   // LWW
  offsetDays?: number;          // LWW — due N days after instance start / prior step
  required: boolean;            // LWW
  addedInVersion: number;       // IMM — provenance for propagation diffs
  removedInVersion?: number;    // LWW — soft-removal keeps the id alive for merge
}
```

Templates are **versioned by keeping every version's step-set addressable by stable step
id**. A template edit is a diff over step ids; propagating it to an open instance is a
per-step merge (§2.7). Stable step ids are the load-bearing decision that makes
propagation a convergent CRDT merge rather than a clobber.

### 1.8 WorkflowInstance

One running copy of a template against a household, tracking per-step progress and owners
independently of the template.

```ts
interface WorkflowInstance extends CrmBase {
  kind: 'workflowInstance';
  householdId: string;          // IMM
  templateId: string;           // IMM
  templateVersion: number;      // LWW — the version this instance was LAST reconciled to (§2.7)
  name: string;                 // LWW — instance label (usually template name + household)
  status: 'open' | 'completed' | 'cancelled'; // LWW
  startedAt: string;            // IMM
  completedAt?: string;         // LWW
  steps: Keyed<WorkflowStepProgress>; // per-step progress, id-keyed by the template's stable step id
  pendingPropagations: PropagationOffer[]; // APP/SET — reviewed template changes awaiting per-step accept (E-099 "review which get the change")
}

interface WorkflowStepProgress {
  stepId: string;               // IMM — matches WorkflowStepDef.id (the merge key)
  status: 'todo' | 'in_progress' | 'done' | 'skipped'; // LWW — per-step, so a template edit never clobbers progress
  assigneeId?: string;          // LWW
  taskId?: string;              // IMM — the Task materializing this step (§1.6)
  completedAt?: string; completedBy?: ActorRef; // LWW
  // snapshot of the step definition this instance is currently honoring, so an
  // instance renders correctly even offline from the template:
  titleSnapshot: string;        // LWW
  fromTemplateVersion: number;  // LWW — which template version this step reflects
}

interface PropagationOffer {
  offerId: string;              // IMM
  fromVersion: number; toVersion: number; // IMM
  stepId: string;               // IMM — the step this change touches
  changeKind: 'add' | 'modify' | 'remove'; // IMM
  proposed: Partial<WorkflowStepDef>; // IMM — the new step content
  decision: 'pending' | 'accepted' | 'rejected'; // LWW — the human review gate (E-099)
  decidedBy?: ActorRef; decidedAt?: string; // LWW
}
```

**The propagation contract (shapes only; algorithm = lane C):** editing a template mints
`PropagationOffer`s onto each open instance, one per changed step, keyed by stable step
id. A present human accepts/rejects per step; accept applies the change to that instance's
`WorkflowStepProgress` **without touching its `status`** (progress is preserved). Because
every offer and every step is keyed by an IMM step id, two reviewers on two devices merge
convergently (accept-wins on `decision` is LWW with tiebreak). This is the correctness-
critical seam flagged XL in feasibility §6.

### 1.9 ServicePolicy

Who-meets-when knowledge that lives "in heads + Wealthbox context" today (E-085/086).

```ts
interface ServicePolicy extends CrmBase {
  kind: 'servicePolicy';
  matterId: '__firm__' | string;// IMM — firm-level tiers OR a household override
  scope: 'firm-tier' | 'household-override'; // LWW
  tierName: string;             // LWW — "Platinum", "A-client", "Household"
  meetingCadence?: 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'custom'; // LWW
  cadenceDays?: number;         // LWW — for custom
  nextReviewDue?: string;       // LWW — computed + stored for the reports surface (§5.2)
  reviewChecklistTemplateId?: string; // LWW — a WorkflowTemplate for the review
  appliesToHouseholdIds: string[];    // SET — when scope is firm-tier
  description: string;          // SEQ
}
```

### 1.10 ActivityEvent (append-only feed)

The firm-wide activity feed. **Append-only, never mutated** — modeled on the reusable
append-only patterns already in the app: the hash-chained audit store
(`src-tauri/src/commands/audit/store.rs:12-16` "append/list/count only") and the frontend
`AuditEvent` discriminated union (`src/platform/audit/AuditService.ts`). Team-notification
blasts on important notes (E-021) read off this feed.

```ts
interface ActivityEvent extends CrmBase {
  kind: 'activityEvent';
  // APP semantics: an ActivityEvent doc-stream is insert-only (Y.Array); entries are
  // never edited or deleted. Deleting the derived index row does not delete the event.
  at: string;                   // IMM — when it happened
  actor: ActorRef;              // IMM
  verb: ActivityVerb;           // IMM — 'task.assigned' | 'note.added' | 'fact.changed' | 'workflow.step.done' | 'account.opened' | …
  targetRef: EntityRef;         // IMM — the entity acted on
  householdId?: string;         // IMM — scope for per-client timeline
  summary: string;              // IMM — human one-liner for the feed
  payload: Record<string, unknown>; // IMM — verb-specific detail (mirrors AuditEntryRecord.payload_json, store.rs:44)
  important: boolean;           // IMM — drives the notification blast (E-021)
}
```

Note the deliberate parallel to `AuditEntryRecord` (`audit/store.rs:31-45`): id +
timestamp + action(verb) + description(summary) + payload_json. ActivityEvent is the
**business feed**; the hash-chained audit log stays the **compliance defense file** (§6).
They are separate stores with different guarantees (feed = mergeable CRDT; audit =
tamper-evident append-only).

### 1.11 FirmDoc / ProcessDoc

Firm ways-of-working, note templates, report layouts — "the firm's format is sacred"
(E-032, E-091).

```ts
interface FirmDoc extends CrmBase {
  kind: 'firmDoc';
  matterId: '__firm__';         // IMM
  docType: 'process' | 'note-template' | 'report-layout' | 'ways-of-working' | 'other'; // LWW
  title: string;                // LWW
  body: string;                 // SEQ — Y.Text (can also point at a workspace .docx via bodyRef)
  bodyRef?: string;             // LWW — workspace path to a .docx when the body is a Word doc (§3.5)
  tagIds: string[];             // SET
  pinned: boolean;              // LWW
}
```

### 1.12 Tag

```ts
interface Tag extends CrmBase {
  kind: 'tag';
  matterId: '__firm__';         // IMM — tags are firm-global (mirrors CrmTag, model.rs:175-180)
  name: string;                 // LWW
  color?: string;               // LWW
  category?: string;            // LWW — tag group
  externalRefs: ExternalRef[];  // SET — Wealthbox tag id mapping
}
```

### 1.13 CustomField definitions + values

Custom fields are **not modeled today** (feasibility §5 — `contact_roles` kept as raw
`serde_json::Value`, `model.rs:302`). Definitions are firm-level entities; values live
inline on records as a typed map.

```ts
interface CustomFieldDef extends CrmBase {
  kind: 'customFieldDef';
  matterId: '__firm__';         // IMM
  appliesTo: EntityKind[];      // LWW — ['household'] | ['person'] | ['account'] | …
  key: string;                  // IMM — stable programmatic key
  label: string;                // LWW
  fieldType: 'text' | 'number' | 'money' | 'date' | 'bool' | 'enum' | 'multi-enum'; // LWW
  options?: string[];           // LWW — for enum
  required: boolean;            // LWW
  order: number;                // LWW — display order
  archived: boolean;            // LWW
}

// Stored inline on Household/Person/Account/Task (the CustomFieldValueMap fields above):
type CustomFieldValueMap = Record<string /*def.key*/, CustomFieldValue>; // SET keyed by def.key
type CustomFieldValue = {
  value: string | number | boolean | string[] | null; // LWW per key
  updatedAt: string; source: Provenance;               // §5 — values wear dates/sources too
};
```

### 1.14 Opportunity (pipeline)

**Absent today** (feasibility §5 — "Opportunities / pipeline / stages — absent"). Lane A's
Wealthbox matrix requires it; included as a first-class entity.

```ts
interface Opportunity extends CrmBase {
  kind: 'opportunity';
  householdId: string;          // IMM
  name: string;                 // LWW
  pipelineId: string;           // LWW — which pipeline
  stageId: string;              // LWW — current stage (stages are a firm-level config, below)
  amount?: { value: number; currency: string }; // LWW — estimated value / AUM
  probability?: number;         // LWW — 0..100
  status: 'open' | 'won' | 'lost' | 'abandoned'; // LWW
  expectedCloseDate?: string;   // LWW
  closedAt?: string; closeReason?: string; // LWW
  ownerId?: string;             // LWW — advisor owning the opp
  contextRefs: EntityRef[];     // SET — linked accounts/notes/tasks
  tagIds: string[];             // SET
  customFields: CustomFieldValueMap;
}

// Pipeline + stage definitions are firm-level config stored as a small FirmDoc-like entity
// (docType extension) or a dedicated 'pipelineDef' — kept as a firm config doc to avoid a
// 16th top-level entity. Stage list is an ordered SEQ of {id, name, order, isWon, isLost}.
```

### 1.15 SavedView / Report definition

Structured browse for the "Seattle persona" (path4 §5.2, principle 6). A saved view or a
report is a **stored query definition**; results are always computed live (never cached as
truth — path4 §5.2 "Nothing cached as truth").

```ts
interface SavedView extends CrmBase {
  kind: 'savedView';
  matterId: '__firm__' | string;// IMM — firm-shared or personal
  name: string;                 // LWW
  surface: 'tasks' | 'households' | 'opportunities' | 'accounts' | 'report'; // LWW
  visibility: 'personal' | 'firm'; // LWW
  query: ViewQuery;             // LWW — the filter/sort/group definition
  layout: 'table' | 'kanban' | 'list'; // LWW — kanban-by-workflow-stage etc. (path4 §5.2)
  reportKind?: ReportKind;      // LWW — for surface==='report'
}

type ReportKind =
  | 'no_contact_6mo'            // "who hasn't interacted in 6 months" (E-088)
  | 'attention_vs_fee'          // E-124/E-129
  | 'birthdays' | 'age_65' | 'rmd_due' | 'review_due' | 'custom'; // E-129

interface ViewQuery {
  entity: EntityKind;
  filters: FilterClause[];      // structured predicates over indexed columns (§3)
  sort?: { field: string; dir: 'asc' | 'desc' }[];
  groupBy?: string;
}
```

Reports are **computed on demand and stamped "computed just now from N sources"**
(path4 §5.2). The definition is stored; the answer never is.

### 1.16 Shared value types

```ts
interface EntityRef { kind: EntityKind; id: string; matterId?: string; } // typed cross-entity pointer
type Keyed<T> = Record<string /*element id*/, T>;                        // id-keyed map → OR-Set merge (§2)
```

---

## 2. Identity & merge (CRDT model)

### 2.1 Stable ID scheme

- **Primary ids are app-minted, type-prefixed UUIDv7**: `hh_<uuid7>`, `per_<uuid7>`,
  `acct_<uuid7>`, `fact_<uuid7>`, `note_<uuid7>`, `task_<uuid7>`, `wtpl_`, `winst_`,
  `svc_`, `act_`, `fdoc_`, `tag_`, `cfd_`, `opp_`, `view_`. UUIDv7 is time-ordered so the
  SQL index gets locality for free.
- **Provider ids are NEVER primary keys.** Wealthbox numeric ids and `crm_key()` values
  (`model.rs:314-317`) are retained only in `externalRefs[]`. This is the clean decoupling
  feasibility §1/§6 demands ("app-owned editable records decoupled from the connector") and
  it is why importing the same Wealthbox record twice can't collide (the id is minted once
  and remembered by `externalRef`, §4.4).
- **Ids are immutable and globally unique within a firm.** They are the CRDT merge key and
  the citation target; they never change, even across a Wealthbox→Lantern→Wealthbox round
  trip.

### 2.2 One doc per record; per-field merge classes

**Every entity instance is its own Yjs document** (not one giant doc per household). The
Y.Doc root is a single `Y.Map` named `record` holding the entity's fields, following the
established "meta Y.Map + typed children" pattern from co-editing
(`src/platform/firm/coedit/docCrdt.ts:9-52`). Field merge class (from §0.5) determines the
Yjs type used:

- **LWW register** → the value plus a companion hybrid-logical-clock stamp
  `"<field>#hlc"`. On concurrent writes the higher HLC wins; ties break on `actorId`. HLC
  = `(wallClockMillis, logicalCounter, actorId)`; this gives money/status fields a
  deterministic, causally-sensible winner instead of raw wall-clock LWW. (Yjs' built-in
  Y.Map LWW is last-applied-wins by Lamport order; we layer the explicit HLC stamp so the
  **winning value carries its own timestamp for §5 provenance**, not just an implicit one.)
- **SEQ** (`body`, `description`, long prose) → `Y.Text`, giving true character-level
  co-edit merge — the exact machinery co-editing already runs (`docCrdt.ts:33`,
  `MatterSyncClient` §transport). Two advisors typing in the same note body merge without
  loss.
- **SET** (`memberIds`, `assigneeIds`, `tagIds`, `Keyed<T>` maps, `externalRefs`) →
  add-wins OR-Set: a `Y.Map` keyed by element id; add sets the entry, remove tombstones
  it. Concurrent add+remove of different elements both apply; concurrent add-wins over
  remove of the **same** element (advisor intent: an add is information, a remove is
  cleanup).
- **CNT** (`version` counters) → a PN-counter map of per-actor deltas; the value is the
  sum. Used only where a monotonic count matters (template `version`).
- **APP** (ActivityEvent stream, PropagationOffer log) → insert-only `Y.Array`.
- **IMM** (`id`, `kind`, `matterId`, `audience`, step ids) → written once at creation; a
  concurrent-create of "the same" logical record cannot happen because ids are minted
  locally and unique. Where two imports produce the same logical entity, the merge is by
  `externalRef` at the index layer (§4.4), not by mutating IMM fields.

### 2.3 Conflict semantics per field type (the frozen contract)

| Field pattern | Merge class | Concurrent-edit outcome |
|---|---|---|
| Scalars: name, status, dueDate, priority, custodian, purpose, amount, Fact.value | **LWW+HLC** | Higher HLC wins; loser value is recoverable from that actor's ActivityEvent (§6) — nothing is silently gone, but only one value is "current" |
| Long prose: Note.body, Task.description, FirmDoc.body, WorkflowTemplate.description | **SEQ** | Character-level merge; both edits survive |
| Collections: members, assignees, tags, addresses, emails, phones, externalRefs, customFields | **SET (add-wins)** | Union; same-element add beats remove |
| Fact.value change | **new record** | A value change mints a new Fact with `supersededBy` on the old; both persist (value history) |
| WorkflowInstance step progress | **per-step LWW** | Keyed by IMM step id → a template propagation merges without clobbering `status` (§2.7) |
| ActivityEvent, PropagationOffer entries | **APP** | Insert-only; order by `at`/HLC; never mutated |
| version counter | **CNT** | Sum of per-actor increments |

**Why LWW for money/status and not merge:** a balance or a task status has exactly one
true current value; a text-merge of "$100k" and "$120k" is nonsense. LWW+HLC picks a
deterministic winner and the ActivityEvent trail plus Fact-supersession chain preserve the
loser. This is a **named accepted risk** (see §7 Q1) — LWW can drop a concurrent field
edit; the mitigations are (a) per-field HLC so the winner is intentional-looking, (b) the
activity trail, (c) Fact value-history chaining for the one field type where history is
most valued (money).

### 2.4 Yjs doc shape per entity (frozen)

Each entity's Y.Doc = one root `Y.Map record`. Field → Yjs slot:

```
Household record : Y.Map
  name,greeting,status,clientSince,primaryContactId,servicePolicyId,
  primaryAdvisorId,ownership,archived, + "<f>#hlc" stamps      → LWW scalars
  memberIds,tagIds,pinnedFactIds                               → SET (Y.Map<id,true>)
  addresses                                                    → SET (Y.Map<id, addrJson>)
  customFields                                                 → SET (Y.Map<key, {value,updatedAt,source}>)
  id,kind,matterId,createdAt,createdBy                         → IMM (plain)

Person record : Y.Map
  identity/date/profile/narrative scalars + #hlc              → LWW
  householdIds,emails,phones,addresses,tagIds,servesHouseholdIds → SET
  isExternal,externalRole,verifiedRecipient(+#hlc)            → LWW
  customFields                                                → SET

Account record : Y.Map    (custodian,type,last4,purpose,ownership,status,dates = LWW; owners,tags = SET)
Fact record    : Y.Map    (factType,value,status,asOf,observedAt,pinned,supersededBy = LWW; sources in Provenance = LWW blob)
Note record    : Y.Map    (audience,pinned,title = LWW; body = Y.Text SEQ; links,tags = SET)
Task record    : Y.Map    (status,dueDate,priority,recurrence,category = LWW; description = Y.Text SEQ; assigneeIds,contextRefs,links,tags = SET)
WorkflowTemplate record : Y.Map (name,category,version,status = LWW; description = Y.Text; steps = SET Y.Map<stepId,defJson>; stepOrder = Y.Array SEQ)
WorkflowInstance record : Y.Map (templateVersion,status = LWW; steps = SET Y.Map<stepId, progressJson w/ per-field #hlc>; pendingPropagations = Y.Array APP)
ServicePolicy  : Y.Map    (LWW scalars; appliesToHouseholdIds = SET; description = Y.Text)
ActivityEvent  : (not per-record) → one APP Y.Array per stream (§2.5)
FirmDoc        : Y.Map    (docType,title,pinned,bodyRef = LWW; body = Y.Text; tags = SET)
Tag/CustomFieldDef/Opportunity/SavedView : Y.Map (scalars LWW; collections SET)
```

`WorkflowStepDef` and `WorkflowStepProgress` are stored as JSON leaves inside their parent
`Y.Map` **keyed by stable step id**, each with its own `#hlc` stamps on the mutable
sub-fields, so per-step merge works (§2.7). Same technique co-editing uses for run/subrun
maps (`docCrdt.ts:33-52`).

### 2.5 Doc-stream partitioning (which docs sync on which relay stream)

The relay syncs per `(matter_id, doc_id)` stream (`contract.ts:222-245`,
`MatterSyncClient.ts:87-93`). We reuse that exactly. Partitioning:

- **Per-household record streams** (scoped to the household's `matterId`), one `doc_id`
  per entity **collection**, holding a `Y.Map<entityId, entityDoc-as-subdoc-ref>` index
  plus the child docs. Concretely, `doc_id` values under a household's matter:
  `crm/households`, `crm/persons`, `crm/accounts`, `crm/facts`, `crm/notes`, `crm/tasks`,
  `crm/opportunities`, `crm/workflowInstances`, `crm/servicePolicies`, `crm/activity`.
- **Firm-level streams** under a reserved pseudo-matter `__firm__` (with a firm-wide key
  every seat holds): `firm/workflowTemplates`, `firm/firmDocs`, `firm/tags`,
  `firm/customFieldDefs`, `firm/servicePolicies`, `firm/savedViews`, `firm/activity`,
  `firm/pipelines`.

Each stream is a Yjs doc whose root `Y.Map` maps `entityId → Y.Map record` (Yjs supports
nested maps; alternatively subdocs). One stream per collection keeps the co-edit blast
radius small and lets a device sync only the collections it needs — but see §7 Q2: the
firm-wide task rollup requires syncing every household's `crm/tasks`, which tensions with
ethical walls (`backend` `ethical_walls`, feasibility §2). **Accepted for ≤10 seats**
(charter decision #4).

### 2.6 Firm-level vs household-level & the `__firm__` pseudo-matter

Firm-global entities (templates, tags, custom-field defs, firm process docs, firm service
tiers, firm saved views) carry `matterId: '__firm__'` and sync on the firm streams. This
keeps the facade intact (no real matter is renamed; `__firm__` is a sentinel exactly like
`UNASSIGNED_MATTER_ID` at `matter.ts:21`) while giving firm-wide docs a home every seat
syncs. The firm key is distributed through the **existing** per-matter key machinery
(`src/platform/firm/matterKeyService.ts`, `keyWrap.ts`) treating `__firm__` as a matter all
members belong to.

### 2.7 The propagation merge shape (contract for lane C)

Frozen invariants lane C's algorithm must honor:

1. **Step identity is immutable and shared** between template and every instance
   (`WorkflowStepDef.id` == `WorkflowStepProgress.stepId`). This is the merge key.
2. A template edit **never writes to any instance directly**. It mints `PropagationOffer`s
   (APP) onto each open instance's `pendingPropagations`, keyed by `(offerId, stepId,
   fromVersion→toVersion)`.
3. Accepting an offer updates only that step's **definition snapshot** fields
   (`titleSnapshot`, `fromTemplateVersion`) and, if the step is new, adds a
   `WorkflowStepProgress{status:'todo'}`. It **must not** write `status` on an existing
   progress. Progress is sacred.
4. `templateVersion` on the instance advances to `toVersion` only when **all** offers up
   to that version are decided.
5. Two reviewers deciding the same offer concurrently: `decision` is LWW+HLC with
   `accepted` winning ties (accept-wins, matching SET add-wins intuition). An accepted-then-
   rejected race resolves to accepted; the reject is recorded in the activity trail.

Everything about *when/how* offers are generated and applied convergently is lane C; the
**shapes and invariants above are frozen** here.

---

## 3. Storage

### 3.1 The two-layer store: docs (truth) + SQL index (rebuildable)

```
Truth layer  : Yjs docs, synced as encrypted blobs through the relay oplog
               (backend matter_updates, contract.ts:232-252). Local durable copy of each
               doc's current state (the merged Y.Doc) is persisted so the app opens offline.
Index layer  : crm-core-enc.db (SQLCipher) — a materialized read-model, one table per
               entity, REBUILT from decrypted docs. Never authoritative. (D0.1)
```

Write path: user edits → local Y.Doc mutation → (a) encrypt+push the Yjs update to the
relay (reusing `MatterSyncClient.pushLocalUpdate`, `MatterSyncClient.ts:292-315`) and
(b) apply the same change to the SQL index in the same local transaction. Remote path:
decrypted peer update → apply to Y.Doc → re-project the touched entity into the SQL index
(`onRemoteUpdate`, `MatterSyncClient.ts:283`). The index projector is a **pure function of
doc state**, so a full rebuild = replay all docs through the projector. This is the same
"raw record + derived render-state, rebuildable" split the connector already runs
(`crm_objects.json` + `crm_render_state`, `store.rs:176-214`).

### 3.2 SQLCipher schema (`crm-core-enc.db`)

New encrypted DB alongside `crm-enc.db`, `audit-enc.db`, `mail-enc.db`. Opened exactly
like the others: `PRAGMA key = "x'<hex>'"` as the first statement, 32-byte key from the OS
keychain under a **dedicated service** (not shared with mail/crm/vectors), `busy_timeout`
for concurrent sync-loop + indexer writers (`store.rs:158-215`, `audit/store.rs:535-556`).

```sql
-- doc state cache: the merged Yjs state for each entity doc (truth layer local mirror).
-- The authoritative bytes; SQL tables below are projected from these.
CREATE TABLE crm_docs (
  doc_key      TEXT PRIMARY KEY,   -- "<matterId>/<docId>/<entityId>"
  matter_id    TEXT NOT NULL,      -- plaintext scope (queryable) — the pattern RAG already uses (feasibility §4)
  doc_id       TEXT NOT NULL,      -- collection stream, e.g. 'crm/tasks'
  entity_id    TEXT NOT NULL,
  entity_kind  TEXT NOT NULL,
  yjs_state    BLOB NOT NULL,      -- Y.encodeStateAsUpdate(doc) — merged CRDT state
  state_vector BLOB NOT NULL,      -- Y.encodeStateVector — for delta sync catch-up
  updated_at   TEXT NOT NULL,      -- newest field write (§5)
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_crm_docs_scope ON crm_docs(matter_id, doc_id);
CREATE INDEX idx_crm_docs_entity ON crm_docs(entity_id);

-- oplog cursor high-water per stream (mirrors crm_cursors, store.rs:189-192 and the relay
-- oplog cursor, contract.ts:247-249). Lets sync resume without re-pulling.
CREATE TABLE crm_sync_cursors (
  stream_key TEXT PRIMARY KEY,     -- "<matterId>/<docId>"
  cursor     INTEGER NOT NULL,     -- last applied relay cursor
  key_epoch  INTEGER NOT NULL DEFAULT 0
);

-- ── Projected read-model (rebuildable). One table per entity; columns are the fields the
--    UI filters/sorts/groups on. Prose + full record live in the doc; SQL holds queryable
--    projections + a json snapshot for cheap render (same shape as crm_objects, store.rs:74-83). ──

CREATE TABLE households (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, name TEXT, status TEXT,
  primary_advisor_id TEXT, ownership TEXT, service_policy_id TEXT,
  archived INTEGER DEFAULT 0, updated_at TEXT, next_review_due TEXT,
  json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE INDEX idx_hh_matter ON households(matter_id);
CREATE INDEX idx_hh_advisor ON households(primary_advisor_id);
CREATE INDEX idx_hh_review ON households(next_review_due);

CREATE TABLE persons (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, household_id TEXT, is_external INTEGER DEFAULT 0,
  external_role TEXT, first_name TEXT, last_name TEXT, birth_date TEXT, date_of_death TEXT,
  updated_at TEXT, json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE INDEX idx_person_hh ON persons(household_id);
CREATE INDEX idx_person_ext ON persons(is_external, external_role);
CREATE INDEX idx_person_birth ON persons(birth_date);   -- birthdays/age-65 reports (E-129)

CREATE TABLE accounts (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, household_id TEXT, custodian TEXT,
  account_type TEXT, last4 TEXT, purpose TEXT, ownership TEXT, status TEXT,
  updated_at TEXT, json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE INDEX idx_acct_hh ON accounts(household_id);

CREATE TABLE facts (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, household_id TEXT, subject_kind TEXT,
  subject_id TEXT, fact_type TEXT, status TEXT, pinned INTEGER DEFAULT 0,
  as_of TEXT, observed_at TEXT, superseded_by TEXT,
  value_num REAL, value_text TEXT, updated_at TEXT, json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE INDEX idx_fact_hh_type ON facts(household_id, fact_type, status);
CREATE INDEX idx_fact_current ON facts(household_id, fact_type, as_of) WHERE status='current' AND deleted=0;
CREATE INDEX idx_fact_pinned ON facts(household_id, pinned);

CREATE TABLE notes (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, household_id TEXT, audience TEXT,
  pinned INTEGER DEFAULT 0, title TEXT, authored_via TEXT, created_at TEXT, updated_at TEXT,
  json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE INDEX idx_note_hh_aud ON notes(household_id, audience);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, household_id TEXT, title TEXT, status TEXT,
  priority TEXT, due_date TEXT, category TEXT, workflow_instance_id TEXT,
  recurrence_json TEXT, updated_at TEXT, completed_at TEXT, json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE INDEX idx_task_status_due ON tasks(status, due_date);       -- "who's overdue" (client-side, §0.4)
CREATE INDEX idx_task_hh ON tasks(household_id);
CREATE INDEX idx_task_wf ON tasks(workflow_instance_id);
CREATE TABLE task_assignees (              -- normalized SET for assignee queries
  task_id TEXT NOT NULL, assignee_id TEXT NOT NULL, PRIMARY KEY(task_id, assignee_id)
);
CREATE INDEX idx_task_assignee ON task_assignees(assignee_id);     -- "all tasks for Alice" (E-119)

CREATE TABLE workflow_templates (
  id TEXT PRIMARY KEY, name TEXT, category TEXT, version INTEGER, status TEXT,
  updated_at TEXT, json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE TABLE workflow_instances (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, household_id TEXT, template_id TEXT,
  template_version INTEGER, status TEXT, started_at TEXT, completed_at TEXT,
  open_offer_count INTEGER DEFAULT 0,   -- fast "instances with pending template changes" (E-099)
  updated_at TEXT, json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE INDEX idx_winst_template ON workflow_instances(template_id, status);

CREATE TABLE opportunities (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, household_id TEXT, name TEXT,
  pipeline_id TEXT, stage_id TEXT, status TEXT, amount REAL, expected_close_date TEXT,
  owner_id TEXT, updated_at TEXT, json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE INDEX idx_opp_pipeline_stage ON opportunities(pipeline_id, stage_id, status);

CREATE TABLE service_policies ( id TEXT PRIMARY KEY, matter_id TEXT, scope TEXT, tier_name TEXT,
  cadence_days INTEGER, json TEXT NOT NULL, deleted INTEGER DEFAULT 0 );

CREATE TABLE activity_events (      -- projection of the APP activity streams
  id TEXT PRIMARY KEY, matter_id TEXT, household_id TEXT, at TEXT NOT NULL, actor_id TEXT,
  verb TEXT, target_kind TEXT, target_id TEXT, important INTEGER DEFAULT 0, json TEXT NOT NULL
);
CREATE INDEX idx_activity_hh_at ON activity_events(household_id, at);   -- per-client timeline (path4 §5.2)
CREATE INDEX idx_activity_at ON activity_events(at);                    -- firm feed
CREATE INDEX idx_activity_important ON activity_events(important, at);  -- notification blasts (E-021)

CREATE TABLE tags ( id TEXT PRIMARY KEY, name TEXT, color TEXT, category TEXT, json TEXT NOT NULL, deleted INTEGER DEFAULT 0 );
CREATE TABLE entity_tags ( entity_id TEXT, entity_kind TEXT, tag_id TEXT, PRIMARY KEY(entity_id, tag_id) );
CREATE INDEX idx_entity_tags_tag ON entity_tags(tag_id);

CREATE TABLE custom_field_defs ( id TEXT PRIMARY KEY, key TEXT, label TEXT, field_type TEXT,
  applies_to TEXT, options_json TEXT, archived INTEGER DEFAULT 0, json TEXT NOT NULL );
CREATE TABLE saved_views ( id TEXT PRIMARY KEY, matter_id TEXT, name TEXT, surface TEXT,
  visibility TEXT, report_kind TEXT, json TEXT NOT NULL, deleted INTEGER DEFAULT 0 );

-- external-id crosswalk (§4.4) — the ONLY place provider ids live as keys.
CREATE TABLE external_refs (
  provider TEXT NOT NULL, external_id TEXT NOT NULL, crm_key TEXT NOT NULL,
  entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL, last_synced_at TEXT,
  PRIMARY KEY (provider, external_id)
);
CREATE INDEX idx_extref_entity ON external_refs(entity_id);

CREATE TABLE meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL );  -- schema_version, index_rebuild_watermark, …
```

Migrations follow the `migrate_*_columns` swallow-error `ALTER TABLE ADD COLUMN` pattern
(`store.rs:884-895`).

### 3.3 How docs and the index coexist (the rebuild contract)

- The projector `project(entityDoc) → rows` is deterministic and total. `meta.schema_version`
  gates it.
- **Index rebuild** (on schema change, corruption, or first open after import): `DELETE`
  every projected table, then iterate `crm_docs`, decode each `yjs_state`, run the
  projector, upsert. `crm_docs` + the relay oplog are sufficient to reconstruct everything;
  losing the projected tables is never data loss (D0.1). This is the exact guarantee the
  connector already relies on (`crm_render_state` rebuilt from `crm_objects`,
  `store.rs:193-197`).
- **Consistency:** a doc write and its projection commit in one SQLite transaction
  (`apply_ingest_batch` pattern, `store.rs:255-281`). The relay push is fire-and-queue
  (`pendingUpdates`, `MatterSyncClient.ts:132-133`); local truth is the durable Y.Doc, so a
  push failure never diverges local state.

### 3.4 The sync oplog

Unchanged from what ships: the relay's append-only, monotonic-cursor, idempotent oplog
(`backend` `matter_updates`; `contract.ts:232-252`; `db.ts` oplog per feasibility §2). Each
CRM doc stream is just another `(matter_id, doc_id)` channel on it. `crm_sync_cursors`
mirrors the relay cursor locally so catch-up resumes (`MatterSyncClient.catchUp`,
`MatterSyncClient.ts:234-252`). The 1 MiB/update and 500-row/pull caps (feasibility §2)
mean large collections page — the client already loops catch-up pages
(`MatterSyncClient.ts:239-248`).

### 3.5 Where attachments live

Structured records never hold blobs. Attachments/files-on-records reference workspace
documents encrypted per-file by the existing vault (`src-tauri/crates/lantern-vault`,
AES-256-GCM per file, feasibility §4). A record's attachment is an `EntityRef`-style
pointer (`bodyRef` / `SourceRef.ref` = a workspace path). Word bodies for note-templates /
report-layouts (`FirmDoc.bodyRef`) are `.docx` files driven by the OOXML engine + the
co-editing `MatterDocSyncClient` (`src/platform/firm/coedit/MatterDocSyncClient.ts`). This
keeps the CRM DB small and reuses the proven document-encryption + doc-sync rails rather
than inventing blob storage.

### 3.6 Encryption-at-rest posture

Identical to the shipped connector/audit/mail stores: SQLCipher whole-DB encryption, 32-byte
master key held in the OS keychain (`keyring`), raw-hex `PRAGMA key` bypassing the KDF, a
**dedicated keychain service** for `crm-core-enc.db` so its key is independent
(`store.rs:24-66`, `audit/store.rs:520-562`). On disconnect/wipe, the DB file **and its
`-wal`/`-shm`/`-journal` sidecars** are removed and the key deleted, so no decryptable
residue remains (`store.rs:822-860`). Synced blobs are E2EE under the per-matter/per-`__firm__`
content key + `key_epoch` bound as AES-GCM AAD (`matterCrypto.ts`, `MatterSyncClient.ts:20-26`);
the relay only ever sees ciphertext (D0.4). No plaintext CRM field ever leaves the device.

---

## 4. Matter-facade mapping

### 4.1 Household/Person attach to `matter_id` without renaming anything

- A `Household` **has** `matterId` (its confidentiality scope) — it does not replace the
  matter. The matter stays exactly the `src/platform/types/matter.ts` object it is today
  (folder/mail/CRM key arrays, firm linkage, privileged flag). Nothing is renamed
  (charter invariant; `matter.ts:1-13`).
- The bridge is `Matter.crmHouseholdKeys[]` (`matter.ts:49-58`), which already lists the
  household keys belonging to a matter. On CRM-core adoption, a Lantern-native `Household`
  gets the **same** matter its Wealthbox household mapped to; for households with no matter
  yet, a matter is created (or `Matter.createdFromCrm` set, `matter.ts:96-104`) and the
  household attaches to it. One matter ↔ one primary household is the common case; a matter
  may hold several households only where the firm already groups them.
- `Matter.client` (a bare display string today, `matter.ts:34`) becomes a **derived**
  value from the primary `Household.name`; the field is not removed (facade), just fed from
  the new entity.
- Retrieval scope is unchanged: RAG/chat still scope by `matterId` (`matter.ts:170-179`,
  `MatterScope`). CRM records inherit the same scope key, so a household's facts/notes/tasks
  are confined to its matter exactly as documents are.

### 4.2 Firm linkage reuse

Sharing a household with the firm reuses the existing matter-sharing path: `firmMatterId`,
`orgId`, `role`, `shared` on the matter (`matter.ts:124-147`). The CRM doc streams for that
household sync under its `firmMatterId` scope through the same relay + key machinery. The
`__firm__` pseudo-matter (§2.6) is provisioned as a matter all seats belong to for
firm-global entities.

### 4.3 Client Map facts → Fact records

The Client Map is per-matter sections→items today (`ClientMap`, `clientMap/types.ts:131`).
Migration is item-by-item:

| Client Map source | Fact target |
|---|---|
| `ClientMapItem.id`/`.text` (`types.ts:43-51`) | `Fact.text`; a new `Fact.id` minted, old id kept in `externalRefs` for citation stability |
| `ClientMapItem.sources[]` (`SourceRef`, `types.ts:49`) | `Fact.source.sources[]` verbatim (same `SourceRef` type) |
| `ClientMapItem.isAssumption` (`types.ts:47`) | `Fact.isAssumption` |
| `ClientMapItem.updatedAt` (`types.ts:50`) | `Fact.observedAt` (and `asOf` when the text implies a date) |
| section `key` (`CoreSectionKey` household/goals/money/followups, `types.ts:17`) | `Fact.sectionKey` + inferred `factType` (money→asset/liability/account_balance; goals→goal; household→relationship) |
| Money section bullets naming an account | also spawn/enrich an `Account` (§1.3) |
| `ClientMap.editHistory[]` (`types.ts:145`) | seed `ActivityEvent`s (verb `fact.changed`) so history carries forward |
| `completeness.ask` gaps (`types.ts:128`) | remain a computed view over Facts (not stored) |

Typed facts (money/date/enum) get a structured `FactValue`; un-parseable bullets become
`{ t:'none' }` prose Facts — lossless. The Client Map UI keeps working by reading Facts
grouped by `sectionKey` (an adapter presents Facts as `ClientMapItem`s), so no UI rewrite is
forced by the data change.

### 4.4 Wealthbox read-mirror → entities (field-by-field, citing `model.rs`)

The connector mirror (`crm_objects`, `store.rs`) stays as the **import/parallel-run source**;
these mappings drive both the migration importer (lane E) and parallel-run write-back. Every
mapping records the provider id in `external_refs` (§3.2), so re-import is idempotent (an
existing `external_ref` reuses the minted Lantern id instead of duplicating).

**Contacts — `CrmContact` (`model.rs:200-303`):**

| Wealthbox / `CrmContact` field | Lantern target |
|---|---|
| `type` = "household" (`model.rs:206`), `name` (`:213`), `company_name` | `Household{name, ...}` |
| `type` = person/trust/org (`:186`) | `Person{personType, ...}` |
| `household` nested ref + `members[]` (`CrmHouseholdRef`/`Member`, `model.rs:76-105`) | `Household.memberIds` ↔ `Person.householdIds`; member `title` → `Person.role` |
| identity: first/middle/last/nickname/prefix/suffix/company/job (`:215-231`) | `Person.*` identity block |
| dates: birth/anniversary/client_since/retirement/death (`:233-238`) | `Person` dates; `client_since`→`Household.clientSince` for the household |
| `marital_status` (`:242`), `status` (`:246`), `contact_type` | `Person.maritalStatus`, `Household.status` |
| `background_information`/alias `background_info` (`:251-256`), `important_information`, `personal_interests` | `Person.background/importantInfo/personalInterests` |
| investor: `investment_objective/time_horizon/risk_tolerance` (`:262-268`) | `Person.investmentObjective/timeHorizon/riskTolerance` |
| financial: `gross_annual_income/assets/non_liquid_assets/liabilities/adjusted_gross_income/tax_bracket/tax_year` (`:270-277`) | **`Fact` records** (factType income/asset/liability/tax_bracket), `asOf` = `tax_year` when present, `observedAt` = sync time — money becomes dated claims, not flat fields |
| professional pointers: `attorney/cpa/doctor/insurance/business_manager/family_officer/trusted_contact` (contact ids, `:279-286`) | external `Person{isExternal, externalRole}` + `Fact{factType:'professional_relationship', value:{t:'entity'}}` linking household→person |
| `street_addresses/email_addresses/phone_numbers` (`CrmStreetAddress/Email/Phone`, `:288-294`, `model.rs:118-146`) | `Person.addresses/emails/phones` (verbatim reuse) |
| `tags[]` (`CrmTag`, `:300`, `model.rs:175-180`) | `Tag` entities + `entity_tags`; Wealthbox tag id in `Tag.externalRefs` |
| `contact_roles[]` raw JSON (`:302`) | `CustomFieldValue`s under generated `CustomFieldDef`s (§1.13) — the "custom fields not modeled" gap (feasibility §5) |
| `id`/`external_id`/`crm_key()` (`:201-203`, `:314-317`) | `external_refs` row; **never** the Lantern primary id (§2.1) |

**Notes — `CrmNote` (`model.rs:349-359`):** `content`→`Note.body`; `linked_to[]`
(`CrmLink`, `model.rs:154-165`)→`Note.links[]` (EntityRefs resolved via `external_refs`);
`created_at`/`updated_at`→`Note.createdAt`/`updatedAt`; imported notes default
`audience:'internal'` and `authoredVia:'manual'` (no audience signal exists in Wealthbox —
flagged §7 Q5). Jump-pushed notes (E-029/030), if identifiable by content, set
`authoredVia:'jump-push'`.

**Tasks — `CrmTask` (`model.rs:371-391`):** `name`→`title`; `due_date`→`dueDate`;
`complete`(bool)→`status` (`done` if true else `open`); `priority`→`priority`;
`description`→`description`; `linked_to`→`links`. Assignee/recurrence/category **have no
Wealthbox source** on `CrmTask` (the missing fields) — imported empty, filled going forward.

**Events — `CrmEvent` (`model.rs:403-416`):** there is no first-class Meeting/Event entity
in the CRM core (Lantern meetings + calendar connectors own scheduling). Events import as
**`ActivityEvent`s** (verb `meeting.held`/`meeting.scheduled`) on the household timeline:
`title`→`summary`, `starts_at`/`ends_at`→`at`+payload, `location`/`description`→payload,
`linked_to`→`householdId`/`targetRef`. This keeps the unified timeline (path4 §5.2) without
a redundant entity. (Open Q §7 Q6: do we need an editable Meeting entity, or is
timeline+calendar-connector enough?)

**Write-back / parallel-run:** the existing approval-gated write ledger
(`crm_outbound_writes`, `store.rs:202-214`, `CrmWriteSource`) is reused so Lantern-side edits
push to Wealthbox during parallel-run (notes create, task create, one contact field today —
feasibility §5). No delete write-back (matches current constraint).

---

## 5. Provenance & dating

### 5.1 Every record wears source + dates

`CrmBase` guarantees `createdAt`, `updatedAt`, `source: Provenance` on every entity (§1).
`updatedAt` is the newest field write; each LWW field also carries a `#hlc` stamp (§2.2) so
the **specific field's** last-change time is recoverable, not just the record's. `Provenance`
carries `SourceRef[]` citations (`clientMap/types.ts:31-41`), so "how do we know this" is
answerable and clickable exactly as Client Map citations are today (path4 §4 principle 2 —
"every fact wears its date and source").

`Fact` carries **three** dates (§1.4): `asOf` (when the claim is true as of), `observedAt`
(when we learned it), `updatedAt` (last edit). This is what makes staleness visible: a
balance `asOf 2026-01-01` shown in July is obviously old.

### 5.2 "Latest and greatest with dates" queries

- **Latest current fact per type:** `idx_fact_current` (`facts(household_id, fact_type,
  as_of) WHERE status='current' AND deleted=0`) → `SELECT … ORDER BY as_of DESC LIMIT 1`
  per (household, factType). Superseded facts stay queryable for history (the
  `supersededBy` chain, §1.4).
- **Latest account balance:** newest `Fact{factType:'account_balance', subject=account}` by
  `as_of`.
- **Reviews due / cadence:** `households.next_review_due` (projected from `ServicePolicy`
  cadence + last `meeting.held` ActivityEvent) → the review-due report (E-085/086, path4
  §5.2).
- **"No contact in 6 months" (E-088):** max `activity_events.at` per household `< now-180d`.
- **Reports never cache truth:** report rows are computed live from these indexes and
  stamped "computed just now from N sources" (path4 §5.2); only the `SavedView` **definition**
  is stored (§1.15).

---

## 6. Retention & audit

**This section states a records-posture the system is built to satisfy; it is a flag for
counsel, not a legal conclusion** (path4 §8; RIA Rule 204-2 = 5-year retention, first 2
readily accessible — "a compliance attorney must confirm").

### 6.1 Two append-only logs, two jobs

- **ActivityEvent stream (§1.10)** — the mergeable business feed (who did what). Insert-only
  CRDT, projected to `activity_events`. Drives the timeline + notification blasts.
- **Hash-chained audit store (`src-tauri/src/commands/audit/store.rs`)** — the tamper-evident
  compliance **defense file**, kept as-is. Every AI action and every external write is
  already appended here (append/list/count only, `store.rs:12-16`), SHA-256 hash-chained
  with a genesis prev-hash and a `chain_head_v1` seal (`store.rs:52-53, 156-161`), fail-closed
  on a missing seal (`SealMissing`, `store.rs:74-80`), verifiable (`verify_chain`,
  `store.rs:651-700`). CRM-core writes (record create/edit/delete, fact supersession,
  workflow propagation accept, exam export) append an audit entry here in addition to emitting
  an ActivityEvent, so the compliance log is provably complete and ordered.

Separation is deliberate: the activity feed must **merge** across peers (CRDT, can't be a
strict hash chain), while the audit log must be **tamper-evident** (hash chain, single-writer
per device). Cross-device audit consolidation for a firm-wide compliance view is an exam-time
operation (§6.3), not a live merge.

### 6.2 Retention posture (flag)

- **5-year retention:** soft-delete is a tombstone (`deleted` flag), never a hard delete, so
  a "deleted" record and its history remain on disk and recoverable within the retention
  window — mirroring the connector's soft-delete (`store.rs:83, 512-518`). A separate,
  audited retention-purge job (out of scope for this doc, flagged for lane F) would enforce
  the far end of the window.
- **2-years-readily-accessible:** the projected SQL index (§3.2) makes the recent window
  instantly queryable on the firm's own devices. "Readily accessible under E2EE" (regulator
  asks the firm; the firm decrypts and produces) is the §6.3 export path — its written,
  counsel-reviewed procedure is a §7 open question, not settled here.
- **Value history:** Fact supersession chains (§1.4) and the audit log together preserve the
  prior values of changed facts, which a records posture generally wants.

### 6.3 Exam-export — a first-class operation

Per path4 §8 ("an SEC exam must never be blocked by our architecture — an
export-everything-decrypted capability, firm-initiated, becomes a hard requirement"):

**`examExport(scope)` — firm-initiated, decrypt-everything, fidelity-stamped.** It:
1. Requires an **admin/owner** actor and appends an audit entry recording who initiated it,
   when, and the scope (the export is itself an audited event).
2. Walks every doc stream in scope (a household's matter, a date range, or the whole firm),
   decrypts each Yjs doc locally (the firm holds the keys), and materializes a **plaintext
   bundle**: households/persons/accounts/facts/notes/tasks/workflows/opportunities +
   activity feed + the decrypted hash-chained audit log + attachment files (decrypted from
   the vault).
3. Emits a **fidelity report** (every entity kind: count in store N, exported N, skipped N
   with reasons) — the "nail-biter standard applied to ourselves" (path4 §7, E-094).
4. Includes the audit-chain `verify_chain` verdict (`store.rs:651`) so the bundle carries
   proof the compliance log was intact (or an honest anomaly record if it was repaired,
   `store.rs:718-797`).

Because docs are the source of truth and the firm holds all keys, export is a pure local
decrypt+serialize — the server is never involved and never able to do it (D0.4). This is the
"readily accessible: the firm decrypts and produces" procedure §6.2 references.

---

## 7. Open questions (the freeze review must settle these)

1. **LWW loss on money/status fields (§2.3).** Accepted risk: concurrent edits to a scalar
   drop one value (kept only in the activity trail / Fact chain). Is per-field HLC-LWW +
   activity trail sufficient, or do specific fields (Task.status, Account balances) need a
   stronger merge (e.g. multi-value register surfaced to the user as a conflict to resolve)?
   This is the riskiest single call in the model.
2. **Firm-wide task rollup vs. ethical walls (§2.5).** "All tasks for Alice / who's overdue"
   requires every seat to sync every household's `crm/tasks` stream, but ethical walls
   (`backend` `ethical_walls`, feasibility §2) exist to deny some members some matters. How
   do we reconcile a firm-wide task view with per-matter key denial? Options: (a) a
   walls-aware task index that omits walled matters per device, (b) a narrow plaintext task
   metadata side-channel (assignee/due/status/matter_id only — feasibility §3), (c)
   accept that walled tasks simply don't appear in a walled member's rollup. Privacy call for
   Jameson (this is the §6.1 trade-off in path4).
3. **Doc granularity: one doc per record vs. one doc per collection (§2.2/§2.5).** This spec
   freezes **one Y.Doc per entity instance**, streamed within a per-collection channel. The
   alternative (one doc per household holding all its records) simplifies scope but enlarges
   the co-edit blast radius and the 1 MiB update cap risk. Confirm per-record granularity at
   freeze; it's expensive to change later.
4. **`__firm__` pseudo-matter key distribution (§2.6).** Treating firm-global docs as a
   matter every seat belongs to means the firm key is held by all seats. Is that acceptable
   (templates/tags/process docs are not client-confidential), and does removing a seat force a
   firm-key epoch bump + re-wrap for everyone (matterKeys epoch machinery, feasibility §2)?
5. **Note audience on import (§4.4).** Wealthbox has no internal/client-facing signal, so all
   imported notes default `internal`. Is defaulting to the safer (internal) lane correct, and
   how does the migration wizard let the firm reclassify in bulk?
6. **Meeting/Event as entity vs. timeline-only (§4.4).** This spec imports Wealthbox events as
   `ActivityEvent`s and leans on Lantern meetings + calendar connectors for scheduling. Do we
   need an editable first-class `Meeting`/`CalendarEvent` entity (E-109 says JBW doesn't use
   Wealthbox's calendar), or is timeline + connector sufficient?
7. **Opportunity/pipeline scope for v1.** Lane A's matrix requires Opportunity; JBW evidence
   barely mentions pipelines. Confirm whether Opportunity ships in the core build or is a
   later stage (it's fully specced here either way).
8. **Government-ID fields (§4.4).** The connector deliberately omits passport/SSN/license
   (`model.rs:8-10`) per Reg S-P. A system-of-record may need SSN (tax docs, account opening).
   Do we add encrypted-at-rest, redacted-in-egress ID fields, or keep the omission and store
   IDs only as vault documents? (path4 §5.5 flags this too.)
9. **Retention-purge job.** §6.2 assumes a future audited purge job at the far end of the
   5-year window; its policy (what/when/who-approves) is undefined here and needs its own
   spec (lane F candidate).
10. **Custom-field explosion from `contact_roles` (§4.4).** Auto-generating `CustomFieldDef`s
    from arbitrary Wealthbox `contact_roles` JSON could create dozens of noisy fields. Does the
    migration wizard need a mapping/curation step, or do we import them into a single JSON
    "legacy fields" blob first and let the firm promote fields deliberately?

---

*Traceability: existing-code claims cite repo paths in `/home/jameson/lantern-crm`
(`src/platform/types/matter.ts`, `src/platform/clientMap/types.ts`,
`src-tauri/src/commands/crm/model.rs` + `store.rs`, `src-tauri/src/commands/audit/store.rs`,
`src/platform/firm/MatterSyncClient.ts` + `coedit/docCrdt.ts` + `contract.ts`). Design
principles cite `~/lantern-plus/user-research/10-path4-deep-dive.md` §4–5 and the feasibility
report `analysis-drafts/crm-core-feasibility.md`. Evidence items (E-###) trace to
`~/lantern-plus/user-research/01-evidence-ledger.md`. Compliance items in §6 are flags for
counsel, not conclusions.*
