# Wealthbox seeded re-probe — populated-record evidence

**Scope:** fabricated Northcrest sandbox only. All records named below are synthetic.
This re-probe used the API token only through `curl --config`; no token, password, or
other credential is included here.

| Target | Seed / exact status and observed shape | Verdict |
|---|---|---|
| Workflow template setup | `GET /workflow_templates?page=1&per_page=100` → **200**: `{"meta":{"total_count":0,"total_pages":0,"page":1},"workflow_templates":[]}`. The public API documents no template-creation endpoint. The signed-in browser window instead showed the login screen, so the UI setup could not be reached without entering a password (not attempted). | **STILL-UNVERIFIED.** No synthetic template could be created in this run. |
| Workflow instance | `POST /workflows` with the fake Northcrest contact and template id `1` → **422**: `{"errors":["Please include a valid Workflow Template id in your request."]}`. `GET /workflows?page=1&per_page=100` → **200** with an empty `workflows` array. | **STILL-UNVERIFIED.** The endpoint is reachable, but no valid template exists from which to start an instance. |
| Workflow steps / advance | `GET /workflow_steps?page=1&per_page=100` → **200**: `{"meta":{"total_count":0,"total_pages":0,"page":1},"workflow_steps":[]}`. No instance existed, so no step could be completed or advanced. | **STILL-UNVERIFIED.** No populated per-instance step status was available. |
| Open question #1 — current workflow state | No populated workflow or workflow-step record could be read. `/workflow_instances` remains absent from the first probe; this run could not create the prerequisite template. | **DOES NOT SETTLE open question #1.** Keep the guided manual re-creation fallback; the API shape for an open workflow's current step/state is still unproven. |
| Opportunity stages | `GET /categories/opportunity_stage?page=1&per_page=100` → **200**: `{"meta":{"total_count":0,"total_pages":0,"page":1},"opportunity_stage":[]}`. A synthetic `POST /categories/opportunity_stage` returned **404**, empty body. | **STILL-UNVERIFIED.** The readable category collection is empty, and its creation path is not exposed here. |
| Opportunities | Synthetic `POST /opportunities` with the fake contact, a fake AUM amount, and `stage: 1` → **422**: `{"errors":["Opportunity stage is not valid"]}`; no opportunity was created. `GET /opportunities?page=1&per_page=100` → **200**: empty `opportunities` array. | **STILL-UNVERIFIED.** An opportunity requires a valid stage, so populated shape and stage reference could not be proven. |
| Projects | Created one synthetic project. `GET /projects?page=1&per_page=100` → **200** with `projects:[{"id":411738,"creator":391639,"created_at":"…","updated_at":"…","name":"DEMO Northcrest onboarding project","description":"DEMO workflow — onboarding; fabricated sandbox record only.","organizer":null,"visible_to":"Everyone","image":"https://cdn.crmworkspace.com/…/project.png","custom_fields":[]}]`. | **PROVEN populated shape.** A project exposes id, creator, timestamps, name, description, organizer, visibility, image, and `custom_fields`. |
| Project-to-contact link | A `PUT /projects/411738` that included `linked_to:[{"id":67405677,"type":"Contact","name":"Northcrest Reprobe Demo"}]` returned **200**, but both that response and `GET /projects/411738` omitted `linked_to`. The documented project request shape also has no contact-link field. | **PROVEN absent from this API shape.** The supplied link was not persisted or returned; do not assume Projects carry a direct contact link. |
| Contact custom-field registry | The documented registry address, `GET /categories/custom_fields?document_type=Contact&page=1&per_page=100`, returned **200**: `{"custom_fields":[],"meta":{"total_count":0,"total_pages":0,"page":1}}`. `GET /custom_fields`, `/contact_custom_fields`, and `/custom_field_definitions` each returned **404**, empty body. | **PROVEN readable registry address, but STILL-UNVERIFIED populated definition shape.** No definition exists in this sandbox. |
| Contact custom-field value | Created a new fake contact, then attempted `PUT /contacts/67405677` with `custom_fields:[{"id":1,"value":"DEMO workflow — onboarding"}]` → **422**: `{"errors":["One of the custom fields you are attempting to set could not be found, please check the \"id\" field again for each custom field"]}`. `GET /contacts/67405677` → **200** with `custom_fields:[]` (and `id,creator,created_at,updated_at,name,first_name,last_name,type,assigned_to,external_unique_id,tags,household`). | **STILL-UNVERIFIED.** The API correctly rejects a value without a real field definition; no populated record-level value shape was created. |
| Plan gating / upsell | `GET /me` reports the sandbox plan as `basic`. All readable targets above returned **200**; dependent writes returned validation **422**; the category-creation attempt returned **404**. No request returned **402** or **403**. The browser session was unauthenticated, so no in-app upsell screen was encountered. | **NOT PROVEN.** Basic-plan status is an observation, not evidence that these capabilities are tier-gated. |

## Synthetic records created

- **Contact `67405677`** — `Northcrest Reprobe Demo` (Person), external id
  `northcrest-seeded-reprobe-20260711`.
- **Project `411738`** — `DEMO Northcrest onboarding project`, description
  `DEMO workflow — onboarding; fabricated sandbox record only.`

No workflow template, workflow, workflow step, opportunity stage, opportunity, or custom
field definition/value was created. The unsuccessful create/update attempts above produced
only the stated validation or not-found responses. Existing seeded contacts, notes, and tasks
were not changed or deleted.

## What this changes

- The project importer can now model the proven populated project fields above, but must not
  infer a direct Project-to-Contact relationship from this endpoint.
- The workflow, opportunity/stage, and populated custom-field portions of the migration
  design remain unproven. The missing prerequisite setup is a sandbox limitation in this
  run—not evidence that the read endpoints themselves are unavailable.
