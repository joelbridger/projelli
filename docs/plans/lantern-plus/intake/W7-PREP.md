# Lantern Intake - Wave 7 Prep Pack

## Goal

Wave 7 ships standing form requests for existing clients. The advisor can open a client page, choose a saved blueprint, adjust the items, and send the same secure link machinery used by onboarding. Onboarding becomes the first filtered view of a broader requests board, not a separate engine.

Read sources:

- `docs/plans/lantern-plus/intake/WAVE-PLAN.md`, Wave 7.
- `docs/plans/lantern-plus/intake/PRODUCT-DESIGN.md`, especially sections 1a, 3, 5, and 11.
- `docs/plans/lantern-plus/intake/ARCHITECTURE.md`, especially section 9a.
- `src/platform/intake/types.ts`, the merged Wave 1 Lane A contract.

## Current Ground Truth

The shared contract already names standing requests:

```ts
export type FormRequestKind = 'onboarding' | 'standing';

export interface FormRequest {
  request_id: string;
  schema_version: number;
  matter_id: string;
  kind: FormRequestKind;
  blueprint_ref?: string;
  items: RequestItem[];
}
```

The item union in `src/platform/intake/types.ts` is:

- `TypedFieldRequestItem` with `t: 'typed_field'`, `fact_kind: FactKind`, `input: TypedFieldInputFormat`, and optional `placeholder`.
- `DocUploadRequestItem` with `t: 'doc_upload'`, optional `accepted_mime_types`, `max_files`, and `max_bytes`.
- `GuidedQuestionRequestItem` with `t: 'guided_question'`, `prompt`, `response_format`, and optional `choices`.
- `ReadonlyCardRequestItem` with `t: 'readonly_card'`, `body`, and optional `acknowledgement_required`.
- `PdfFillRequestItem` with `t: 'pdf_fill'`, `pdf_ref`, `field_map`, and `prefill`.
- `SignatureRequestItem` with `t: 'signature'`, `grade: 'docusign' | 'native_clicksign'`, and optional `document_ref`.

The common item fields come from `RequestItemBase`: `t`, `item_id`, `label`, `help_text`, `required`, and `subject`.

The relay is also compatible with standing requests at the storage level. `backend/src/lib/db.ts` stores an intake as opaque `checklist_ciphertext` and `state_ciphertext` plus routing and lifecycle fields. It does not have plaintext columns for request kind, item labels, client names, or blueprint names. That means a standing request can ride the same relay as long as the sealed checklist contains a valid `FormRequest`.

Important naming rule: the wire path and backend namespace stay `intake`. The product surface can say "requests", but routes like `backend/src/routes/intake.ts` and helpers like `src/platform/intake/intakeContract.ts` should not be renamed.

## Schema Readiness Verdict

Core verdict: yes, the merged `FormRequest` and `RequestItem` contract supports standing requests without migrating existing onboarding data.

Why that is true:

- `FormRequest.kind` already accepts `'standing'`, so Wave 7 does not need to rewrite onboarding requests to introduce the concept.
- `FormRequest.blueprint_ref?: string` already gives a request a link back to the saved item set that produced it.
- `FormRequest.items: RequestItem[]` already carries typed fields, document uploads, guided questions, read-only cards, PDF fill items, and signature items in one list.
- `schema_version: number` exists from Wave 1. Per architecture section 9a, forward-compatible means additive growth only. Wave 7 can add optional fields or new local metadata without breaking old sealed onboarding checklists.
- `matter_id: string` is already present and must stay the internal client boundary identifier.
- The relay stores sealed bytes, not decoded form rows. No backend data migration is needed to carry `kind: 'standing'` inside the sealed checklist.

Gaps to flag honestly:

- There is no `Blueprint` type or blueprint store yet. `blueprint_ref` is only a string in the request contract.
- There is no `src/platform/intake/intakeStore.ts`, `src/platform/intake/factsStore.ts`, `src/platform/intake/IntakeSyncClient.ts`, or `src/features/intake/` UI in this worktree yet. Wave 7 depends on those Wave 1 advisor-side pieces existing or being built first.
- `FormRequest` does not currently carry a request title, display status, slug, or board metadata. That is not a migration blocker because these can be added as optional fields or kept in the local request state store, but the board cannot be built from `FormRequest` alone.
- `GuidedQuestionRequestItem` does not have a `fact_kind` field. `TypedFieldRequestItem` does. If guided answers like income and spending must write `ClientFact` rows without item-id conventions, Wave 7 should add an optional fact mapping field.
- `DocUploadRequestItem` does not have named upload slots. The New household license item can use `max_files: 2`, but "front" and "back" are not first-class slot names yet. If the UI needs named slots, add them additively.
- `PdfFillRequestItem` and `SignatureRequestItem` are declared now, but their full flows still belong to later waves. Blueprints should be able to reserve those item types without pretending the UI can complete them before their waves land.

## Lane Decomposition

### Lane A - Request Composer On The Client Page Path

Purpose: add "Request from client" to the existing per-client page path.

Existing anchors:

- `src/app/shell/AppSurfaceRouter.tsx` renders `MattersHome` and already passes render props for client Documents, Email, and Activity.
- `src/features/matters/MattersHome.tsx` forwards those render props into `MatterHub`.
- `src/features/matters/MatterHub.tsx` owns the per-client tab bar through `HUB_TABS`.
- `src/platform/matter/matterStore.ts` defines `ClientMapHubTab` as `'overview' | 'documents' | 'email' | 'meetings' | 'activity'`.

Recommended shape:

- Add a new app-composed render prop instead of making `matters` import `intake` directly:
  - `src/app/shell/AppSurfaceRouter.tsx`: pass `renderClientRequests`.
  - `src/features/matters/MattersHome.tsx`: accept and forward `renderClientRequests`.
  - `src/features/matters/MatterHub.tsx`: accept `renderRequests`, add a Requests tab, and render the supplied tab body.
  - `src/platform/matter/matterStore.ts`: extend `ClientMapHubTab` with `requests`.
- Put the request UI under `src/features/intake/`:
  - `src/features/intake/ClientRequestsTab.tsx`
  - `src/features/intake/RequestComposerDialog.tsx`
  - `src/features/intake/RequestItemsEditor.tsx`
  - `src/features/intake/RequestSendPanel.tsx`
  - `src/features/intake/RequestLinkControls.tsx`
- Put pure request helpers under `src/platform/intake/`:
  - `src/platform/intake/requestFactory.ts`
  - `src/platform/intake/requestSlugs.ts`
  - `src/platform/intake/requestValidation.ts`

Behavior:

- On any client page, the advisor sees a "Request from client" action.
- The composer starts from a blueprint, defaults `kind` to `'standing'` for existing-client requests, and writes a `FormRequest` with `matter_id`, `request_id`, `schema_version`, `kind`, `blueprint_ref`, and `items`.
- The advisor can reorder, remove, mark required, and edit `label` and `help_text` before sending.
- Sending reuses the Wave 1 link mint, revoke, extend, regenerate, sync, and filing paths.
- Returned files land under `Requests/<request-slug>/`. Onboarding keeps `Requests/onboarding/`.

Tests and gates:

- `tests/unit/matter/matterHub.test.tsx`: Requests tab renders and switches without leaking state across clients.
- `tests/unit/app/useGlobalEventBus.test.tsx`: direct navigation can open the Requests tab if Wave 7 adds that route.
- `src/features/intake/__tests__/requestComposer.test.tsx`: composer emits `kind: 'standing'`, preserves `matter_id`, sets `blueprint_ref`, and never stores submitted values.
- `src/platform/intake/__tests__/requestFactory.test.ts`: blueprint to request conversion is deterministic and validates item ids.

### Lane B - Blueprints Store

Purpose: make reusable saved item sets real. A blueprint is not a sent request. It has no link, no keypair, no submitted values, and no relay lifecycle.

New platform files:

- `src/platform/intake/blueprintTypes.ts`
- `src/platform/intake/defaultBlueprints.ts`
- `src/platform/intake/blueprintsStore.ts`
- `src/platform/intake/__tests__/blueprints.test.ts`

Existing shared files to update:

- `src/config/identity.ts`: add a storage key such as `SK_INTAKE_BLUEPRINTS`.
- `src/platform/state/reloadWorkspaceScopedStores.ts`: include the store only if it needs active workspace scoping.

Recommended blueprint shape:

```ts
export interface RequestBlueprint {
  blueprint_id: string;
  schema_version: number;
  label: string;
  description?: string;
  source: 'built_in' | 'firm_saved' | 'pdf_import' | 'native_builder';
  default_kind: FormRequestKind;
  items: RequestItem[];
  archived?: boolean;
}
```

Rules:

- `items` use the real `RequestItem` union from `src/platform/intake/types.ts`.
- `blueprint_id` becomes `FormRequest.blueprint_ref` when a request is created.
- Built-in blueprints are read-only. Firm-saved blueprints can be copied, renamed, archived, and edited.
- Archive blueprints that have been used. Do not hard-delete them while requests still reference their `blueprint_ref`.
- Blueprints never store client-submitted values, `ClientFact.value`, file names, or visible prefill ciphertext.
- PDF blueprints may store `field_map` once Wave 8 lands, but visible prefill values must be computed at send time from `ClientFact` and `PdfPrefill`.

First blueprint: `new-household`.

```ts
const NEW_HOUSEHOLD_BLUEPRINT: RequestBlueprint = {
  blueprint_id: 'new-household',
  schema_version: 1,
  label: 'New household',
  source: 'built_in',
  default_kind: 'onboarding',
  items: [
    { t: 'readonly_card', item_id: 'welcome', label: 'Welcome', help_text: '', required: false, subject: 'household', body: '...' },
    { t: 'typed_field', item_id: 'dob', label: 'Date of birth', help_text: 'Use the date on your government ID.', required: true, subject: 'primary', fact_kind: 'dob', input: 'date' },
    { t: 'typed_field', item_id: 'ssn', label: 'Social Security number', help_text: 'This is locked on your device before it is sent.', required: true, subject: 'primary', fact_kind: 'ssn', input: 'ssn' },
    { t: 'doc_upload', item_id: 'drivers-license', label: "Driver's license", help_text: 'Add the front and back.', required: true, subject: 'primary', accepted_mime_types: ['image/jpeg', 'image/png', 'application/pdf'], max_files: 2 },
    { t: 'guided_question', item_id: 'income', label: 'Income', help_text: 'A rough answer is okay.', required: true, subject: 'household', prompt: 'About how much income do you expect this year?', response_format: 'money' },
    { t: 'guided_question', item_id: 'spending', label: 'Spending', help_text: 'A rough monthly estimate is useful.', required: true, subject: 'household', prompt: 'About how much do you spend each month?', response_format: 'money' },
    { t: 'readonly_card', item_id: 'next', label: 'What happens next', help_text: '', required: false, subject: 'household', body: '...' },
  ],
};
```

The sample above uses only fields that exist in the merged type file. Richer guided-answer modes, named license slots, and direct fact mapping for guided questions should be additive fields, not rewrites.

### Lane C - Requests Board Generalization

Purpose: turn the Wave 2 Onboarding board into a requests board, with Onboarding as the flagship filtered view.

Existing anchors:

- `src/features/matters/MattersHome.tsx` is the main clients surface.
- `src/platform/state/appNavigationStore.ts` defines `MattersSurfaceMode` as `'client-map' | 'all-clients'`.
- `src/app/shell/AppSurfaceRouter.tsx` receives and passes `mattersSurfaceMode`.

Recommended files:

- `src/features/intake/RequestsBoard.tsx`
- `src/features/intake/RequestsBoardRow.tsx`
- `src/features/intake/RequestsBoardFilters.tsx`
- `src/features/intake/RequestProgressSummary.tsx`
- `src/platform/intake/requestSelectors.ts`
- `src/platform/intake/intakeStore.ts`, or the existing Wave 1 equivalent if it lands under a different file name.

State shape requirements:

- Store one row per request, not one row per onboarding.
- Every row needs `request_id`, `matter_id`, `kind`, `blueprint_ref`, request title or slug, item states, missing item ids, last client activity, link status, nudge state, and anomaly chips.
- Onboarding is a filter over `kind: 'onboarding'`, with active onboarding pinned first on the per-client Requests tab.
- Standing requests use `kind: 'standing'` and the same completion, nudge, link lifecycle, provenance, and filing rules.

Navigation requirements:

- Add a top-level Requests view inside the clients surface, or add a mode to `MattersSurfaceMode` if it needs to sit beside "Client Map" and "All clients".
- Preserve the direct client hub route. A board row opens the correct client with `ClientMapHubTab` set to `requests`.
- Keep the existing Onboarding view as a saved filter, not a separate store.

Board tests:

- A client with active onboarding and a standing request shows two request rows without merging their progress.
- The Onboarding filter shows only `kind: 'onboarding'`.
- The all-requests view sorts by "needs advisor" first, then stalled, then in-progress, matching Product Design section 1a.
- Completing a standing request files returned artifacts under its own `Requests/<request-slug>/` folder and does not move onboarding files.

## Blueprint Concept Spec

A blueprint is a reusable request recipe. It answers "what should we ask for?" before there is a client link.

Blueprint properties:

- It contains `RequestItem[]`, using the same item contract as a real `FormRequest`.
- It has a stable `blueprint_id` so completed requests can explain where they came from.
- It has a `default_kind`, usually `'standing'`. The built-in New household blueprint defaults to `'onboarding'`.
- It can be copied into a new request and edited per client without mutating the original blueprint.
- It is safe to store in normal app state because it contains labels, help text, and item structure only.

Instantiation rules:

- Create a new `request_id`.
- Copy the blueprint items and validate unique `item_id` values within the request.
- Set `schema_version` to the current request schema version.
- Set `matter_id` from the open client.
- Set `kind` from the blueprint default, with the composer allowed to override to `'standing'` where appropriate.
- Set `blueprint_ref` to the source `blueprint_id`.
- Create the link and sealed checklist only after the advisor reviews the final request.

The first shipped blueprint is New household. It is the current onboarding template expressed as a blueprint, not a special hard-coded form. That makes onboarding the first use of the same primitive Wave 7 exposes for existing-client requests.

## Open Questions

- Should the per-client tab label become "Requests" immediately, with Onboarding as a pinned section inside it? Recommendation: yes. It matches the product direction and prevents a second tab rename.
- Are blueprints personal, workspace-wide, or firm-wide at first? Recommendation: workspace-wide local store first, with a future firm sync path when firm settings support shared templates.
- Should firm-saved blueprints be editable in Wave 7, or only duplicated from built-ins and archived? Recommendation: allow edit on firm-saved blueprints, keep built-ins read-only.
- Should standing requests use the same link expiry and nudge defaults as onboarding? Recommendation: yes, unless Jameson wants a different default for recurring paperwork.
- How should guided questions map to `ClientFact.kind`? Recommendation: add optional fact mapping to `GuidedQuestionRequestItem` instead of relying on `item_id`.
- Do document uploads need named slots for the first blueprint? Recommendation: add optional slots if the client page needs separate front and back checks for a license.
- Does the Requests board live as a new clients-surface mode or only inside the client hub? Recommendation: both. The board is the work queue, the client hub is the detail view.
- Should imported PDF maps appear in the blueprint picker before Wave 8? Recommendation: show a disabled source label only if needed, but do not let advisors create PDF blueprints until the PDF pipeline can complete them.
