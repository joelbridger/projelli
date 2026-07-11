# Wealthbox seeded re-probe, part 2 — UI-seeded populated shapes

**Scope:** fabricated Northcrest sandbox only. Every record named `DEMO` below is synthetic. The authenticated browser session was live. No password or API token is included here; API requests used `curl --config` with the local protected config.

## UI setup result

| Requested setup | What the live UI allowed | Result |
|---|---|---|
| Workflow template `DEMO Onboarding Reprobe`, three steps, then an in-progress workflow with step 1 complete | The signed-in **Workflows** screen displayed an explicit Basic-plan upsell: “Get on the Pro plan to automate your workflows and more.” It exposed only **Upgrade to Pro**, not template or workflow controls. No upgrade was attempted. | **BLOCKED BY PLAN.** No template, workflow, or workflow-step record was created. |
| Opportunity stage set | The Opportunities UI exposed the existing **Default Pipeline** and its built-in stages: Evaluation, Identify Decision Makers, Qualification, Needs Analysis, Review, Proposal, Lost, Won. It did not offer a new-stage control in this flow. | Used the existing **Evaluation** stage, without changing the stage setup. |
| Opportunity | Created **`DEMO Reprobe Opportunity`** on `Northcrest Reprobe Demo` with the default-pipeline Evaluation stage and a fabricated $12,345 Fee amount. | **CREATED.** |
| Contact custom-field definition | Workspace Settings → Customizations → Custom Fields allowed a Contact text field. | **CREATED** `DEMO Risk Band` (id `516938`). |
| Contact custom-field value | The contact editor exposed the new field. | **SET** `DEMO Medium` on `Northcrest Reprobe Demo` (id `67405677`). |

The UI briefly showed the custom-field label doubled while filling the form, but that same newly-created synthetic field was immediately corrected in the UI before the contact value was set. The final saved definition is exactly `DEMO Risk Band`.

## Paced API read probe

All list reads used `page=1&per_page=100`; requests were spaced by one second. There were no pagination cursors to redact in these seven responses.

| Endpoint | Exact observed populated shape / response | Verdict |
|---|---|---|
| `GET /v1/workflows` | `{"meta":{"total_count":0,"total_pages":0,"page":1},"workflows":[]}` | **READABLE collection, empty.** |
| `GET /v1/workflow_steps` | `{"meta":{"total_count":0,"total_pages":0,"page":1},"workflow_steps":[]}` | **READABLE collection, empty.** |
| `GET /v1/workflow_templates` | `{"meta":{"total_count":0,"total_pages":0,"page":1},"workflow_templates":[]}` | **READABLE collection, empty.** |
| `GET /v1/opportunities` | The collection contained exactly one record, the synthetic opportunity: `{"id":3431460,"updated_at":"2026-07-11 12:57 PM -0400","created_at":"2026-07-11 12:57 PM -0400","creator":391639,"visible_to":"Everyone","name":"DEMO Reprobe Opportunity","description":"","probability":50,"target_close":"2026-07-11 12:00 AM +0000","manager":391639,"next_step":"","stage":1169841,"amounts":[{"id":3587583,"amount":"$12,345","basis_points":null,"kind":"Fee"}],"custom_fields":[],"linked_to":[{"id":67405677,"type":"Contact","name":"Northcrest Reprobe Demo"}]}` | **PROVEN populated opportunity shape.** It has a numeric `stage` id and `linked_to` contact object. |
| `GET /v1/categories/opportunity_stage` | `{"meta":{"total_count":0,"total_pages":0,"page":1},"opportunity_stage":[]}` | **READABLE but incomplete for the built-in pipeline.** The UI's default stages exist and the opportunity uses stage id `1169841`, but this category endpoint did not provide their lookup rows. |
| `GET /v1/categories/custom_fields?document_type=Contact` | `{"meta":{"total_count":1,"total_pages":1,"page":1},"custom_fields":[{"name":"DEMO Risk Band","id":516938,"document_type":"Contact","field_type":"text_field","metadata":{},"options":[]}]}` | **PROVEN populated definition shape.** |
| `GET /v1/contacts/67405677` | The seeded contact returned the expected standard contact object plus `"custom_fields":[{"name":"DEMO Risk Band","id":516938,"field_type":"text_field","document_type":"Contact","metadata":{},"value":"DEMO Medium"}]`. Its populated identity fields were `id`, `updated_at`, `created_at`, `creator`, `visible_to`, `type`, `name`, `image`, `status`, `assigned_to`, `external_unique_id`, `first_name`, and `last_name`; it also returned the normal contact arrays/objects: `email_addresses`, `tags`, `contact_roles`, `household`, `occupation`, `drivers_license`, `phone_numbers`, `street_addresses`, and `websites`, plus the remaining optional profile/financial fields. | **PROVEN populated record-level custom-field-value shape.** The value is an inline object, not a bare id/value pair. |

## Open question #1 — open workflow current step/state

**Verdict: STILL-UNVERIFIED.**

`/workflows`, `/workflow_steps`, and `/workflow_templates` are readable collections, but every one is empty. The signed-in UI made the missing prerequisite explicit: this Basic-plan sandbox cannot create or start workflows without an upgrade. Therefore this run has no open instance from which to observe a current step, completed-step marker, active-step marker, or per-step status. Empty collections are not evidence that those fields are absent. Keep the guided manual re-creation fallback in design/05.

## Synthetic records for later cleanup

Created in this run:

- Opportunity `3431460` — `DEMO Reprobe Opportunity`, linked to contact `67405677`, Default Pipeline / Evaluation stage id `1169841`, $12,345 Fee.
- Contact custom-field definition `516938` — `DEMO Risk Band`, Contact text field.

Used and updated in this run, but created in part 1:

- Contact `67405677` — `Northcrest Reprobe Demo`; set `DEMO Risk Band` to `DEMO Medium`.

No workflow template, workflow instance, workflow step, or opportunity-stage definition was created. No existing non-DEMO record was changed or deleted.

## What this changes for design/05

- The importer can now model the exact populated opportunity payload, including `stage`, `amounts`, and the `linked_to` contact reference.
- It must **not** rely on `/categories/opportunity_stage` alone to translate default pipeline stages: that endpoint remained empty while a real opportunity carried the stage id. Preserve the raw stage id and flag a missing lookup label in the fidelity report unless another documented source supplies it.
- Custom-field import is now proven end-to-end: import registry definitions from `/categories/custom_fields?document_type=Contact`, then import the inline contact custom-field objects, including `name`, `id`, `field_type`, `document_type`, `metadata`, and `value`.
- Workflow-current-state fidelity remains a guided-manual-re-creation case. The plan gate is a sandbox limitation, not proof that a populated paid-plan workflow API lacks current-step data.
