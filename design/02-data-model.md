# 02 — Data model + storage design (CRM core)

**Conforms to 00-master-spec decisions D1–D26.**

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
merge class is settled by the Field Merge Contract in §2.3:

| Marker | Meaning | Yjs representation |
|---|---|---|
| **LWW** | Last-writer-wins register | value in a `Y.Map` + companion `…#hlc` field (see §2.3) |
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
  matterId: string;        // IMM — the locked facade scope key (D0.3). `firm_home` for firm-level docs.
  createdAt: string;       // IMM — ISO, first write
  createdBy: ActorRef;     // IMM — who/what created it
  updatedAt: string;       // LWW — newest field write across the whole record (§5)
  updatedBy: ActorRef;     // LWW — actor of the newest write
  source: Provenance;      // LWW — where this record most-recently came from (§5)
  deleted: boolean;        // LWW — soft-delete tombstone (mirrors crm_objects.deleted, store.rs:83)
  externalRefs: ExternalRef[]; // SET — provider ids this maps to (Wealthbox/SFDC/Redtail), §4
  rawRecordRef?: RawRecordRef; // IMM when imported — exact verbatim archive payload (§4.4)
  schemaVersion: number;   // LWW — doc schema version for forward migration
}

type EntityKind =
  | 'household' | 'person' | 'account' | 'fact' | 'note' | 'task'
  | 'workflowTemplate' | 'workflowInstance' | 'servicePolicy'
  | 'activityEvent' | 'firmDoc' | 'tag' | 'customFieldDef'
  | 'opportunity' | 'pipelineDef' | 'stageDef' | 'proposalRecord' | 'legacyProject'
  | 'firmDirectoryEntry' | 'householdDirectoryShell' | 'intakeLink' | 'intakeSubmission'
  | 'importArchiveManifest' | 'savedView';

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
  sourceType: string;      // provider object type, e.g. contact | note | project
  sourceId: string;        // provider-native id, e.g. wealthbox '10002' or 'sfdc:001…'
  scope: string;           // provider's source scope; composite multi-household notes use their deterministic composite scope
  crmKey?: string;         // provider-safe crm_key() display value, model.rs:314-317
  lastSyncedAt?: string;
}

interface RawRecordRef {
  importBatchId: string;
  manifestId: string;
  rawRecordId: string;
  sha256: string;          // digest of the verbatim captured HTTP response
  capturedAt: string;
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
  members: Keyed<HouseholdMember>; // SET — Person links; the member role belongs here, not on Person
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

interface HouseholdMember {
  personId: string;             // IMM
  role?: string;                // LWW — Head/Spouse/Partner/Child within this household
  addedAt: string;              // IMM
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
  roles: PersonRole[];          // SET — professional/contact roles, deliberately distinct from HouseholdMember.role

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

interface PersonRole {
  id: string;                   // IMM
  label: string;                // LWW
  organizationRef?: EntityRef;  // LWW
  active: boolean;              // LWW
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
  householdLinks: HouseholdLink[]; // SET — one note may link many households (D8)
  links: EntityRef[];           // SET — what this note is about (mirrors CrmNote.linked_to, model.rs:358)
  mentions: NoteMention[];      // SET — people/firm members explicitly mentioned (D9)
  audience: 'internal' | 'client-facing'; // IMM — the hard wall (E-050). IMM because reclassifying is a new note, not a mutation.
  body: string;                 // SEQ — Y.Text, true co-edit merge (reuses the docCrdt Y.Text pattern, docCrdt.ts:33)
  pinned: boolean;              // LWW — pinned notes as permanent memory (E-073)
  title?: string;               // LWW
  format?: 'plain' | 'meeting-note' | 'template'; // LWW — firm's format is sacred (E-032)
  templateId?: string;          // LWW — note template used
  authoredVia?: 'manual' | 'jump-push' | 'meeting-capture' | 'ai'; // LWW — Jump→note push provenance (E-029/030)
  tagIds: string[];             // SET
}

interface HouseholdLink {
  householdId: string;          // IMM
  matterId: string;             // IMM — needed to enforce the intersection wall
  externalRef?: ExternalRef;    // IMM for a multi-household imported note's composite source link
}

interface NoteMention {
  id: string;                   // IMM, e.g. "user:<id>" or "person:<id>"
  ref: EntityRef;               // IMM
  notifyState: 'none' | 'pending' | 'sent' | 'read'; // LWW, notification detail is encrypted
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
  id: string;                   // IMM — app-minted, never provider-owned
  householdRef: EntityRef | null; // IMM — null means a firm task; opaque in its firm shell
  title: string;                // LWW — operational shell field
  body: string;                 // SEQ — logical Y.Text; confidential household text is only `crm:task-notes[taskId]`, never `crm:record` (§2.2)
  assigneeUserId: string | null;// LWW — exactly one assignee, or explicitly unassigned
  status: 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled'; // LWW
  due?: string;                 // LWW
  recurrence?: RecurrenceRule;  // LWW
  priority: 'high' | 'normal' | 'low'; // LWW
  contextRefs: EntityRef[];     // SET
  customFields: CustomFieldValueMap; // SET keyed by definition key (§1.13)
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
  matterId: 'firm_home';        // IMM — firm-level, not per-household (§2.2)
  name: string;                 // LWW
  description: string;          // SEQ — Y.Text
  category?: string;            // LWW — "Money Movement", "Post-Meeting", "Onboarding" (E-092/093)
  revisions: Keyed<TemplateRevision>; // APP — immutable revision graph, keyed by revisionId
  headRevisionIds: string[];    // SET — concurrent graph heads; never an integer version
  status: 'draft' | 'published' | 'archived'; // LWW
  steps: Keyed<StepDef>;        // SEQ+SET — ordered, id-keyed (order is a SEQ of ids; bodies are a SET)
  stepOrder: string[];          // SEQ — Y.Array of step ids (the order sequence)
  triggerHints: string[];       // SET — patterns that suggest "convert this ad-hoc task?" (E-092/093)
  tagIds: string[];             // SET
  schedule?: WorkflowSchedule;  // LWW — scheduled workflow launch rule (D9)
}

interface WorkflowSchedule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  timezone: string;
  startsAt: string;
  householdSelector: ViewQuery; // saved, evaluated-at-launch client-side selector
  enabled: boolean;
}

interface StepDef {
  id: string;                   // IMM — stable across revisions (this is what makes propagation mergeable, §2.4)
  title: string;                // LWW
  description: string;          // SEQ
  ownerRole?: string;           // LWW — role that owns this step ("advisor", "ops", "CSA")
  defaultAssigneeId?: string;   // LWW
  offsetDays?: number;          // LWW — due N days after instance start / prior step
  required: boolean;            // LWW
  outcomes: StepOutcome[];      // SET — branch/restart decisions (D9)
  addedInRevisionId: string;    // IMM — provenance for propagation diffs
  removedInRevisionId?: string; // LWW — soft-removal keeps the id alive for merge
}

interface StepOutcome {
  id: string;                   // IMM
  label: string;                // LWW
  nextStepId?: string;          // LWW — absent means complete this branch
  restartAtStepId?: string;     // LWW — explicit rework/restart path
  condition?: string;           // LWW — user-visible rule text, evaluated client-side
}

interface TemplateRevision {
  revisionId: string;           // IMM — UUIDv7, never reused or renumbered
  templateId: string;           // IMM
  parentRevisionIds: string[];  // SET — one or more parents; composed revisions may name concurrent heads
  author: ActorRef;             // IMM
  issuedHlc: HlcStamp;          // IMM — issued under §2.3's HLC contract
  label: string;                // IMM — human-readable update label shown at publish/review time
  stepChanges: Keyed<TemplateStepChange>; // IMM — complete per-step field change-set
}

interface TemplateStepChange {
  stepId: string;               // IMM
  field: string;                // IMM — one of the propagation-derived fields named in §2.4
  value: unknown;               // IMM
}

const UNTOUCHED = 'todo' as const;
type WorkflowStepStatus = typeof UNTOUCHED | 'in_progress' | 'done' | 'skipped';
```

Templates are versioned by immutable revision IDs, not a mutable number. Stable step IDs
are the load-bearing decision that makes propagation a convergent CRDT merge rather than a
clobber.

### 1.8 WorkflowInstance

One running copy of a template against a household, tracking per-step progress and owners
independently of the template.

```ts
interface WorkflowInstance extends CrmBase {
  kind: 'workflowInstance';
  householdId: string;          // IMM
  templateId: string;           // IMM
  acceptedRevisionIds: string[]; // SET — monotonic knowledge of applied revisions
  displayedRevisionSet: RevisionSet; // LWW — only a complete applied change-set may advance it
  name: string;                 // LWW — instance label (usually template name + household)
  status: 'open' | 'completed' | 'cancelled'; // LWW
  startedAt: string;            // IMM
  steps: Keyed<WorkflowStepProgress>; // per-step progress, id-keyed by the template's stable step id
  pendingOffers: Keyed<PropagationOffer>; // SET — one per-instance offer with per-step decisions
  decisionLedger: Keyed<PropagationDecision>; // APP — immutable entries, keyed by (instanceId, revisionId, stepId, field)
}

interface RevisionSet {
  revisionIds: string[];        // SET — the complete graph target currently displayed
}

interface WorkflowStepProgress {
  stepId: string;               // IMM — matches StepDef.id (the merge key)
  origin: 'template' | 'local'; // IMM — template step or locally added step; local steps are never propagation targets
  status: WorkflowStepStatus;  // LWW — `UNTOUCHED` is the named untouched state
  assigneeUserId?: string;      // LWW — current active assignee; canonical name everywhere
  taskId?: string;              // IMM — the Task materializing this step (§1.6)
  // snapshot of the step definition this instance is currently honoring, so an
  // instance renders correctly even offline from the template:
  titleSnapshot: string;        // LWW
  derived: Record<string, DerivedField>; // LWW per key — current template-derived field values + immutable sources
  removalRequestedBy: string[]; // SET — OR-Set<revisionId>; removal is reconciled after every merge (§2.4)
  detachedFromTemplate: boolean;// LWW — removal/offline-progress rule is re-run on merge
  stepNotes: string;            // SEQ — per-step Y.Text comments, never a task-body surrogate (D9)
  assignmentOperations: Keyed<AssignmentOperation>; // APP — append-only assignment history accompanying the current LWW assignee
  completionOperations: Keyed<CompletionOperation>; // APP — append-only truth; display completion is derived
}

interface DerivedField {
  value: unknown;               // LWW
  sourceRevisionId: string;     // LWW — immutable revision that supplied the displayed value
  sourceOperationId: string;    // LWW — immutable mutation operation that supplied it
}

interface CompletionOperation {
  completionId: string;         // IMM — unique within stepId
  stepId: string;               // IMM
  completedAt: string;          // IMM
  completedBy: ActorRef;        // IMM
  outcome?: string;             // IMM
  sourceOperationId: string;    // IMM
}

interface AssignmentOperation {
  assignmentId: string;         // IMM — unique within stepId
  stepId: string;               // IMM
  assignedUserId: string | null;// IMM — null records an explicit unassignment
  assignedAt: string;           // IMM
  assignedBy: ActorRef;         // IMM
  sourceOperationId: string;    // IMM
}

// Projection only: not a mutable CRDT field. From valid completionOperations, the projector
// selects the highest source operation by §2.3 HLC/operation-ID order and exposes its time,
// actor, and outcome as the displayed completion. Invalid or contradictory operations remain
// visible in quarantine and never rewrite an accepted completion.
interface DisplayedStepCompletion {
  completionId: string;
  completedAt: string;
  completedBy: ActorRef;
  outcome?: string;
}

interface PropagationOffer {
  offerId: string;              // IMM
  fromRevisionSet: RevisionSet; // IMM
  targetRevisionSet: RevisionSet; // IMM
  stepChanges: Keyed<PropagationStepChange>; // SET — review unit is the instance, choice is per step
  state: 'pending' | 'applied' | 'partially_applied' | 'superseded'; // LWW
  appliedAt?: string; appliedBy?: ActorRef; // LWW
}

interface PropagationStepChange {
  stepId: string;               // IMM
  changeKind: 'add' | 'modify' | 'remove'; // IMM
  fields: Record<string, unknown>; // IMM — proposed values, keyed by derived field
  decision: 'pending' | 'accepted' | 'rejected' | 'review_required'; // LWW — concurrent heads never silently pick
  decidedBy?: ActorRef; decidedAt?: string; // LWW
}

interface PropagationDecision {
  decisionKey: string;          // IMM — `${instanceId}:${revisionId}:${stepId}:${field}`
  instanceId: string;           // IMM
  revisionId: string;           // IMM
  stepId: string;               // IMM
  field: string;                // IMM
  decision: 'accepted' | 'rejected'; // IMM
  sourceOperationId: string;    // IMM
  supersedesDecisionKey?: string; // IMM — descendant changed this field and explicitly re-offers it
  reofferState: 'original' | 'reoffered'; // IMM — a rejection persists unless a descendant changes this field
  decidedAt: string;            // IMM
  decidedBy: ActorRef;          // IMM
}
```

**The propagation contract:** §4 of
[03 — Sync, Notifications & Propagation](03-sync-and-notifications.md#4-workflow-template-propagation-d4)
owns the workflow algorithm; this doc owns its fields and merge rules. Editing a template
mints an immutable `TemplateRevision`; concurrent edits are graph heads, never competing
numbers. One offer is created per open instance and includes every changed step/field.
It defaults every eligible choice to accept and permits per-step/field toggles and
approve-all. Applying a decision never changes progress, assignment, notes, completion, or
outcome. A rejection remains in the immutable `decisionLedger` until a descendant revision
changes that same field, which explicitly re-offers it. The selected target is a deterministic
topological closure of the revision graph; same-field collisions use §2.3's HLC/operation-ID
rule, while unresolved concurrent heads are `review_required`, never silently chosen.
`displayedRevisionSet` advances only after the complete accepted change-set is present.
Removal re-runs against `UNTOUCHED`; conditional undo restores only derived cells untouched
since its source operation and reports the rest. Apply, audit entry, and outbox work are one
transaction (D4/D5).

### 1.9 ServicePolicy

Who-meets-when knowledge that lives "in heads + Wealthbox context" today (E-085/086).

```ts
interface ServicePolicy extends CrmBase {
  kind: 'servicePolicy';
  matterId: 'firm_home' | string;// IMM — firm-level tiers OR a household override
  scope: 'firm-tier' | 'household-override'; // LWW
  tierName: string;             // LWW — "Platinum", "A-client", "Household"
  meetingCadence?: 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'custom'; // LWW
  cadenceDays?: number;         // LWW — for custom
  nextReviewDue?: string;       // LWW — computed + stored for the reports surface (§5.2)
  reviewChecklistTemplateId?: string; // LWW — a WorkflowTemplate for the review
  schedulingLinkUrl?: string;  // LWW — plain service-tier scheduling link (D23)
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

### 1.10a ActivityReaction (per-person emoji response)

One saved reaction belongs to one activity item, one firm member, and one emoji. Its stable
identity is `activity + member + emoji`, so adding it again restores the same record rather
than creating a duplicate. The feed groups active reaction records by emoji for its count and
the hover list of people who reacted. Removing a reaction saves `active: false`; the activity
event itself remains append-only.

```ts
interface ActivityReaction extends CrmBase {
  kind: 'activityReaction';
  activityId: string;
  userId: string;
  displayName: string;
  emoji: '👍' | '🎉' | '❤️';
  active: boolean;
  reactedAt?: string;
  removedAt?: string | null;
}
```

### 1.11 FirmDoc / ProcessDoc

Firm ways-of-working, note templates, report layouts — "the firm's format is sacred"
(E-032, E-091).

```ts
interface FirmDoc extends CrmBase {
  kind: 'firmDoc';
  matterId: 'firm_home';        // IMM
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
  matterId: 'firm_home';        // IMM — tags are firm-global (mirrors CrmTag, model.rs:175-180)
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
  matterId: 'firm_home';        // IMM
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

interface PipelineDef extends CrmBase {
  kind: 'pipelineDef';
  matterId: 'firm_home';        // IMM
  name: string;                 // LWW
  description?: string;         // SEQ
  stageIds: string[];           // SET
  stageOrder: string[];         // SEQ
  archived: boolean;            // LWW
}

interface StageDef extends CrmBase {
  kind: 'stageDef';
  matterId: 'firm_home';        // IMM
  pipelineId: string;           // IMM
  name: string;                 // LWW
  statusEffect: 'open' | 'won' | 'lost' | 'none'; // LWW
  triggerRules: StageTriggerRule[]; // SET — launch/offer rules on stage entry (D9)
  archived: boolean;            // LWW
}

interface StageTriggerRule {
  id: string;                   // IMM
  event: 'entered' | 'exited';  // IMM
  workflowTemplateId?: string;  // LWW
  proposalRequired: boolean;    // LWW — never launch an AI proposed workflow automatically
  enabled: boolean;             // LWW
}
```

### 1.15 ProposalRecord (AI approval queue)

AI proposals are durable approval records, never UI-only cards or automatic actions. One
contract covers workflow launches, new tasks, new facts, and communication drafts. The
proposal's kind is `workflow_launch`, `task_create`, `fact_add`, or `communication_draft`;
the field is named `proposalKind` because `CrmBase.kind` is already the entity discriminator.

```ts
interface ProposalRecord extends CrmBase {
  kind: 'proposalRecord';
  householdRef: EntityRef | null; // IMM — null is a firm-scope proposal routed through firm operations
  proposalKind: 'workflow_launch' | 'task_create' | 'fact_add' | 'communication_draft'; // IMM
  proposedMutation: ProposalMutation; // IMM — complete durable proposed change
  proposedBy: ActorRef;         // IMM
  rationale: string;            // SEQ
  contextRefs: EntityRef[];     // SET
  state: 'pending' | 'approved' | 'rejected' | 'expired'; // LWW
  decidedAt?: string; decidedBy?: ActorRef; // LWW
  appliedEntityRef?: EntityRef; // LWW — created record/draft after approval
}

type ProposalMutation =
  | { kind: 'workflow_launch'; workflowTemplateId: string }
  | { kind: 'task_create'; task: Pick<Task, 'householdRef' | 'title' | 'assigneeUserId' | 'due' | 'priority' | 'contextRefs'> }
  | { kind: 'fact_add'; fact: Pick<Fact, 'householdId' | 'subjectRef' | 'factType' | 'label' | 'value' | 'text' | 'asOf' | 'observedAt'> }
  | { kind: 'communication_draft'; draftRef: EntityRef };
```

**Approval semantics:** a proposal is a durable record. Its terminal decision, resulting
entity reference, immutable operation, activity, and notification use the transaction and
delivery contract in [03 §2.3](03-sync-and-notifications.md#23-api-and-delivery-protocol).
Only approval performs the described mutation; rejection/expiry never does.

### 1.16 LegacyProject (imported read-only project)

Wealthbox Projects are preserved as read-only legacy records. They are never silently folded
into workflows or tasks, and no import or sync path auto-converts them. A person may manually
start a workflow from one; that creates a new `WorkflowInstance` and an append-only launch
record while leaving the imported project unchanged.

```ts
interface LegacyProject extends CrmBase {
  kind: 'legacyProject';
  householdLinks: HouseholdLink[]; // SET — imported linked households, with one deterministic anchor
  anchorHouseholdId?: string;   // IMM — deterministic linked-household anchor when one exists
  unlinked: boolean;            // IMM — true when imported without a household; lives in firm_home operational doc
  title: string;                // IMM — imported display title
  status?: string;              // IMM — source status, rendered read-only
  description?: string;         // IMM — source text, rendered read-only
  sourcePayload: Record<string, unknown>; // IMM — normalized snapshot; rawRecordRef keeps verbatim bytes
  manualWorkflowLaunches: LegacyProjectWorkflowLaunch[]; // APP — optional manual conversions only
}

interface LegacyProjectWorkflowLaunch {
  launchId: string;             // IMM
  workflowInstanceId: string;   // IMM
  workflowTemplateId: string;   // IMM
  launchedAt: string;           // IMM
  launchedBy: ActorRef;         // IMM
}
```

### 1.17 FirmDirectoryEntry (identity read-model)

This is a CRM-facing read-model of the existing firm identity rails. It neither creates
users nor grants access. Existing firm admin, teams, and matter-key membership remain the
only authority for roles and permissions (D9).

```ts
interface FirmDirectoryEntry extends CrmBase {
  kind: 'firmDirectoryEntry';
  matterId: 'firm_home';        // IMM
  userId: string;               // IMM — existing identity id
  displayName: string;          // LWW
  email?: string;               // LWW
  title?: string;               // LWW
  active: boolean;              // LWW
  teamLabels: string[];         // SET — display only, not authorization
  externalRefs: ExternalRef[];  // SET — imported Wealthbox user/assignee mapping
}
```

### 1.18 ImportArchiveManifest

Each import batch has one immutable, firm-scoped manifest. It lists every verbatim raw HTTP
response captured before typing or mutation, so every imported entity can point to one exact
payload through `rawRecordRef`. The raw bytes live encrypted in the local import archive;
the manifest stores their identifiers and hashes, not a rewritten copy.

```ts
interface ImportArchiveManifest extends CrmBase {
  kind: 'importArchiveManifest';
  matterId: 'firm_home';        // IMM
  importBatchId: string;        // IMM
  provider: string;             // IMM
  capturedAt: string;           // IMM
  sourceWorkspaceLabel: string; // IMM — synthetic/demo source only in this program
  records: RawArchiveEntry[];   // APP while capture completes, IMM after finalization
  finalizedAt?: string;         // IMM once set
  manifestSha256?: string;      // IMM once set
}

interface RawArchiveEntry {
  rawRecordId: string;          // IMM
  requestPath: string;          // IMM
  captureLayerVersion: string;  // IMM — raw-capture format/behavior used for this entry
  fixtureCorpusIdentity: string;// IMM — exact synthetic fixture corpus identity
  capturedAt: string;           // IMM
  responseSha256: string;       // IMM
  byteLength: number;           // IMM
  typedOutcome: 'landed' | 'skipped' | 'rejected'; // IMM — result of typed parse + landing attempt
  targetEntityRef?: EntityRef;  // IMM when landed
  skipReason?: string;          // IMM when skipped/rejected; exactly one allowed reason
  resultingExternalRefs: ExternalRef[]; // IMM — final external_refs projection for a landed source
}
```

### 1.19 HouseholdDirectoryShell (non-identifying directory projection)

`crm:directory` needs a shell that lets a firm list operational client state without
copying a household name, people, facts, or other client-identifying content into the firm
directory. The opaque reference is resolvable only after the device has the household record.

```ts
interface HouseholdDirectoryShell extends CrmBase {
  kind: 'householdDirectoryShell';
  matterId: 'firm_home';        // IMM
  householdRef: EntityRef;      // IMM — opaque household pointer; never a display name or client payload
  operationalStatus: Household['status']; // LWW — prospect/active/inactive/former only
}
```

### 1.20 IntakeLink + IntakeSubmission

Intake is a firm-scoped, durable review queue, not a direct write into a household. A link
declares the fields it may collect and the audience lane that owns the submitted payload.
The public form may create a submission, but matching a response to a household or creating
a household is a deliberate, append-only firm-member mutation.

```ts
interface IntakeLink extends CrmBase {
  kind: 'intakeLink';
  matterId: 'firm_home';        // IMM
  name: string;                 // LWW
  householdRef: EntityRef | null; // IMM — null means firm-wide intake; otherwise the intended household scope
  audience: 'internal' | 'client-facing'; // IMM — immutable lane for all collected payload
  fields: Keyed<IntakeField>;   // SET — selected responsive form fields
  confirmationCopy: string;     // SEQ — public confirmation text
  status: 'draft' | 'active' | 'closed'; // LWW
}

interface IntakeField {
  id: string;                   // IMM
  label: string;                // LWW
  kind: 'text' | 'email' | 'phone' | 'date' | 'select' | 'textarea'; // LWW
  required: boolean;            // LWW
  choices?: string[];           // LWW
}

interface IntakeSubmission extends CrmBase {
  kind: 'intakeSubmission';
  matterId: 'firm_home';        // IMM
  intakeLinkId: string;         // IMM
  audience: 'internal' | 'client-facing'; // IMM — copied from IntakeLink; no cross-lane move
  payload: IntakeAudiencePayload; // IMM — collected field values in that lane only
  submittedAt: string;          // IMM
  matchingDecisions: Keyed<IntakeMatchingDecision>; // APP — append-only match/create/reject decisions
}

type IntakeAudiencePayload = {
  audience: 'internal' | 'client-facing'; // IMM — must equal IntakeSubmission.audience
  values: Record<string, string | string[] | null>; // IMM — keyed only by IntakeLink.fields ids
};

interface IntakeMatchingDecision {
  decisionId: string;           // IMM
  decision: 'match' | 'create' | 'reject'; // IMM
  householdRef?: EntityRef;     // IMM when decision === 'match' or a create succeeds
  reason?: string;              // IMM — required for reject; visible review note
  decidedAt: string;            // IMM
  decidedBy: ActorRef;          // IMM
  sourceOperationId: string;    // IMM
}

// Projection only: not a mutable CRDT field. The matching-decision operation with the
// highest valid §2.3 HLC/operation-ID order supplies the displayed state and target.
interface DisplayedIntakeMatch {
  state: 'unmatched' | 'matched' | 'created' | 'rejected';
  householdRef?: EntityRef;
}
```

`matchingDecisions` is the only matching-decision mutation. The projector orders valid
entries by the §2.3 HLC/operation-ID order, exposes one resulting `state`, and retains all
earlier decisions for audit. A matched submission can propose dated Facts with the intake
payload as its source; it never writes Facts or household fields by itself.

### 1.21 Durable local migration-operation records

These records make the migration screen's operator decisions durable, but they are **not
CRM entities, not CRDT docs, and never relay-synced**. They are local SQLCipher tables on the
operator device because they describe that device's export work and readiness. Each completed
record is projected into the fidelity report and copied into the sealed immutable import
archive; the archive copy is the cross-device/compliance artifact, not a synced mutable copy.

```ts
interface MigrationChecklistItem {
  id: string;                   // IMM — operator-local UUIDv7
  importBatchId: string;        // IMM
  legacyProjectRef: EntityRef;  // IMM
  householdRef: EntityRef | null; // IMM — null for an unlinked legacy project
  sourceTemplateLabel?: string; // LWW — readable source evidence
  activityEvidenceRefs: EntityRef[]; // SET — available traces
  decision: 'pending' | 'recreate' | 'gap' | 'not_needed'; // local LWW
  resultingWorkflowInstanceRef?: EntityRef; // LWW after recreate
  gapReason?: string;           // LWW when decision === 'gap'
  decidedAt?: string; decidedBy?: ActorRef; // local LWW
}

interface AttachmentAccountingRecord {
  id: string;                   // IMM — operator-local UUIDv7
  importBatchId: string;        // IMM
  householdRef: EntityRef;      // IMM
  status: 'exported' | 'gap';   // local LWW — every affected household must end in one
  exportSource?: string;        // LWW when exported
  exportedAt?: string; exportedBy?: ActorRef; // local LWW
  gapReason?: string; gapOwnerUserId?: string; // local LWW when gap
}

interface ExportJob {
  id: string;                   // IMM — operator-local UUIDv7
  importBatchId: string;        // IMM
  kind: 'archive' | 'rollback'; // IMM
  status: 'preparing' | 'ready' | 'failed' | 'exported'; // local LWW
  manifestRef?: EntityRef;      // LWW — required for archive jobs once ready
  fidelityReportSha256?: string;// LWW — report captured with the job
  destinationLabel?: string;    // LWW — never a credential or secret path
  failureReason?: string;       // LWW when failed
  startedAt: string; startedBy: ActorRef; // IMM
  finishedAt?: string;          // local LWW
}
```

An `archive` ExportJob reaches `exported` only after its immutable archive package contains a
snapshot of every checklist, attachment-accounting, and export-job record for that
`importBatchId`, alongside the referenced manifest and fidelity report. The package is a
sealed capture, not a write back into the manifest or a new synced document.

### 1.22 SavedView / Report definition

Structured browse for the "Seattle persona" (path4 §5.2, principle 6). A saved view or a
report is a **stored query definition**; results are always computed live (never cached as
truth — path4 §5.2 "Nothing cached as truth").

```ts
interface SavedView extends CrmBase {
  kind: 'savedView';
  matterId: 'firm_home' | string;// IMM — firm-shared or personal
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

### 1.23 Shared value types

```ts
interface EntityRef { kind: EntityKind; id: string; matterId?: string; } // typed cross-entity pointer
type Keyed<T> = Record<string /*element id*/, T>;                        // id-keyed map → OR-Set merge (§2)
```

---

## 2. Identity & merge (CRDT model)

### 2.1 Stable ID scheme

- **Primary ids are app-minted, type-prefixed UUIDv7**: `hh_<uuid7>`, `per_<uuid7>`,
  `acct_<uuid7>`, `fact_<uuid7>`, `note_<uuid7>`, `task_<uuid7>`, `wtpl_`, `winst_`,
  `svc_`, `act_`, `fdoc_`, `tag_`, `cfd_`, `opp_`, `pipe_`, `stage_`, `proposal_`, `dir_`,
  `hds_`, `intake_link_`, `intake_sub_`, `import_`, `legacy_`, `view_`. UUIDv7 is
  time-ordered so the SQL index gets locality for free. Local migration-operation ids use
  the same UUIDv7 rule but are never CRM entity ids or relay identifiers.
- **Provider ids are NEVER primary keys.** Wealthbox numeric ids and `crm_key()` values
  (`model.rs:314-317`) are retained only in `externalRefs[]`. This is the clean decoupling
  feasibility §1/§6 demands ("app-owned editable records decoupled from the connector") and
  it is why importing the same Wealthbox record twice can't collide (the id is minted once
  and remembered by `externalRef`, §4.4).
- **Ids are immutable and globally unique within a firm.** They are the CRDT merge key and
  the citation target; they never change, even across a Wealthbox→Lantern→Wealthbox round
  trip.

### 2.2 D1 topology: per-collection docs, lazily subscribed

The previous per-entity streams are struck. A collection document, not an entity document,
is the Yjs truth unit. The relay stream is always `(matter_id, doc_id)`.

| Scope | Doc ID | Root contents | Subscription rule |
|---|---|---|---|
| Firm home (`firm_home`) | `crm:tasks` | Task operational shells; firm-task bodies | Bootstrap and always-on |
| Firm home | `crm:workflows` | Workflow instances, propagation offers, PipelineDef, StageDef, ProposalRecord | Bootstrap and always-on |
| Firm home | `crm:templates` | WorkflowTemplate, ServicePolicy, Tag, CustomFieldDef, FirmDoc, SavedView | Bootstrap and always-on |
| Firm home | `crm:directory` | FirmDirectoryEntry, HouseholdDirectoryShell, and ImportArchiveManifest | Bootstrap and always-on |
| Firm home | `crm:intake` | IntakeLink and IntakeSubmission | Bootstrap and always-on |
| Firm home | `crm:activity:<YYYY-Qn>` | append-only ActivityEvent entries | Current quarter plus recent/pinned quarters |
| Real household matter | `crm:record` | Household, Person links, Account, Fact, Note, Opportunity, and LegacyProject | On open, plus pinned/recent households; never all households by default |
| Firm home | `crm:record` | Unlinked LegacyProject records only, each marked `unlinked` | Bootstrap and always-on |
| Real household matter | `crm:task-notes` | `taskId → Y.Text` confidential task body/notes | Only with that household's client view |

A task's operational shell is in `firm_home` / `crm:tasks`. If `householdRef` is non-null,
its body is only in that household's `crm:task-notes`, keyed `taskId → Y.Text`; the shell
contains only an opaque body reference. It is never in `crm:record`. If `householdRef` is
null, its body is firm-key content in `crm:tasks`. This is still one D2 Task schema, but a
firm rollup cannot disclose client-confidential body text. A
multi-household Note is stored once at a deterministic anchor household record and sealed
with an intersection key derived from all linked household keys; it renders only where the
device holds every linked key. No per-entity household streams exist.
There is exactly one `crm:record` document for each household under that household's real
matter; it is subscribed only when the household is open, pinned, or recent. `firm_home` is
the one real synthetic firm matter; no pseudo-scope is valid. An imported LegacyProject with
no linked household has `matterId: 'firm_home'`, `anchorHouseholdId: undefined`, and
`unlinked: true`; it is retained in the firm-home operational `crm:record` rather than being
invented into a household.

### 2.3 Field Merge Contract v1.0

**This named, versioned table is the canonical merge contract.** IMM fields are written once
and reject different later values. SEQ uses Y.Text/Y.Array. OR-SET is an add-wins
observed-remove map keyed by item ID. APP is insert-only. STEP-LWW is LWW-HLC keyed by
immutable step ID. Every named field is covered here; no unlisted field is permitted.

**HLC issuance, validation, and quarantine (D3/D12).** An LWW-HLC write carries
`HlcStamp { wallMillis, logicalCounter, actorId, operationId }`. The device persists, in
SQLCipher for the organization, `lastRelayObservedMillis` and its last **valid** issued HLC.
Whenever an authenticated relay response supplies its observed time, the device persists the
maximum of that time and its existing relay-observed value before issuing another stamp. On
that first observation (and after each later advance), queued locally issued stamps beyond
the ceiling are durably quarantined and are not sent or merged. If a prior relay observation
exists, a new stamp uses `physical = max(lastValidIssued.wallMillis,
min(localWallMillis, lastRelayObservedMillis + 5 minutes))`; it increments `logicalCounter`
when that physical value equals the prior valid issued physical value and otherwise starts at
zero. Before the first relay observation, the device uses the same monotonic local-HLC rule
without a relay ceiling; it may not claim relay-time validation until it reconnects. A
received stamp must have a valid integer physical value, non-negative bounded logical
counter, actor and operation IDs, and—when relay time has been observed—a physical value no
later than `lastRelayObservedMillis + 5 minutes`. Invalid stamps, including old-client future
stamps, are durably quarantined with their immutable operation and never participate in a
merge.
Valid same-field values compare `(wallMillis, logicalCounter, actorId, operationId)` in that
order; the highest wins. Relay cursor and display timestamps are never merge inputs.

```ts
interface HlcStamp {
  wallMillis: number;
  logicalCounter: number;
  actorId: string;
  operationId: string;
}
```

| Entity or value | IMM | LWW-HLC | SEQ | OR-SET | APP / STEP-LWW |
|---|---|---|---|---|---|
| CrmBase | id, kind, matterId, createdAt, createdBy, rawRecordRef | updatedAt, updatedBy, source, deleted, schemaVersion | — | externalRefs | — |
| HlcStamp | wallMillis, logicalCounter, actorId, operationId | — | — | — | — |
| ActorRef / RawRecordRef / EntityRef / RawArchiveEntry | ActorRef.userId, seat, display, kind; RawRecordRef.importBatchId, manifestId, rawRecordId, sha256, capturedAt; EntityRef.kind, id, matterId; RawArchiveEntry.rawRecordId, requestPath, captureLayerVersion, fixtureCorpusIdentity, capturedAt, responseSha256, byteLength, typedOutcome, targetEntityRef, skipReason, resultingExternalRefs | — | — | — | — |
| Provenance | — | origin, sources, importBatchId, note | — | — | — |
| ExternalRef | provider, sourceType, sourceId, scope, crmKey | lastSyncedAt | — | — | — |
| Household / HouseholdMember | HouseholdMember.personId, HouseholdMember.addedAt | name, greeting, status, clientSince, primaryContactId, servicePolicyId, primaryAdvisorId, ownership, archived, HouseholdMember.role | — | members, tagIds, pinnedFactIds, addresses, customFields | — |
| Person / PersonRole / VerifiedRecipientLink | PersonRole.id | personType, firstName, middleName, lastName, nickname, prefix, suffix, companyName, jobTitle, birthDate, anniversary, retirementDate, dateOfDeath, maritalStatus, investmentObjective, timeHorizon, riskTolerance, background, importantInfo, personalInterests, isExternal, externalRole, verifiedRecipient, PersonRole.label, PersonRole.organizationRef, PersonRole.active, VerifiedRecipientLink.verified, verifiedAt, verifiedBy, channel, address | — | householdIds, roles, addresses, emails, phones, tagIds, customFields, servesHouseholdIds | — |
| Account | householdId | custodian, accountType, registration, last4, purpose, ownership, status, openedAt, closedAt | — | ownerPersonIds, tagIds, customFields | — |
| Fact | householdId | subjectRef, factType, label, value, text, status, isAssumption, pinned, sectionKey, asOf, observedAt, supersededBy | — | — | — |
| Note / HouseholdLink / NoteMention | audience, HouseholdLink.householdId, matterId, externalRef, NoteMention.id, ref | pinned, title, format, templateId, authoredVia, NoteMention.notifyState | body | householdLinks, links, mentions, tagIds | — |
| Task / RecurrenceRule | householdRef | title, assigneeUserId, status, due, recurrence, priority, RecurrenceRule.freq, interval, byWeekday, byMonthDay, count, until, regenerateOnComplete | body | contextRefs, customFields | — |
| WorkflowTemplate / WorkflowSchedule / TemplateRevision | TemplateRevision.revisionId, templateId, author, issuedHlc, label, TemplateStepChange.stepId, field, value | name, category, status, schedule, WorkflowSchedule.frequency, timezone, startsAt, householdSelector, enabled | description, stepOrder | headRevisionIds, steps, triggerHints, tagIds, TemplateRevision.parentRevisionIds | revisions (APP); TemplateRevision.stepChanges (IMM complete map) |
| StepDef / StepOutcome | StepDef.id, StepDef.addedInRevisionId, StepOutcome.id | StepDef.title, ownerRole, defaultAssigneeId, offsetDays, required, removedInRevisionId, StepOutcome.label, nextStepId, restartAtStepId, condition | StepDef.description | outcomes | — |
| WorkflowInstance / RevisionSet / WorkflowStepProgress / DerivedField / CompletionOperation / AssignmentOperation | householdId, templateId, startedAt, WorkflowStepProgress.stepId, origin, taskId; CompletionOperation.completionId, stepId, completedAt, completedBy, outcome, sourceOperationId; AssignmentOperation.assignmentId, stepId, assignedUserId, assignedAt, assignedBy, sourceOperationId | displayedRevisionSet, name, status, WorkflowStepProgress.status, assigneeUserId, titleSnapshot, DerivedField.value, sourceRevisionId, sourceOperationId, detachedFromTemplate | WorkflowStepProgress.stepNotes | acceptedRevisionIds, RevisionSet.revisionIds, pendingOffers, steps (STEP-LWW), WorkflowStepProgress.removalRequestedBy (OR-Set<revisionId>) | completionOperations (APP); assignmentOperations (APP) |
| PropagationOffer / PropagationStepChange / PropagationDecision | offerId, fromRevisionSet, targetRevisionSet, PropagationStepChange.stepId, changeKind, fields; PropagationDecision.decisionKey, instanceId, revisionId, stepId, field, decision, sourceOperationId, supersedesDecisionKey, reofferState, decidedAt, decidedBy | state, appliedAt, appliedBy, PropagationStepChange.decision, decidedBy, decidedAt | — | stepChanges | decisionLedger (APP, keyed by its exact `(instanceId, revisionId, stepId, field)` key) |
| ServicePolicy / ActivityEvent | ServicePolicy.matterId; ActivityEvent.at, actor, verb, targetRef, householdId, summary, payload, important | ServicePolicy.scope, tierName, meetingCadence, cadenceDays, nextReviewDue, reviewChecklistTemplateId, schedulingLinkUrl | ServicePolicy.description | appliesToHouseholdIds | ActivityEvent (APP) |
| FirmDoc / Tag / CustomFieldDef / CustomFieldValue | FirmDoc.matterId, Tag.matterId, CustomFieldDef.matterId, CustomFieldDef.key | FirmDoc.docType, title, bodyRef, pinned; Tag.name, color, category; CustomFieldDef.appliesTo, label, fieldType, options, required, order, archived; CustomFieldValue.value, updatedAt, source | FirmDoc.body | FirmDoc.tagIds, Tag.externalRefs | — |
| Opportunity / PipelineDef / StageDef / StageTriggerRule | Opportunity.householdId, PipelineDef.matterId, StageDef.matterId, pipelineId, StageTriggerRule.id, event | Opportunity.name, pipelineId, stageId, amount, probability, status, expectedCloseDate, closedAt, closeReason, ownerId; PipelineDef.name, archived; StageDef.name, statusEffect, archived; StageTriggerRule.workflowTemplateId, proposalRequired, enabled | PipelineDef.description, stageOrder | Opportunity.contextRefs, tagIds, customFields; PipelineDef.stageIds; StageDef.triggerRules | — |
| ProposalRecord / ProposalMutation / LegacyProject / LegacyProjectWorkflowLaunch / FirmDirectoryEntry | ProposalRecord.householdRef, proposalKind, proposedMutation; ProposalMutation.kind and payload; ProposalRecord.proposedBy; LegacyProject.anchorHouseholdId, unlinked, title, status, description, sourcePayload; LegacyProjectWorkflowLaunch.launchId, workflowInstanceId, workflowTemplateId, launchedAt, launchedBy; FirmDirectoryEntry.matterId, userId | ProposalRecord.state, decidedAt, decidedBy, appliedEntityRef; FirmDirectoryEntry.displayName, email, title, active | ProposalRecord.rationale | ProposalRecord.contextRefs; LegacyProject.householdLinks; FirmDirectoryEntry.teamLabels, externalRefs | LegacyProject.manualWorkflowLaunches (APP) |
| HouseholdDirectoryShell / IntakeLink / IntakeField / IntakeSubmission / IntakeAudiencePayload / IntakeMatchingDecision | HouseholdDirectoryShell.householdRef; IntakeLink.matterId, householdRef, audience; IntakeField.id; IntakeSubmission.matterId, intakeLinkId, audience, payload, submittedAt; IntakeAudiencePayload.audience, values; IntakeMatchingDecision.decisionId, decision, householdRef, reason, decidedAt, decidedBy, sourceOperationId | HouseholdDirectoryShell.operationalStatus; IntakeLink.name, status; IntakeField.label, kind, required, choices | IntakeLink.confirmationCopy | IntakeLink.fields | IntakeSubmission.matchingDecisions (APP; `DisplayedIntakeMatch` is projection only) |
| ImportArchiveManifest / SavedView / ViewQuery | ImportArchiveManifest.matterId, importBatchId, provider, capturedAt, sourceWorkspaceLabel, finalizedAt, manifestSha256 | SavedView.name, surface, visibility, query, layout, reportKind; ViewQuery.entity, filters, sort, groupBy | — | — | ImportArchiveManifest.records (APP until finalization) |
| MigrationChecklistItem / AttachmentAccountingRecord / ExportJob (operator-local only) | MigrationChecklistItem.id, importBatchId, legacyProjectRef, householdRef; AttachmentAccountingRecord.id, importBatchId, householdRef; ExportJob.id, importBatchId, kind, startedAt, startedBy | MigrationChecklistItem.sourceTemplateLabel, decision, resultingWorkflowInstanceRef, gapReason, decidedAt, decidedBy; AttachmentAccountingRecord.status, exportSource, exportedAt, exportedBy, gapReason, gapOwnerUserId; ExportJob.status, manifestRef, fidelityReportSha256, destinationLabel, failureReason, finishedAt | — | MigrationChecklistItem.activityEvidenceRefs | **LOCAL-LWW only:** one operator-device SQLCipher transaction; never a CRDT merge or relay update |

Fact value edits mint a new Fact linked by supersededBy; the LWW rule chooses only the
current link, never destroys history. Template propagation uses immutable revision IDs and
revision sets. ActivityEvent entries never mutate or delete.

### 2.4 Propagation state contract

There is one offer per instance, carrying per-step/field decisions. Review defaults all
eligible choices to accepted and offers approve-all. Every derived field records its source
revision ID and source operation ID. `displayedRevisionSet` advances only when the required
change-set is complete. The immutable decision ledger preserves rejections until a descendant
revision changes that same field and re-offers it. An offline-progress/removal race re-runs
the removal decision using `UNTOUCHED`: a template removal only adds its immutable
`revisionId` to `removalRequestedBy`; it never deletes the step. After every merged state,
the projector hides a step only when `origin === 'template'`, a removal is present, and its
status is `UNTOUCHED` with no notes, assignment operation, completion operation, or outcome.
Otherwise it keeps the step visible and sets `detachedFromTemplate: true`. `origin` is IMM;
`assigneeUserId` is LWW for the current active assignment, while every assignment or explicit
unassignment also appends its immutable `AssignmentOperation`; that history is never changed
by propagation or removal. A selected target is its ancestor closure in
parent-before-child topological order; concurrent ready nodes sort by §2.3 HLC/operation ID,
and any still-unresolved concurrent head is `review_required`. Undo restores only derived
fields untouched since apply and reports the rest. Apply, audit entry, and outbox work are
one transaction.

### 2.5 Yjs representation

Within each collection doc, the root Y.Map is keyed by stable entity ID. Values are nested
maps, Y.Text, Y.Array, and OR-Set maps exactly as Field Merge Contract v1.0 requires.
crm:activity:<YYYY-Qn> is its root APP array. This replaces every prior per-entity Y.Doc
shape and per-household collection stream.

---

## 3. Storage

### 3.1 The two-layer store: collection docs (truth) + SQL index (rebuildable)

```
Truth layer  : durable merged Yjs state for each subscribed collection document,
               encrypted and synced through the relay oplog.
Index layer  : crm-core-enc.db (SQLCipher) — a materialized read-model, rebuilt from
               decrypted collection docs and never authoritative. (D0.1)
Operator layer: durable local migration-operation tables, never CRDT-synced; their sealed
               fidelity/archive copies are the durable cross-device record (§1.21).
```

Write path: user edit → local collection-doc mutation → same local transaction updates the
SQL projection and the durable outbox. A remote update is decrypted, applied to its
collection doc, then projected. The projector is a pure function of collection state, so a
full rebuild replays every locally held collection document. A failed relay push never
diverges the durable local truth from its projection.

### 3.2 SQLCipher schema (`crm-core-enc.db`)

New encrypted DB alongside `crm-enc.db`, `audit-enc.db`, `mail-enc.db`. Opened exactly
like the others: `PRAGMA key = "x'<hex>'"` as the first statement, 32-byte key from the OS
keychain under a **dedicated service** (not shared with mail/crm/vectors), `busy_timeout`
for concurrent sync-loop + indexer writers (`store.rs:158-215`, `audit/store.rs:535-556`).

```sql
-- durable local mirror of each subscribed collection document (truth layer).
-- SQL tables below are rebuildable projections from these collection states unless explicitly
-- marked operator-local migration state; those three tables never enter crm_docs or the relay.
CREATE TABLE crm_docs (
  doc_key      TEXT PRIMARY KEY,   -- "<matterId>/<docId>"
  matter_id    TEXT NOT NULL,      -- plaintext scope (queryable) — the pattern RAG already uses (feasibility §4)
  doc_id       TEXT NOT NULL,      -- collection stream, e.g. 'crm:tasks'
  yjs_state    BLOB NOT NULL,      -- Y.encodeStateAsUpdate(doc) — merged CRDT state
  state_vector BLOB NOT NULL,      -- Y.encodeStateVector — for delta sync catch-up
  updated_at   TEXT NOT NULL,      -- newest field write (§5)
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_crm_docs_scope ON crm_docs(matter_id, doc_id);

-- oplog cursor high-water per stream (mirrors crm_cursors, store.rs:189-192 and the relay
-- oplog cursor, contract.ts:247-249). Lets sync resume without re-pulling.
CREATE TABLE crm_sync_cursors (
  stream_key TEXT PRIMARY KEY,     -- "<matterId>/<docId>"
  cursor     INTEGER NOT NULL,     -- last applied relay cursor
  key_epoch  INTEGER NOT NULL DEFAULT 0
);

-- D3 HLC state is durable per organization; bad old-client/future stamps stay inspectable
-- but cannot enter the CRDT merge.
CREATE TABLE crm_hlc_state (
  org_id TEXT PRIMARY KEY, last_relay_observed_millis INTEGER,
  last_valid_issued_hlc_json TEXT NOT NULL
);
CREATE TABLE crm_merge_quarantine (
  operation_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, stamp_json TEXT NOT NULL,
  reason TEXT NOT NULL, quarantined_at TEXT NOT NULL
);

-- D5 durable notification delivery. These rows are written in the same local transaction
-- as the doc mutation that caused them. Neither table stores a persisted sender identity.
CREATE TABLE crm_outbox (
  org_id TEXT NOT NULL, envelope_id TEXT NOT NULL, mutation_id TEXT NOT NULL, recipient_user_id TEXT NOT NULL,
  envelope_class TEXT NOT NULL CHECK(envelope_class IN ('firm_operational','client_confidential')),
  ciphertext BLOB NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT, dead_letter_at TEXT,
  PRIMARY KEY(org_id, envelope_id)
);
CREATE INDEX idx_crm_outbox_org_delivery ON crm_outbox(org_id, delivered_at, created_at);
CREATE TABLE crm_inbox (
  org_id TEXT NOT NULL, envelope_id TEXT NOT NULL, ciphertext BLOB NOT NULL, received_at TEXT NOT NULL,
  decrypted_at TEXT, deduped_at TEXT, dead_letter_at TEXT,
  PRIMARY KEY(org_id, envelope_id)
);
CREATE INDEX idx_crm_inbox_org_received ON crm_inbox(org_id, received_at);

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
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, anchor_household_id TEXT, audience TEXT,
  pinned INTEGER DEFAULT 0, title TEXT, authored_via TEXT, created_at TEXT, updated_at TEXT,
  json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE INDEX idx_note_hh_aud ON notes(anchor_household_id, audience);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY, household_id TEXT, title TEXT, assignee_user_id TEXT, status TEXT,
  priority TEXT, due_at TEXT, recurrence_json TEXT, updated_at TEXT,
  json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE INDEX idx_task_status_due ON tasks(status, due_at);          -- "who's overdue" (client-side, §0.4)
CREATE INDEX idx_task_hh ON tasks(household_id);
CREATE INDEX idx_task_assignee ON tasks(assignee_user_id);         -- "all tasks for Alice" (E-119)
-- Task.customFields stays in the rebuildable task JSON snapshot; it is not an independently
-- indexed search field until a CustomFieldDef makes an explicit projection necessary.

CREATE TABLE workflow_templates (
  id TEXT PRIMARY KEY, name TEXT, category TEXT, head_revision_set_json TEXT, status TEXT,
  updated_at TEXT, json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE TABLE workflow_instances (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, household_id TEXT, template_id TEXT,
  displayed_revision_set_json TEXT, status TEXT, started_at TEXT,
  open_offer_count INTEGER DEFAULT 0,   -- fast "instances with pending template changes" (E-099)
  updated_at TEXT, json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE INDEX idx_winst_template ON workflow_instances(template_id, status);
CREATE TABLE template_revisions (
  revision_id TEXT PRIMARY KEY, template_id TEXT NOT NULL, parent_revision_ids_json TEXT NOT NULL,
  issued_hlc_json TEXT NOT NULL, label TEXT NOT NULL, json TEXT NOT NULL
);
CREATE INDEX idx_template_revision_template ON template_revisions(template_id);
CREATE TABLE workflow_completion_operations (
  completion_id TEXT PRIMARY KEY, workflow_instance_id TEXT NOT NULL, step_id TEXT NOT NULL,
  completed_at TEXT NOT NULL, completed_by_json TEXT NOT NULL, source_operation_id TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX idx_completion_instance_step ON workflow_completion_operations(workflow_instance_id, step_id);
CREATE TABLE workflow_assignment_operations (
  assignment_id TEXT PRIMARY KEY, workflow_instance_id TEXT NOT NULL, step_id TEXT NOT NULL,
  assigned_user_id TEXT, assigned_at TEXT NOT NULL, assigned_by_json TEXT NOT NULL,
  source_operation_id TEXT NOT NULL, json TEXT NOT NULL
);
CREATE INDEX idx_assignment_instance_step ON workflow_assignment_operations(workflow_instance_id, step_id, assigned_at);
CREATE TABLE workflow_step_progress (
  workflow_instance_id TEXT NOT NULL, step_id TEXT NOT NULL, origin TEXT NOT NULL,
  assignee_user_id TEXT, status TEXT NOT NULL, removal_requested_by_json TEXT NOT NULL,
  detached_from_template INTEGER NOT NULL DEFAULT 0, json TEXT NOT NULL,
  PRIMARY KEY(workflow_instance_id, step_id)
);
CREATE TABLE propagation_decisions (
  instance_id TEXT NOT NULL, revision_id TEXT NOT NULL, step_id TEXT NOT NULL, field TEXT NOT NULL,
  decision TEXT NOT NULL, source_operation_id TEXT NOT NULL, supersedes_decision_key TEXT,
  reoffer_state TEXT NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY(instance_id, revision_id, step_id, field)
);

CREATE TABLE opportunities (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, household_id TEXT, name TEXT,
  pipeline_id TEXT, stage_id TEXT, status TEXT, amount REAL, expected_close_date TEXT,
  owner_id TEXT, updated_at TEXT, json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE INDEX idx_opp_pipeline_stage ON opportunities(pipeline_id, stage_id, status);

CREATE TABLE service_policies ( id TEXT PRIMARY KEY, matter_id TEXT, scope TEXT, tier_name TEXT,
  cadence_days INTEGER, scheduling_link_url TEXT, json TEXT NOT NULL, deleted INTEGER DEFAULT 0 );

CREATE TABLE pipeline_defs ( id TEXT PRIMARY KEY, name TEXT, archived INTEGER DEFAULT 0,
  json TEXT NOT NULL, deleted INTEGER DEFAULT 0 );
CREATE TABLE stage_defs ( id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, name TEXT,
  status_effect TEXT, archived INTEGER DEFAULT 0, json TEXT NOT NULL, deleted INTEGER DEFAULT 0 );
CREATE INDEX idx_stage_pipeline ON stage_defs(pipeline_id);
CREATE TABLE proposal_records ( id TEXT PRIMARY KEY, household_id TEXT, proposal_kind TEXT NOT NULL,
  state TEXT, decided_at TEXT, json TEXT NOT NULL, deleted INTEGER DEFAULT 0 );
CREATE INDEX idx_proposal_pending ON proposal_records(state, household_id);
CREATE TABLE legacy_projects (
  id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, anchor_household_id TEXT, title TEXT NOT NULL,
  source_status TEXT, unlinked INTEGER NOT NULL DEFAULT 0, json TEXT NOT NULL, deleted INTEGER DEFAULT 0
);
CREATE INDEX idx_legacy_project_anchor ON legacy_projects(anchor_household_id);
CREATE TABLE legacy_project_household_links (
  legacy_project_id TEXT NOT NULL, household_id TEXT NOT NULL, matter_id TEXT NOT NULL,
  PRIMARY KEY(legacy_project_id, household_id)
);
CREATE TABLE firm_directory_entries ( id TEXT PRIMARY KEY, user_id TEXT UNIQUE, display_name TEXT,
  email TEXT, active INTEGER DEFAULT 1, json TEXT NOT NULL, deleted INTEGER DEFAULT 0 );
CREATE TABLE household_directory_shells ( id TEXT PRIMARY KEY, household_id TEXT NOT NULL UNIQUE,
  operational_status TEXT NOT NULL, json TEXT NOT NULL, deleted INTEGER DEFAULT 0 );
CREATE TABLE intake_links ( id TEXT PRIMARY KEY, household_id TEXT, audience TEXT NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL, json TEXT NOT NULL, deleted INTEGER DEFAULT 0 );
CREATE INDEX idx_intake_link_status ON intake_links(status);
CREATE TABLE intake_submissions ( id TEXT PRIMARY KEY, intake_link_id TEXT NOT NULL, audience TEXT NOT NULL,
  state TEXT NOT NULL, submitted_at TEXT NOT NULL, json TEXT NOT NULL, deleted INTEGER DEFAULT 0 );
CREATE INDEX idx_intake_submission_review ON intake_submissions(state, submitted_at);
CREATE TABLE intake_matching_decisions ( decision_id TEXT PRIMARY KEY, submission_id TEXT NOT NULL,
  decision TEXT NOT NULL, household_id TEXT, decided_at TEXT NOT NULL, decided_by_json TEXT NOT NULL,
  source_operation_id TEXT NOT NULL, json TEXT NOT NULL );
CREATE TABLE import_archive_manifests ( id TEXT PRIMARY KEY, import_batch_id TEXT UNIQUE,
  provider TEXT, finalized_at TEXT, manifest_sha256 TEXT, json TEXT NOT NULL );
-- RawArchiveEntry's capture-layer version, fixture identity, typed outcome, target/skip
-- result, and resulting external_refs projection are immutable members of this manifest JSON.
CREATE TABLE note_household_links ( note_id TEXT NOT NULL, household_id TEXT NOT NULL,
  matter_id TEXT NOT NULL, PRIMARY KEY(note_id, household_id) );

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

-- external-reference crosswalk (§4.4) — the ONLY place provider identities live as keys.
CREATE TABLE external_refs (
  provider TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, scope TEXT NOT NULL,
  crm_key TEXT,
  entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL, last_synced_at TEXT,
  PRIMARY KEY (provider, source_type, source_id, scope)
);
CREATE INDEX idx_extref_entity ON external_refs(entity_id);

-- D8's only import pipeline. A directory entry is mapped exactly like every other source
-- record; multi-household Notes use their composite external reference in this projection.
CREATE TABLE import_directory_mappings (
  provider TEXT NOT NULL, external_user_id TEXT NOT NULL, directory_entry_id TEXT NOT NULL,
  PRIMARY KEY(provider, external_user_id)
);

-- D26 migration operations: durable encrypted operator-local state, deliberately outside
-- crm_docs and the relay. A sealed fidelity/archive snapshot copies these rows by value.
CREATE TABLE migration_checklist_items (
  id TEXT PRIMARY KEY, import_batch_id TEXT NOT NULL, legacy_project_id TEXT NOT NULL,
  household_id TEXT, decision TEXT NOT NULL, resulting_workflow_instance_id TEXT,
  gap_reason TEXT, decided_at TEXT, decided_by_json TEXT, json TEXT NOT NULL
);
CREATE INDEX idx_migration_checklist_batch ON migration_checklist_items(import_batch_id, decision);
CREATE TABLE attachment_accounting_records (
  id TEXT PRIMARY KEY, import_batch_id TEXT NOT NULL, household_id TEXT NOT NULL,
  status TEXT NOT NULL, export_source TEXT, exported_at TEXT, exported_by_json TEXT,
  gap_reason TEXT, gap_owner_user_id TEXT, json TEXT NOT NULL
);
CREATE INDEX idx_attachment_accounting_batch ON attachment_accounting_records(import_batch_id, status);
CREATE TABLE export_jobs (
  id TEXT PRIMARY KEY, import_batch_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
  manifest_id TEXT, fidelity_report_sha256 TEXT, destination_label TEXT, failure_reason TEXT,
  started_at TEXT NOT NULL, started_by_json TEXT NOT NULL, finished_at TEXT, json TEXT NOT NULL
);
CREATE INDEX idx_export_job_batch ON export_jobs(import_batch_id, kind, status);

CREATE TABLE meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL );  -- schema_version, index_rebuild_watermark, …
```

**Notification durability and eligibility (D5).** The transaction that mutates a collection
doc also writes the encrypted outbox row. Every durable envelope identity and dedupe lookup
is `(org_id, envelope_id)`; a device never reads, acknowledges, retires, or dead-letters an
envelope outside that organization. Relay delivery is at least once; the inbox survives a
crash, and TTL-expired undecryptable ciphertext gets a dead-letter marker. The relay
persists recipient, timestamps, and ciphertext only, never a sender seat. A
client-confidential envelope is created only for holders of every required client key; a
firm-operational notice goes to all firm seats. `NoteMention.notifyState` is the encrypted
record-side state, not relay-visible metadata.

Migrations follow the `migrate_*_columns` swallow-error `ALTER TABLE ADD COLUMN` pattern
(`store.rs:884-895`).

### 3.3 How docs and the index coexist (the rebuild contract)

- The projector `project(collectionDoc) → rows` is deterministic and total. `meta.schema_version`
  gates it.
- **Index rebuild** (on schema change, corruption, or first open after import): `DELETE`
  every CRDT-projected table, then iterate `crm_docs`, decode each collection `yjs_state`, run
  the projector, upsert. `crm_docs` + the relay oplog are sufficient to reconstruct every
  shared CRM record; losing those projected tables is never data loss (D0.1). This is the
  exact guarantee the connector already relies on (`crm_render_state` rebuilt from
  `crm_objects`, `store.rs:193-197`). The three operator-local migration-operation tables are
  excluded: they are durable local workflow state and are retained until their fidelity/archive
  copy is sealed.
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
residue remains (`store.rs:822-860`). Synced blobs are E2EE under the per-matter/per-`firm_home`
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
household sync under its `firmMatterId` scope through the same relay + key machinery.
`firm_home` is provisioned as the real synthetic matter all seats belong to for firm-global
entities.

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
these mappings drive both the migration importer (lane E) and parallel-run write-back. The
only import landing pipeline is: **verbatim raw HTTP response capture → typed source record
→ Lantern collection-doc mutation → `external_refs` projection**. The raw capture is first,
encrypted, and listed in the immutable batch `ImportArchiveManifest`; every imported entity
gets its exact `rawRecordRef`. Re-import idempotency is decided only by the final
`external_refs` projection using the exact key `(provider, sourceType, sourceId, scope)`,
never by a guessed application ID.

**Contacts — `CrmContact` (`model.rs:200-303`):**

| Wealthbox / `CrmContact` field | Lantern target |
|---|---|
| `type` = "household" (`model.rs:206`), `name` (`:213`), `company_name` | `Household{name, ...}` |
| `type` = person/trust/org (`:186`) | `Person{personType, ...}` |
| `household` nested ref + `members[]` (`CrmHouseholdRef`/`Member`, `model.rs:76-105`) | `Household.members[personId]` ↔ `Person.householdIds`; member `title` → `HouseholdMember.role` |
| identity: first/middle/last/nickname/prefix/suffix/company/job (`:215-231`) | `Person.*` identity block |
| dates: birth/anniversary/client_since/retirement/death (`:233-238`) | `Person` dates; `client_since`→`Household.clientSince` for the household |
| `marital_status` (`:242`), `status` (`:246`), `contact_type` | `Person.maritalStatus`, `Household.status` |
| `background_information`/alias `background_info` (`:251-256`), `important_information`, `personal_interests` | `Person.background/importantInfo/personalInterests` |
| investor: `investment_objective/time_horizon/risk_tolerance` (`:262-268`) | `Person.investmentObjective/timeHorizon/riskTolerance` |
| financial: `gross_annual_income/assets/non_liquid_assets/liabilities/adjusted_gross_income/tax_bracket/tax_year` (`:270-277`) | **`Fact` records** (factType income/asset/liability/tax_bracket), `asOf` = `tax_year` when present, `observedAt` = sync time — money becomes dated claims, not flat fields |
| professional pointers: `attorney/cpa/doctor/insurance/business_manager/family_officer/trusted_contact` (contact ids, `:279-286`) | external `Person{isExternal, externalRole}` + `Fact{factType:'professional_relationship', value:{t:'entity'}}` linking household→person |
| `street_addresses/email_addresses/phone_numbers` (`CrmStreetAddress/Email/Phone`, `:288-294`, `model.rs:118-146`) | `Person.addresses/emails/phones` (verbatim reuse) |
| `tags[]` (`CrmTag`, `:300`, `model.rs:175-180`) | `Tag` entities + `entity_tags`; Wealthbox tag id in `Tag.externalRefs` |
| `contact_roles[]` raw JSON (`:302`) | `Person.roles[]` where a typed role can be recovered; otherwise curated `CustomFieldValue`s under generated `CustomFieldDef`s (§1.13) |
| `id`/`external_id`/`crm_key()` (`:201-203`, `:314-317`) | `external_refs` row keyed `(provider, sourceType, sourceId, scope)`; **never** the Lantern primary id (§2.1) |

**Notes — `CrmNote` (`model.rs:349-359`):** `content`→`Note.body`; `linked_to[]`
(`CrmLink`, `model.rs:154-165`)→`Note.links[]` (EntityRefs resolved via `external_refs`) and
every linked household becomes one `Note.householdLinks[]` entry. The importer creates ONE
note with a composite source external reference keyed `(provider, sourceType, sourceId, scope)`,
where `scope` is the deterministic sorted linked-household scope, never one copy per
household. Its body is
subject to the intersection-key rule in §2.2; `mentions[]` starts empty unless an explicit
source identity can be resolved.
`created_at`/`updated_at`→`Note.createdAt`/`updatedAt`; imported notes default
`audience:'internal'` and `authoredVia:'manual'` (no audience signal exists in Wealthbox —
flagged §7 Q5). Jump-pushed notes (E-029/030), if identifiable by content, set
`authoredVia:'jump-push'`.

**Tasks — `CrmTask` (`model.rs:371-391`):** `name`→`title`; `due_date`→`due`;
`complete`(bool)→`status` (`done` if true else `open`); `priority`→`priority`;
`description`→`body`; the resolved household link→`householdRef`; other `linked_to`
records→`contextRefs`. `assigneeUserId` and `recurrence` have no Wealthbox source and import
as null/absent. This is the D2 Task schema, with no importer-only variant.

**Projects:** each imported Wealthbox Project becomes one read-only `LegacyProject`, retaining
its normalized source snapshot, exact `rawRecordRef`, and the same `(provider, sourceType,
sourceId, scope)` external-reference identity. A project with linked households gets a
deterministic `anchorHouseholdId` and lives in that household's `crm:record`. An unlinked
project has `anchorHouseholdId: undefined`, `unlinked: true`, and lives in the `firm_home`
operational `crm:record`; it is visibly flagged **Unlinked** in Legacy Projects rather than
silently dropped or attached to a made-up household. The only conversion is the explicit
manual workflow launch in §1.16; the original LegacyProject remains present and linked to
that launch.

**Firm directory mapping:** Wealthbox users/assignee identities map to `FirmDirectoryEntry`
by provider user ID through `import_directory_mappings` (§3.2). This is a display/import
crosswalk only. It never creates a Lantern user, team, role, or permission.

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
`updatedAt` is the newest field write; each LWW field also carries a `#hlc` stamp (§2.3) so
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
is stored (§1.19).

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
2. Walks every collection doc in scope (a household's matter, a date range, or the whole
   firm), decrypts each Yjs doc locally (the firm holds the keys), and materializes a **plaintext
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

## 7. Remaining freeze questions

The following do not reopen D1-D5, D8, or D9.

1. **LWW loss on money/status fields (§2.3).** Is the ActivityEvent trail plus Fact
   supersession history enough when two people make a true concurrent scalar edit?
2. **Import note classification.** Wealthbox has no internal/client-facing signal. The
   migration default is internal; the migration screen must define bulk reclassification.
3. **Calendar/Event boundary.** Calendar, mail, and documents remain existing-subsystem
   records linked through EntityRef. Confirm the timeline-only import remains enough.
4. **Government IDs.** Keep them in encrypted vault documents unless a separate,
   redaction-reviewed design adds a structured field.
5. **Retention purge.** The eventual audited, counsel-approved far-end purge policy needs
   a separate specification.
6. **Custom-role curation.** Decide when an unmapped source contact role becomes a
   Person.roles entry, a curated custom field, or a legacy field retained only in the archive.

*Traceability: existing-code claims cite repo paths in `/home/jameson/lantern-crm`
(`src/platform/types/matter.ts`, `src/platform/clientMap/types.ts`,
`src-tauri/src/commands/crm/model.rs` + `store.rs`, `src-tauri/src/commands/audit/store.rs`,
`src/platform/firm/MatterSyncClient.ts` + `coedit/docCrdt.ts` + `contract.ts`). Design
principles cite `~/lantern-plus/user-research/10-path4-deep-dive.md` §4–5 and the feasibility
report `analysis-drafts/crm-core-feasibility.md`. Evidence items (E-###) trace to
`~/lantern-plus/user-research/01-evidence-ledger.md`. Compliance items in §6 are flags for
counsel, not conclusions.*
