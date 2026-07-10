# Planning-Software Write-Back Sockets: RightCapital + Holistiplan

**Created:** 2026-07-10
**Branch:** `docs/planning-writes`
**Scope:** research and plan only. No product source changes in this worktree.
**Inputs read first:** `docs/2026-07-10-advisor-pain-analysis-and-lantern-answers.md`.

## Plain answer

Build this as one approval-gated "outside-system update" machine with two planning sockets, not as two special integrations.

RightCapital is the urgent socket because income changes are the #1 drift. Public evidence confirms RightCapital partners can read existing planning data and write approved create/update recommendations for Income, Expense, Goal, and Family records. Public evidence does **not** confirm account type or new-account write support. Treat account changes as a second-class candidate until RightCapital grants partner docs.

Holistiplan is the tax socket. Public evidence confirms a real Holistiplan Public API exists, but access is approved case by case. Public pages say the API can create households/clients, feed tax documents in, and pull tax reports out. The detailed endpoint explorer is published at a Holistiplan app URL, but exact endpoint schemas require access.

The product rule is simple: Lantern may draft a change, but the advisor must approve it. Every approved write gets a receipt. If delivery is unclear, Lantern says so and verifies before retrying.

## Why this matters

The pain-analysis doc says Jump impressed the design-partner firm because it can write meeting facts to RightCapital, and the same firm wants Holistiplan integration. Jameson's note sharpens the priority:

1. Income changes are the #1 drift.
2. Account type changes and account additions are probably #2.

That maps to this product promise:

> Lantern catches planning drift from meetings and intake, stages a clearly reviewed update, sends only what the advisor approves, and leaves a receipt.

This is not an integration-breadth race. It is one narrow drift loop.

## Research

Verified on 2026-07-10.

### RightCapital

**What is public and confirmed**

RightCapital publishes a public integration directory and help center for end users, not public self-serve developer docs.

The official RightCapital integration overview says advisor integrations move data into RightCapital and can reduce the work needed to create and update client plans. It lists Data Management partners including Jump, Zocks, and PreciseFP. Source: [RightCapital integrations overview](https://help.rightcapital.com/integrations/integrations).

RightCapital's official Jump integration page confirms:

- Jump connects through a RightCapital login and access grant.
- The RightCapital household must already exist before Jump can suggest updates.
- After a meeting, Jump identifies the RightCapital household, compares the transcript with existing RightCapital data, and drafts recommendations.
- The advisor can accept, modify, or dismiss each recommendation.
- After the advisor clicks "Sync to RightCapital," approved changes are sent.
- The public field families named are Family, Goals, Income, and Expenses. Income types shown are Salary, Self-Employment, Bonus, Child support, Alimony, Royalty, Pension, and Other.

Source: [RightCapital help: Jump integration](https://help.rightcapital.com/integrations/data-management/jump).

PreciseFP, another data-management partner, says its RightCapital integration can import and export client data across household, contact, income, expense, and goal fields, with most fields working both ways. Source: [PreciseFP RightCapital partner page](https://precisefp.com/partners/rightcapital/).

**What appears partner-gated or undocumented**

I found no official public RightCapital endpoint schema, developer portal, OAuth app registration guide, write payload docs, or rate-limit docs for Lantern to use directly. The public evidence proves partner integrations exist and that at least some partners can write RightCapital planning facts, but it does not prove Lantern can self-serve API access.

Treat RightCapital as **partner-gated** until RightCapital gives us:

- partner API application path,
- OAuth/client-registration requirements,
- sandbox account,
- endpoint docs for household search/read,
- endpoint docs for Income create/update,
- endpoint docs for account/manual-account create/update if they exist,
- write verification/readback behavior.

**Read/write matrix**

| Area | Public status | Lantern stance |
|---|---|---|
| Household lookup/read | Confirmed indirectly: Jump identifies an existing RightCapital household and compares transcript facts to existing data. | Build only after partner docs confirm the exact household search/read endpoint. |
| Income read/write | Confirmed at feature level: Jump drafts create/update recommendations for Income, and sends approved changes. Income types are listed publicly. | Wave 1 target. Income is the #1 drift. |
| Expenses read/write | Confirmed at feature level. | Wave 2 or behind income. |
| Goals read/write | Confirmed at feature level. | Later. Not the current pain top-two. |
| Family read/write | Confirmed at feature level. | Later. High risk because people/relationships are easy to mis-merge. |
| Account type changes/new accounts | **Not confirmed** in the public Jump or PreciseFP pages I found. | Do not promise. Research with RightCapital. Prototype only if partner docs prove it. |
| New household creation | Jump page says the household must already exist. PreciseFP may have broader household/contact import/export, but this does not prove Jump-like API access for Lantern. | Do not depend on new household creation for v1. |

### Holistiplan

**What is public and confirmed**

Holistiplan has a public API program. Its official API guide says access is evaluated case by case and asks applicants to contact `support@holistiplan.com`. It also says the API uses OAuth 2.0 Client Credentials, requires `scope` value `read write`, provides v1 and v2 base URLs, shows an example household-list request, mentions pagination and possible rate limits, and links to interactive API documentation. Source: [Holistiplan API guide](https://help.holistiplan.com/getting-started-with-the-holistiplan-api).

Holistiplan also publishes a public API marketing page that names the broad flow:

- create households and clients,
- feed documents in for tax analysis,
- pull outputs back out, including PDF tax reports, Roth conversion recommendations, and tax letters.

Source: [Holistiplan Public API page](https://www.holistiplan.com/wp-content/uploads/holistiplan-public-api-page.html). The wrapper page is [Holistiplan Public API](https://www.holistiplan.com/holistiplan-public-api/).

**What appears partner-gated or undocumented**

The exact endpoint schemas, object models, upload request shapes, report IDs, and webhook behavior are not fully visible from the public pages. The interactive docs URL is public, but useful exploration likely requires an approved Holistiplan account/API access. Treat exact read/write shapes as gated.

**Read/write matrix**

| Area | Public status | Lantern stance |
|---|---|---|
| Household list/read | Confirmed by the public guide's example `GET /api/public/v1/households/`. | Safe first read probe after access. |
| Household/client create | Confirmed by public API page at feature level. | Needed to match Lantern client to Holistiplan household/client. |
| Tax document upload | Confirmed at feature level: feed documents in. | First real write. Use only advisor-approved uploads from the client folder. |
| Tax reports read/download | Confirmed at feature level: pull reports out, including PDF reports and tax letters. | First real readback. Store outputs as cited client-folder artifacts. |
| Tax field-level edits | Not confirmed publicly. | Do not promise. |
| Re-running analyses / scenario creation | Roth conversion recommendations are named, but exact action shape is not public. | Partner-doc question before build. |

## Design principle: integration honesty

Every connector ships with a plain "what this can and cannot do" card.

For RightCapital v1:

- Can propose and, after approval, write income updates if partner docs confirm the API.
- Cannot create RightCapital households unless vendor docs confirm it.
- Cannot update account type or add accounts unless vendor docs confirm it.
- Never writes silently.

For Holistiplan v1:

- Can send approved tax documents to Holistiplan if API access is granted.
- Can pull Holistiplan reports back into the client folder if API access is granted.
- Cannot promise field-level tax edits or scenarios until docs confirm those endpoints.
- Never sends a document silently.

## Existing approval engine to reuse

The current Wealthbox write path already has the hard parts. Do not rebuild them.

Relevant files:

- `src-tauri/src/commands/crm/write.rs`
  - `CrmWriteRequest` stores the target, source reference, approval timestamp, and optional provenance (`lines 23-58`).
  - `WriteReceipt` returns the remote id and whether the write was deduped (`lines 61-68`).
  - `CrmFieldUpdateRequest` models the three-column field write: existing value, new value, final approved value (`lines 188-220`).
  - `CrmWriteSource` is already a provider trait, but it is CRM-shaped today: note, task, field update, readback (`lines 249-282`).
  - `push_crm_write` is the idempotent send machine. It locks the write, checks the ledger, verifies ambiguous prior sends, writes the pending row before network send, records sent/pending/failed, and returns a receipt (`lines 640-833`).
  - `push_crm_field_update` adds the key safety behavior for field edits: reread the current outside value at approval time, refuse stale writes, then reread after a successful update so a false 200 does not become a fake receipt (`lines 924-1030`).
- `src-tauri/src/commands/crm/store.rs`
  - `crm_outbound_writes` is the durable ledger for outbound writes (`lines 202-214`).
  - `outbound_get`, `outbound_upsert`, and recovery lookup are the storage surface to generalize (`lines 631-760`).
- `src-tauri/src/commands/crm/commands.rs`
  - `crm_create_note` and `crm_create_task` document the important product rule: the frontend review card is the only legitimate caller after an explicit Approve click (`lines 626-641`).
  - `crm_create_write` blocks writes during disconnect/reconnect, validates input, opens the encrypted store, calls the write engine, and appends a matter-scoped audit entry (`lines 709-841`).
  - `crm_update_field` is the field-write command with stale-write audit handling (`lines 844-990`).
- `src/platform/state/crmWriteQueueStore.ts`
  - The queue persists unapproved proposals and says enqueuing never sends (`lines 1-22`).
  - `ProposedCrmWrite` already handles `note`, `task`, and `field`, with statuses for proposed/sending/sent/failed/verify_pending/stale (`lines 32-83`).
  - `sendOne` sets `requestedAt` once per approval, calls the Tauri command, and maps stale/verify failures back into reviewable UI state (`lines 167-247`).
- `src/features/matters/CrmWriteReviewCard.tsx`
  - The card says "AI proposes, the advisor decides" and nothing sends on enqueue, mount, or timer (`lines 1-14`).
  - It resets target selection when switching clients, forces review again after stale values, checks connection, selects target household, and approves only selected rows (`lines 88-210`, `221-286`, `367-459`).
  - The field row already shows Existing, From this meeting, and Blended edit-before-approval columns (`lines 549-582`).
- `src/platform/utils/wealthbox-commands.ts`
  - The TypeScript wrappers clearly state the only legitimate call site is the review card's Approve handler (`lines 207-214`) and pass `provider` through the current CRM commands (`lines 215-307`).
- `src/platform/state/fieldBlend.ts`
  - Narrative field blending keeps existing facts, folds in new info, sanitizes prompt text, and requires an egress-audit hook before any AI call (`lines 1-19`, `51-118`).

## Socket design

### Name

Use **External Write Socket** as the shared concept in code docs. Use **Review update** or **Send approved update** in user-facing UI.

### Minimal-change path

Do not immediately rename every `crm` file. That creates risk and churn. Instead:

1. Keep the existing Wealthbox path as the first implementation.
2. Add a small new backend layer beside it, not through it:
   - `src-tauri/src/commands/writeback/model.rs`
   - `src-tauri/src/commands/writeback/store.rs`
   - `src-tauri/src/commands/writeback/engine.rs`
   - `src-tauri/src/commands/writeback/rightcapital.rs`
   - `src-tauri/src/commands/writeback/holistiplan.rs`
3. Lift the reusable logic from `crm/write.rs` into the new engine only when the first non-Wealthbox socket is implemented:
   - in-flight key guard,
   - "pending before network" rule,
   - sent/pending_verify/failed statuses,
   - verify-before-resend for create-like writes,
   - stale guard for update-like writes,
   - readback verification after update-like writes,
   - matter-scoped audit receipt.
4. Leave Wealthbox on the current code for the first planning spike. After the new writeback engine is tested with RightCapital/Holistiplan, migrate Wealthbox through it as a cleanup wave.

This avoids a risky "rename the engine before we know the planning APIs" rewrite.

### Shared model

New generic request:

```ts
type ExternalWriteTarget = 'wealthbox' | 'rightcapital' | 'holistiplan';

type ExternalWriteKind =
  | 'create_record'
  | 'update_record'
  | 'upload_document'
  | 'download_artifact';

type ExternalWriteStatus =
  | 'proposed'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'verify_pending'
  | 'stale';
```

Backend shape:

```rust
pub struct ExternalWriteRequest {
    pub target: ExternalWriteTarget,
    pub operation: ExternalWriteOperation,
    pub matter_id: String,
    pub subject_key: String,
    pub source_ref: String,
    pub requested_at: String,
    pub before_hash: Option<String>,
    pub after_hash: String,
}

pub struct ExternalWriteReceipt {
    pub target: String,
    pub operation: String,
    pub remote_id: String,
    pub deduped: bool,
    pub receipt_ref: String,
}
```

The important mapping:

- Current `household_key` becomes generic `subject_key`.
- Current `kind` becomes `operation`.
- Current `source_ref` stays.
- Current `requested_at` stays.
- Current ledger status stays.
- Current receipt shape stays but gets `target`, `operation`, and `receipt_ref`.

### Provider trait

New backend trait:

```rust
#[async_trait::async_trait]
pub trait ExternalWriteSocket: Send + Sync {
    fn target_id(&self) -> &'static str;
    fn supports(&self, operation: &ExternalWriteOperation) -> bool;
    async fn read_current(&self, req: &ExternalWriteRequest) -> Result<ExternalCurrentValue, ExternalWriteError>;
    async fn apply(&self, req: &ExternalWriteRequest) -> Result<ExternalRemoteResult, ExternalWriteError>;
    async fn verify(&self, req: &ExternalWriteRequest, remote: Option<&ExternalRemoteResult>) -> Result<ExternalVerifyResult, ExternalWriteError>;
}
```

The engine decides safety. The socket only knows the vendor.

### Operation types

Keep operation payloads typed, not loose JSON strings.

RightCapital v1:

```rust
pub enum RightCapitalOperation {
    UpsertIncome {
        client_id: String,
        income_id: Option<String>,
        income_type: RightCapitalIncomeType,
        owner: Option<String>,
        amount: MoneyAmount,
        frequency: IncomeFrequency,
        start_date: Option<String>,
        end_date: Option<String>,
        notes: String,
    },
}
```

RightCapital later, only if docs confirm it:

```rust
pub enum RightCapitalOperation {
    UpsertAccount { ... },
    UpsertExpense { ... },
    UpsertGoal { ... },
    UpsertFamilyMember { ... },
}
```

Holistiplan v1:

```rust
pub enum HolistiplanOperation {
    EnsureHousehold { ... },
    EnsureClient { ... },
    UploadTaxDocument { document_ref: String, tax_year: i32, document_kind: String },
    ImportReport { report_id: String, destination_ref: String },
}
```

### Queue/UI generalization

Do not clone the review UI. Generalize the queue and card:

- Rename later, not immediately:
  - `crmWriteQueueStore` -> `externalWriteQueueStore`,
  - `CrmWriteReviewCard` -> `ExternalWriteReviewCard`,
  - `wealthbox-commands.ts` wrappers -> `external-write-commands.ts`.
- First implementation can add a parallel queue with the same behavior, then retire the CRM-specific one after Wealthbox migration.
- Reuse the row types:
  - `note/task` style row for document upload or report import,
  - `field` style row for RightCapital income edits.
- UI label examples:
  - "Update RightCapital"
  - "Send to Holistiplan"
  - "Nothing is sent until you approve"
  - "Delivery unconfirmed. Lantern will check before retrying."

### Ledger generalization

Use a new table instead of stretching `crm_outbound_writes` across unrelated systems:

```sql
CREATE TABLE IF NOT EXISTS external_outbound_writes (
  dedup_key TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  operation TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  matter_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  remote_id TEXT,
  receipt_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  content_key TEXT NOT NULL DEFAULT '',
  before_hash TEXT,
  after_hash TEXT NOT NULL
);
```

This copies the proven ledger idea from `crm_outbound_writes`, while keeping planning/tax writes separate from CRM internals.

### Safety rules

Every planning socket must follow these rules:

1. Proposal creation never sends data.
2. Approve is the only send path.
3. The ledger row is written before any external write.
4. Retrying an unclear send verifies first.
5. Field/entity updates reread current vendor state before writing.
6. Field/entity updates reread after success before calling it done.
7. All AI blending needs an egress audit entry before sending text to a model.
8. Every receipt is matter-scoped.
9. Raw vendor response bodies are never logged.
10. Every connector has an honesty card.

## RightCapital socket

### v1 target: income changes only

Start with income because:

- it is Jameson's stated #1 drift,
- RightCapital's public Jump page explicitly names Income,
- the public income types are known,
- income changes are small enough for a clear review card.

### RightCapital income proposal shape

The proposal comes from meeting notes, intake, or uploaded documents:

```ts
type RightCapitalIncomeProposal = {
  target: 'rightcapital';
  kind: 'income';
  matterId: string;
  rightCapitalHouseholdId: string;
  existing: {
    incomeId?: string;
    incomeType?: string;
    owner?: string;
    amount?: number;
    frequency?: string;
    startDate?: string;
    endDate?: string;
    notes?: string;
  };
  fromSource: {
    incomeType: string;
    owner?: string;
    amount: number;
    frequency: string;
    startDate?: string;
    endDate?: string;
    confidence: 'high' | 'medium' | 'low';
    quote: string;
  };
  final: {
    incomeId?: string;
    incomeType: string;
    owner?: string;
    amount: number;
    frequency: string;
    startDate?: string;
    endDate?: string;
    notes: string;
  };
  sourceRef: string;
};
```

### Review card

Use a three-column row:

| Column | Meaning |
|---|---|
| Current in RightCapital | What Lantern read from RightCapital when the proposal was created. |
| From this meeting/intake | The fact Lantern found, with source quote and confidence. |
| Will send | Editable final fields. This is the only thing sent after approval. |

The row must show:

- client/household name,
- target software: RightCapital,
- income type,
- owner,
- amount,
- frequency,
- start/end date if present,
- source quote,
- "Approve" checkbox,
- "Dismiss" action,
- receipt status after send.

### Account type/new-account changes

Do not build v1 around this. Public research did not confirm RightCapital write support for account type changes or account additions.

Keep a product placeholder:

- detect account-change facts,
- show them as "Planning drift found",
- file them as a Lantern task for the advisor,
- show "RightCapital write support not confirmed yet" in the connector honesty card.

If RightCapital grants API docs that support account writes, this becomes the v2 operation:

```rust
RightCapitalOperation::UpsertAccount { ... }
```

## Holistiplan socket

### v1 target: document in, report out

Do not invent tax field edits. Use the public API shape we can honestly support once access is granted:

1. Match Lantern client to Holistiplan household/client.
2. Stage one or more tax documents from the Lantern client folder.
3. Advisor approves sending the selected documents.
4. Lantern uploads documents.
5. Lantern imports generated reports or tax letters back into the client folder.
6. Lantern records receipts for both outbound upload and inbound artifact.

### Proposal shape

```ts
type HolistiplanUploadProposal = {
  target: 'holistiplan';
  kind: 'tax_document_upload';
  matterId: string;
  holistiplanHouseholdId?: string;
  holistiplanClientId?: string;
  documents: Array<{
    documentRef: string;
    displayName: string;
    taxYear?: number;
    documentKind?: 'tax_return' | 'w2' | '1099' | 'other';
    source: 'intake' | 'client_folder' | 'email';
  }>;
  sourceRef: string;
};
```

### Review card

Use a document-send row:

- "Send 2025 tax return to Holistiplan"
- document names,
- tax year,
- target household/client,
- warning if target match is uncertain,
- "Nothing is sent until you approve",
- receipt after upload,
- imported reports listed under the receipt.

### Receipt

For Holistiplan, the receipt needs two halves:

1. Upload receipt: document ref, Holistiplan remote id, timestamp, advisor approval id.
2. Return receipt: report id, destination file path, timestamp, source report name.

## Income-change flow end to end

Scenario: the client says in a meeting, "I got a new job. My salary is now $185,000, and the bonus is usually around $20,000."

1. Capture source
   - Source can be a meeting note, transcript, intake answer, or uploaded pay stub.
   - Lantern stores the source in the client folder and indexes it.
   - The extraction records the exact source reference, such as `meeting:2026-07-10#00:18:42` or `intake:income`.

2. Detect planning drift
   - The drift detector produces two facts:
     - salary income changed to `$185,000/year`,
     - bonus income changed to `$20,000/year`.
   - Each fact includes confidence and the source quote.

3. Read current RightCapital value
   - RightCapital socket reads the household's current income records.
   - If it can match the existing salary record, it creates an update proposal.
   - If it cannot match, it creates a "new income record" proposal, but the review card must make that clear.

4. Create proposal
   - No external write happens.
   - The queue receives a RightCapital income proposal with Current, From this source, and Will send values.
   - `requestedAt` is blank until approval, matching the current queue pattern.

5. Advisor review
   - Card title: "Update RightCapital".
   - Row 1: Salary.
   - Row 2: Bonus.
   - The advisor can edit amount, frequency, owner, start date, and notes.
   - Low-confidence facts are unchecked by default.
   - If no RightCapital household is linked, the card asks the advisor to link it first.

6. Approve
   - The queue stamps `requestedAt` once.
   - The backend writes `pending` to `external_outbound_writes` before calling RightCapital.
   - The RightCapital socket rereads the income record first.
   - If RightCapital changed since proposal time, the write is marked `stale` and the card reloads the fresh current value for review.

7. Apply
   - The socket sends the approved create/update payload.
   - A successful HTTP response is not enough.
   - The socket reads back the income record and checks that the final value actually applied.

8. Receipt
   - If confirmed: "Salary updated in RightCapital" with remote id, source ref, timestamp, and dedup status.
   - If ambiguous: "Delivery unconfirmed. Lantern will verify before retrying."
   - If failed: clear plain error, no fake success.
   - Audit entry is matter-scoped and deterministic for retries.

9. Client Map update
   - The Client Map shows the income fact as current.
   - It links to both the source note/intake fact and the RightCapital receipt.

## Wave breakdown

### Wave 0 - vendor access and proof

Deliverables:

- Add RightCapital and Holistiplan rows to the existing vendor-applications checklist.
- File vendor requests.
- Create connector honesty card drafts.
- No product code.

Exit criteria:

- RightCapital response captured.
- Holistiplan API access path captured.
- Confirmed sandbox or explicit blocker for each.

### Wave 1 - generic planning write model, no live vendor

Deliverables:

- External write proposal model.
- External write queue model mirroring the current CRM queue.
- Review-card prototype using fake target fixtures.
- Ledger schema plan and tests.
- No live RightCapital/Holistiplan network calls.

Exit criteria:

- Proposal persists across restart.
- Approve is the only send path.
- Stale field simulation forces rereview.
- Receipt simulation works.

### Wave 2 - RightCapital income socket

Deliverables:

- RightCapital OAuth/token storage after partner docs.
- Household/client match.
- Income read.
- Income create/update.
- Readback verification.
- Income honesty card.

Exit criteria:

- Live sandbox can update a salary record.
- Duplicate approve does not duplicate the write.
- Ambiguous failure verifies before retry.
- Stale RightCapital value blocks blind overwrite.
- Account writes remain hidden unless docs confirm them.

### Wave 3 - Holistiplan document upload and report import

Deliverables:

- Holistiplan OAuth client-credentials setup after approval.
- Household/client match.
- Approved document upload.
- Report list/download/import.
- Holistiplan honesty card.

Exit criteria:

- Live sandbox can upload a tax document.
- Imported report lands in the client folder.
- Upload receipt and report receipt are both visible.
- Rate-limit and file-size errors are plain and retryable.

### Wave 4 - Account-change research spike

Deliverables:

- RightCapital partner-doc review for accounts/manual accounts/holdings/account type.
- If supported, operation design for account addition/type change.
- If unsupported, task-only fallback design.

Exit criteria:

- Clear public/internal answer: supported, unsupported, or blocked.
- No UI promise without docs.

### Wave 5 - Wealthbox migration to shared engine

Deliverables:

- Move Wealthbox note/task/field write path onto the shared external-write engine.
- Keep current UI behavior.
- Retire duplicate CRM-only queue once tests prove parity.

Exit criteria:

- Existing Wealthbox review card tests still pass.
- Existing ledger safety behavior preserved.
- No user-visible regression.

## Vendor-access asks for Jameson

Batch these into one vendor-access push so Jameson is not handling one-off chores.

### Shared application facts

- Product name: Lantern, unless Jameson has a different final advisor-facing brand before submission.
- Contact email: `developers@keepance.com`.
- Description: "Lantern is a desktop app for financial advisors. It keeps client data local-first and encrypted on the advisor's device. It drafts updates to advisor systems from meeting notes, intake answers, and client documents, but nothing is sent until the advisor reviews and approves it. Every approved external write gets a receipt."
- Privacy note: "Lantern does not store client content on Lantern servers. Any hosted relay component is ciphertext-only."

### RightCapital asks

Ask RightCapital for:

1. Partner/API program application path.
2. Sandbox advisor account.
3. OAuth/client-registration requirements.
4. Endpoint docs for household search/read.
5. Endpoint docs for income read/create/update.
6. Endpoint docs for expenses/goals/family, for later.
7. Explicit yes/no on account type changes and new account/manual-account creation.
8. Rate limits.
9. Webhook/change-log support, if any.
10. App review/security questionnaire requirements.

Plain ask:

> We are building an approval-gated RightCapital write-back from advisor-reviewed meeting/intake facts. Our first target is income updates only. Do you offer partner API access for reading existing household income records and creating/updating approved income records? We also need to know whether account type changes or new account additions are supported, or whether those are outside your partner API.

### Holistiplan asks

Ask Holistiplan for:

1. Public API access approval.
2. OAuth client credentials.
3. Sandbox or test firm.
4. Endpoint docs for household/client create/read/update.
5. Endpoint docs for tax document upload.
6. Endpoint docs for report listing/download.
7. Exact list of report types available through API.
8. File size/type limits.
9. Rate limits.
10. Webhooks or polling guidance for report readiness.
11. Security questionnaire requirements.

Plain ask:

> We are building an approval-gated Holistiplan socket for advisors. The first version would let an advisor select tax documents already stored in Lantern, approve sending them to Holistiplan, then pull resulting reports back into the client's Lantern folder. Do your Public API endpoints support creating/matching households and clients, uploading tax documents, and retrieving generated reports? We would like sandbox access and exact endpoint docs.

## Open risks

- RightCapital may require a formal partnership before any API access.
- RightCapital may allow income writes but not account writes. Do not promise account type changes yet.
- RightCapital field names and write semantics may differ from the public Jump field labels.
- Holistiplan's API may allow document upload and report download but not every report type shown on the public marketing page.
- Holistiplan report generation may be async and may need polling or webhooks.
- Both vendors may reject a local desktop public-client model and require server-side confidential clients. If so, Lantern must use a zero-content token broker design and avoid sending client content through our servers.
- Review-card UX must stay small. Too many integrations in the Client Map will make Lantern feel like the integration maze we are trying to beat.

## Recommended first build after access

RightCapital income only.

Reason: it hits the #1 drift, has public evidence, gives the strongest Jump parity demo, and is small enough to prove the generalized write engine without turning Lantern into an integration buffet.

Holistiplan follows as document-in/report-out because that is the honest public API shape.
