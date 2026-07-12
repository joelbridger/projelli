# Wealthbox parity audit: can a six-person firm cancel?

**Answer: no.** The CRM Home and Clients areas are reachable from the app shell, and a small set of local records really do save in the desktop app. But the things a firm uses all day — complete contacts, tasks, pipeline, reports, timeline, email links, firm setup, and collaboration — are not yet a working connected CRM.

This is an audit of what is usable now, not of the frozen plan or type definitions. I traced every `REPLICATE` and `IMPROVE` row in the parity contract to a user-openable surface, then checked whether it reaches a real store or engine. A type, a Rust command with no user path, an empty handoff callback, a screen with fixed names/counts, or an import that only accepts a simulator does not count as built.

## How to read the result

- **BUILT**: a user can open it, use it, and its result reaches a real local store or existing live product surface.
- **PARTIAL**: part of the job works, but important information, persistence, connection, or daily-use behavior is missing.
- **MISSING**: there is no usable feature. This includes hard-coded example data and buttons with no connected action.

The screen contract is `design/04-screens-end-to-end.md`. The real entry points are `src/app/shell/AppSurfaceRouter.tsx`, `src/features/crm-home/CrmHome.tsx`, and `src/features/crm-clients/ClientsSurface.tsx`. Local CRM records use `src/platform/crm/liveRecords.ts` and the SQLCipher-backed Tauri commands in `src-tauri/src/commands/crm/core_commands.rs`.

## Parity table

| Wealthbox feature | 01 verdict | Actual state | Real implementation, if any | What a user can and cannot do today |
|---|---|---|---|---|
| Person contact record | REPLICATE | PARTIAL | `HouseholdRecordSurface.tsx`, `ClientsSurface.tsx` | Can add a name to one household. Cannot open a full person record or manage the contact fields Wealthbox stores. |
| Household record | REPLICATE | PARTIAL | `DirectorySurface.tsx`, `HouseholdRecordSurface.tsx`, `liveRecords.ts` | Can create, open, and locally save a basic household. Imported households are not fully shaped into the screen’s facts, people, accounts, or notes. |
| Household Titles | REPLICATE | PARTIAL | `HouseholdRecordSurface.tsx` `PersonEditor` | Can type a simple household relationship while adding a person. Cannot manage existing member titles as a first-class household tool. |
| Company / Trust contact types | REPLICATE | MISSING | `platform/crm/types/index.ts` only | The data contract names these types, but the add-person screen always creates a person. |
| Professional-relationship links | REPLICATE | PARTIAL | `HouseholdRecordSurface.tsx` | Can add an external person and type roles such as CPA. Cannot link one professional record across households or manage a real relationship graph. |
| Contact Roles | REPLICATE | PARTIAL | `HouseholdRecordSurface.tsx` `PersonEditor` | Can type comma-separated labels. There is no firm-managed role list, filtering, or durable separate contact record. |
| Ownership (advisor + service tier together) | IMPROVE | PARTIAL | `HouseholdEditor`, `HouseholdRecordSurface.tsx` | Can locally edit and see a household advisor and service-tier text together. There is no real firm-member list, validation, or multi-seat ownership model. |
| Multiple addresses, emails, and phones | REPLICATE | MISSING | `platform/crm/types/index.ts` only | The contract has shapes for them; no reachable editor or display exists. |
| Facts that roll up correctly | IMPROVE | MISSING | `platform/crm/types/index.ts`; read-only card in `HouseholdRecordSurface.tsx` | Existing fact-shaped data can render, but the Add Fact button has no default action and there is no fact save, history, roll-up, or computed view. |
| Custom fields | REPLICATE | PARTIAL | `RecordMetadataEditor.tsx`, `ClientsSurface.tsx` | Can edit values already present on one household and save them locally. Cannot create/manage field definitions in Firm; the Firm screen is fixed example copy. |
| Tags | REPLICATE | PARTIAL | `RecordMetadataEditor.tsx`, `ClientsSurface.tsx` | Can add/remove free-text tags on one household and save them locally. No firm tag management, cross-record tag use, or tag reporting exists. |
| Opinionated typed objects (accounts/service policy) | IMPROVE | PARTIAL | `AccountEditor`, `HouseholdRecordSurface.tsx` | Can save a basic account with a purpose inside a household. No service-policy editor or shared typed-object workflow is reachable. |
| Notes on a contact | REPLICATE | PARTIAL | `NoteEditor.tsx`, `ClientsSurface.tsx` | Can save an internal or client-facing note in the household’s local record. No author/time display, edit/history, person attachment, or firm-wide search exists. |
| Pinned notes / structured memory | IMPROVE | PARTIAL | `NoteEditor.tsx`, `AccountEditor` | A note can carry a pinned flag and accounts require a purpose. Pinned notes are not surfaced first, and facts/preferences cannot be created or maintained. |
| Better-than-keyword note search | IMPROVE | MISSING | `crm_fts` schema exists in `core_schema.rs` | There is no CRM search command or screen wired to the index; no semantic note search is reachable. |
| Note @-mentions / notify everybody | REPLICATE | PARTIAL | `NoteEditor.tsx` | A user can select displayed household members and see a proposed recipient list. Saving only persists mention IDs; it creates no notification. |
| Hard-walled internal versus client-facing notes | IMPROVE | PARTIAL | `NoteEditor.tsx`, `HouseholdRecordSurface.tsx` | Two audience lanes are visually separate and the selected audience saves locally. They are not immutable/audited at the store layer, and client-facing content is not connected to email or sharing. |
| Task record | REPLICATE | PARTIAL | `CrmHome.tsx`, `liveRecords.ts` | Can create/update a basic local task in Home. It is stored as firm-wide data, lacks description/context creation, and household Add Task has no wired default action. |
| Task assignee | REPLICATE | PARTIAL | `CrmHome.tsx` `TaskDetail` | Can choose from three hard-coded names and save the string. There is no actual firm directory, invitation, role, or availability data. |
| Task recurrence | REPLICATE | MISSING | — | No recurrence field, editor, scheduler, or generated future task exists. |
| Task priority | REPLICATE | MISSING | `CrmHome.tsx` displays a priority | Existing/default priority can display, but a user cannot set it in the task editor. |
| Keep information out of tasks | IMPROVE | MISSING | Account purpose is local-only | Facts/preferences/routing rules have no usable editor, so the alternative to task misuse is not available. |
| Tasks as a real change trail | REPLICATE | MISSING | Existing app audit is separate; `crm-home` has fixed activity text | Completing/editing a CRM task does not create or show the promised CRM activity history. |
| Unified tasks and workflow steps | REPLICATE | MISSING | Separate `Tasks` and `LiveWorkflows` screens | Workflow steps never appear in the task list or board. |
| Capacity-aware task triage | IMPROVE | MISSING | `CrmHome.tsx` | “6 of 21” and recent activity are hard-coded even with no records; no ranking engine or real rationale exists. |
| Workflow templates | REPLICATE | PARTIAL | `workflowLive.ts`, `CrmHome.tsx` | Can save one simple local template with title-only steps. No roles editor, due-date editor, schedule, outcomes, or full template management exists. |
| Starter workflow library | REPLICATE | MISSING | — | No seeded library or chooser exists. |
| Open workflow instances | REPLICATE | PARTIAL | `workflowLive.ts`, `CrmHome.tsx` | Can start a locally saved instance and mark/edit a step locally. No owner assignment, due dates, comments, outcomes, completion state for the whole workflow, or cross-user use exists. |
| Scheduled workflows | REPLICATE | MISSING | — | No schedule editor or scheduler runs workflows later. |
| Workflow outcomes (branch/restart/complete) | REPLICATE | MISSING | — | No outcome/branch/restart editor or runtime is reachable. |
| Coworker comments on workflow steps | REPLICATE | MISSING | — | No comment data or UI exists. |
| Template edits propagate to open workflows | IMPROVE | PARTIAL | `workflowLive.ts`, `platform/crm/propagation/` | The local screen can make a narrow rename-plus-add update, review each open local instance, apply it, and locally save it. It does not provide the complete template editor, durable activity/notification commit, or real concurrent multi-user flow required for the marquee promise. |
| Meeting-triggered workflow proposal | REPLICATE | MISSING | Existing meetings surface is separate | No CRM path turns meeting content into a reviewed workflow proposal. |
| Opportunity record | REPLICATE | MISSING | `platform/crm/types/index.ts`; `CrmHome.tsx` button only | The type exists; “New opportunity” does nothing. |
| Opportunity pipelines | REPLICATE | MISSING | `CrmHome.tsx` | The board shows fixed people, dollar amounts, and stages. No pipeline records load or save. |
| Opportunity stages | REPLICATE | MISSING | `CrmHome.tsx` | Pipeline settings are display-only fixed text; stages cannot be created, ordered, archived, or changed. |
| Launch workflow from opportunity stage | REPLICATE | MISSING | — | No trigger, proposal, or opportunity workflow link exists. |
| Calendar/events | REPLICATE | MISSING | Imported events are stored as generic `activity`; existing calendar is not mounted here | No CRM event editor, calendar view, client event link, or calendar sync path is usable. |
| Service-tier-aware scheduling link | IMPROVE | MISSING | `HouseholdRecordSurface.tsx` has an optional callback | A link could display only if injected into a household, but Firm cannot set it and the default screen supplies no open-link action. |
| Gmail/Outlook email sync and searchable client email | REPLICATE | PARTIAL | Existing `features/email/`; placeholder CRM Email tab | Email is an existing product surface, but the CRM Email tab only says it preserves that surface. Its button receives no action in the default CRM mount; there is no household-linked CRM email view/search. |
| Canned reports | REPLICATE | MISSING | `CrmHome.tsx` | Buttons select labels, then show fixed Henderson/Ortiz results and “1,284 sources”; no report queries run. |
| Dynamic/custom reports | REPLICATE | MISSING | `platform/crm/types/index.ts` has `SavedView` types | No filter builder, selected fields, report store, or results engine is reachable. |
| AI-built reports | IMPROVE | MISSING | `AskBar` is an uncontrolled input | No prompt submission, report construction, provenance, or result uses CRM data. |
| Client-neglect report | IMPROVE | MISSING | Fixed label only | “No contact in 6 months” is a button label, not a computed report. |
| Attention-versus-fee report | IMPROVE | MISSING | Fixed label only | It displays a fixed warning that fee data is missing; there is no fee/activity computation. |
| Contact activity stream / unified timeline | REPLICATE | MISSING | `HouseholdRecordSurface.tsx` placeholder tab; `ActivityEvent` types | Timeline says “No history yet” and has no aggregation or filtering. |
| Firm-wide activity/dashboard feed | REPLICATE | MISSING | `CrmHome.tsx` fixed text | Home’s recent activity is fixed example text, not activity events. |
| @-mentioning | REPLICATE | PARTIAL | `NoteEditor.tsx` | The note editor collects mention IDs, but no inbox or delivery exists. |
| Wealthbox-to-Lantern migration | REPLICATE | PARTIAL | `migration_commands.rs`, `CrmHome.tsx` | A reachable wizard imports from an HTTP simulator using a fabricated token and writes basic local records. It is not a real authenticated Wealthbox migration and does not map imported records into the usable household UI. |
| Native meeting capture in place of Jump | REPLICATE | PARTIAL | Existing meetings feature; CRM Meetings tab placeholder | Meetings exist elsewhere, but CRM does not show the real meeting history or turn it into facts/tasks/workflows. |
| Redtail migration | REPLICATE | MISSING | `src-tauri/.../redtail.rs` parser code | There is no reachable Redtail migration route or user setup. |
| Salesforce migration | REPLICATE | MISSING | `src-tauri/.../salesforce.rs` parser code | There is no reachable Salesforce migration route or user setup. |
| Outlook/Gmail integration | REPLICATE | PARTIAL | Existing `features/email/EmailWorkspace.tsx` | The product has email, but no working client CRM linking, email activity, or CRM search. |
| Keep internal color in CRM instead of Teams | IMPROVE | PARTIAL | `NoteEditor.tsx` | Separate local note lanes exist, but team notification/activity and complete client context do not, so it cannot replace a team chat habit. |
| Calendly replacement/link | IMPROVE | MISSING | Optional field/callback only | See scheduling-link row: no firm setup or working launch action. |
| Connected documents | REPLICATE | PARTIAL | Existing documents feature; CRM Documents tab placeholder | Documents exist in the app, but the CRM household Documents tab does not load or link household documents. |
| AI notetaker | REPLICATE | PARTIAL | Existing meetings feature | The existing feature is outside this CRM flow; no evidence shows a CRM-linked, firm-template note path. |
| AI monitoring/flagging (not autonomous action) | IMPROVE | MISSING | — | No monitoring or triage calculation exists. |
| AI playbooks | REPLICATE | MISSING | Basic local workflow templates only | No AI-triggered, approval-gated playbook flow exists. |
| CRM-aware AI Assistant | REPLICATE | MISSING | `CrmHome.tsx` `AskBar` | The text field has no submit, scope, citations, or CRM data bridge. |
| Member/Admin/Owner roles | REPLICATE | MISSING | `CrmHome.tsx` Firm display-only shell | It displays “Maya Patel · Owner”; no roles can be managed or enforced in CRM. |
| Teams | REPLICATE | MISSING | Imported directory records only; Firm shell | No team creation, membership, or use in assignments/visibility. |
| Groups/visibility restrictions | REPLICATE | MISSING | Sync/ACL-related platform code, no CRM surface | No CRM record-level visibility control can be set or seen by a user. |
| Default user permissions | REPLICATE | MISSING | — | No firm permission settings or enforcement path is reachable. |
| Guided migration with fidelity report | REPLICATE | PARTIAL | `migration_commands.rs`, `CrmHome.tsx` | The simulator path produces a visible count report and local checklists. It cannot connect to a real firm’s Wealthbox, does not make a real parallel run, and its checklists do not create the stated resulting workflow. |
| Data portability/export | REPLICATE | MISSING | `crm_migration_export` | “Export” only writes a status record with a simulator manifest ID; it produces no archive/rollback file or reconciliation output. |
| External unique ID for safe re-import | REPLICATE | PARTIAL | `migration_commands.rs` uses `kind:source_id` | The importer has a stable local source-shaped ID, but no visible external-ID field, source mapping screen, or proven parallel re-import behavior. |
| Wealthbox REST source/API connection | REPLICATE | PARTIAL | Existing connector commands; migration UI uses `fabricated-token` | Low-level connection/write code exists, but the cancellation path cannot authenticate a firm’s real account for migration. |
| Native push/webhook-style collaboration | IMPROVE | PARTIAL | `platform/crm/sync/`, `platform/crm/notify/` | Sync/notification building blocks exist, but no live multi-seat CRM setup, sharing proof, or user-reachable collaboration flow is present. |

## The cancel-Wealthbox checklist

### Would block cancellation

1. **Finish the real contact and household system.** A firm needs complete people, households, trusts/organizations, shared professionals, addresses, email/phone channels, owner, service tier, roles, tags, custom fields, and a working Client Map. Today this is only a small locally saved household card.
2. **Make the migration real.** Accept a real Wealthbox connection, import a firm’s real records with relationships and field mapping, preserve external IDs, show usable records after import, and produce a trustworthy fidelity report. The current screen is explicitly a simulator using a fabricated token.
3. **Build daily tasks.** Add description, linked household, due date, priority, assignee from real firm members, recurrence, complete/reopen, and a real all-work list. Include workflow steps in the same daily work view.
4. **Build real notes, facts, and the client history.** Notes need author/time, pinning, search, mentions/notification, and durable internal/client-facing boundaries. Facts need a real create/edit/history flow. Then combine notes, email, meetings, tasks, facts, workflows, and account changes into a household timeline and firm activity feed.
5. **Connect email and calendar to each household.** Existing email must actually appear, search, and be linked in the CRM; the CRM Email button must open the right household context. Calendar/events and scheduling links need a working user path.
6. **Build opportunities and pipeline.** A six-person firm cannot replace Wealthbox if prospects, amounts, owners, stages, pipeline settings, and stage-triggered workflow proposals are demo cards.
7. **Complete workflows as a daily operating tool.** Keep the locally working propagation kernel, but add templates with roles/dates/recurrence/outcomes, starter templates, assignments, comments, full instance lifecycle, meeting/opportunity proposals, and activity. Then prove propagation and conflict behavior across more than one seat.
8. **Build saved views and reports.** Task/household/pipeline filters and saved views need persistence. Reports need to query real data, not show fixed rows: neglected clients, attention versus fee, birthdays/age/RMD/review due, plus a safe custom report builder.
9. **Make collaboration real for six people.** Add firm member setup, roles, teams, visibility restrictions, notifications, assignment, and actual device-to-device CRM sync. The current notification panel is fixed sample text.
10. **Prove a complete first-week path.** A firm must be able to import, find any client, read the actual email/meeting/note history, make a task or workflow, assign it, review work tomorrow, and work from two seats without losing or leaking data.

### Would annoy, but would not alone stop a switch

- A polished Client Map layout, clear first-use/empty/offline states, and real freshness dates instead of generic badges.
- A starter workflow library and richer template editor.
- A real firm-level fields/tags manager instead of one-record editing.
- Scheduling-link setup and a working launch action.
- Account-purpose/fact roll-ups and a better way to find structured standing instructions.
- Document links inside a household record.
- Export files and clear migration support details, after the primary migration itself is trustworthy.

## Top 10 gaps to close, in order

1. **Real Wealthbox migration and record mapping** — a firm cannot even begin the switch without it.
2. **Complete people, households, relationships, and client map** — this is the system of record.
3. **Tasks with household links, recurrence, priority, real assignees, and workflow-step unification** — this is the daily-driver replacement.
4. **Unified household timeline: notes, facts, activities, meetings, and durable internal context** — this is what prevents staff from hunting through Wealthbox and Teams.
5. **Household-linked email and calendar** — clients’ communication history must be where staff expect it.
6. **Workflow completion beyond the propagation kernel** — templates, owners, dates, comments, outcomes, starter library, and proposals.
7. **Real multi-seat firm setup and collaboration** — members, roles, teams, restrictions, sync, notifications, and assignments.
8. **Opportunities and editable pipelines** — prospects cannot be run from fixed sample columns.
9. **Real saved views and reports** — especially neglected-client and attention-versus-fee views from actual data.
10. **Hardening the migration/cutover proof** — fidelity worklists that create real resulting records, actual archive/rollback files, and a full two-seat first-week test.

## Bottom line

The project has useful foundations: encrypted local CRM collection storage, an app-mounted Home/Clients shell, basic local household/note/tag/account saves, a locally functional workflow-propagation demonstration, existing email/meeting/document products, and substantial importer/sync code. Those are ingredients, not a replacement.

For a six-person RIA today, cancelling Wealthbox would remove the only usable place to keep complete contacts, see client communication/history, assign recurring work, run a prospect pipeline, report on the firm, migrate confidently, and collaborate. Do not position this as cancellable parity until the block-cancellation list is complete and exercised with real firm-shaped data from two seats.
