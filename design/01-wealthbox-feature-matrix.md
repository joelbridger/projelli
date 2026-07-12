# 01 — Wealthbox feature matrix

Conforms to 00-master-spec decisions D1–D25 (reconciled 2026-07-11).

*Design lane A, LANTERN-CRM program. Compiled 2026-07-11. Sources: wealthbox.com
(features/pricing/integrations/API pages), help.wealthbox.com (help center articles,
accessed via search — the direct category-page fetch 403'd, so titles below are
reconstructed from indexed help-article titles, flagged where relevant), dev.wealthbox.com
(API resource list), 2025-2026 press releases (PRNewswire, InvestmentNews) for the AI
suite. All facts dated at the point cited; anything not independently confirmed is marked
**UNVERIFIED**.*

*Cross-checked against `~/lantern-plus/user-research/01-evidence-ledger.md` (the JBW
interview, E-### items) for real-firm usage, and against
`~/lantern-plus/user-research/analysis-drafts/crm-core-feasibility.md` for what our own
Wealthbox read/write connector already proves about the API surface.*

*Verdicts follow the charter's pre-made decisions: no mobile app; firms of ≤10 seats;
E2EE relay that can never read content server-side; AI proposes, a present human approves
every external write; light theme; `matter`/`matter_id` never renamed.*

---

## How to read this

- **Pricing tier**: the cheapest Wealthbox plan (of Basic $59, Pro $75, Premier $99,
  Enterprise custom — per user/month, monthly billing; ~40% cheaper billed annually) where
  the feature is available, or "add-on" if it costs extra on top of any plan.
- **API surface**: whether Wealthbox's public REST API (`api.crmworkspace.com`, OAuth2 or
  token auth, docs at dev.wealthbox.com) exposes the feature for **R**ead, **W**rite, or
  **None**. Verified against dev.wealthbox.com's resource list plus what our own connector
  (`src-tauri/src/commands/crm/`) already proves works live: it reads contacts, households,
  notes, tasks, events with pagination, and writes notes, tasks, and one contact field
  (`background_information`) only.
- **JBW evidence**: the E-### item(s) from the evidence ledger where JBW (the researched
  real-firm user) actually uses, avoids, or complains about the feature, or "not mentioned"
  if the interview never touched it.
- **Verdict**: **REPLICATE** (build to parity) · **IMPROVE** (build it, but name the one
  thing we do differently) · **SKIP** (with reason — mobile app, dialer/phone infra, and
  enterprise/org-scale features are the charter's named exclusions).

---

## 1. Contacts, households & relationships

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| Person contact record | Core person entity: name, dates (birth/anniversary/retirement/death), marital status, employer, investment profile (objective/horizon/risk tolerance), income/assets/liabilities/tax bracket, addresses, emails, phones | Basic | R/W (create/edit) | E-085 — "is that my client or Seattle's" | REPLICATE |
| Household record | Groups related people (family at one address) under a shared record with shared notes/activity/financial view | Basic | R (create via type=household) | E-085, E-073 | REPLICATE |
| Household Titles | Labels each member's role in the household ("Head," "Spouse," "Child," "Other Dependent") | Basic | R | not mentioned | REPLICATE |
| Company / Trust contact types | Two more contact "types" beyond person/household for entities | Basic | R | not mentioned | REPLICATE |
| Professional-relationship links | Pointers from a client to their attorney/CPA/doctor/trusted contact (as other contact records) | Basic | R | not mentioned (E-095 region touches verified-recipient links for external parties) | REPLICATE |
| Contact Roles | Tag a contact's role relative to the firm (client, prospect, COI, vendor…); Basic=3 roles, Premier=unlimited | Basic (3 roles) / Premier (unlimited) | R | not mentioned | REPLICATE |
| "Ownership" (whose client is this) | Primary-advisor/owner assignment on a contact, used for territory and scheduling | Basic | R | E-085 — "is that my client or Seattle's" is asked from memory + Wealthbox, not answered cleanly by the system | IMPROVE — surface owner + service tier together on one glanceable record instead of tribal knowledge |
| Multiple addresses/emails/phones per contact | Arrays of street addresses, emails, phone numbers with labels | Basic | R | not mentioned | REPLICATE |
| Tags vs. custom fields not inherited household↔person | Explicitly, by Wealthbox design, tags/custom fields on a person do NOT roll up to the household and vice versa | Basic | R | not mentioned directly, but E-073's "account map" wish implies the opposite need | IMPROVE — the data model's `Fact` (dated claim + source) attaches at the right level and computed views roll up automatically; this is a named Wealthbox gap we fix |

## 2. Custom fields, tags & custom objects

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| Custom fields | Firm-defined structured fields on People/Households/Companies/Trusts, visualizable in charts/dashboards on Premier | Basic (basic use) / Premier (dashboard viz) | R only (per dev.wealthbox.com) | not mentioned | REPLICATE |
| Tags | Freeform descriptive labels on any contact for fast filtering/grouping | Basic | R only | not mentioned | REPLICATE |
| Custom Objects | New in 2025-2026: firm defines entirely new record types (insurance policies, trusts, estate plans, service requests) with up to 200 fields/object and up to 2M records on Premier | Basic (1 object type, 25 fields, 20K records) → Premier (20 types, 200 fields, 2M records) → Enterprise (unlimited) | UNVERIFIED (not in the API resource list we could confirm) | not mentioned | IMPROVE — build a small, opinionated set of typed entities (Account with purpose, ServicePolicy) from the evidence instead of an open-ended object builder; revisit generic custom objects only if a pilot firm asks |

## 3. Notes

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| Notes on a contact | Freeform text notes attached to a person/household/company, timestamped, author-tracked | Basic | R/W (our connector already creates notes) | E-003, E-030 (Jump-pushed notes); E-020/291 (email is separate and unsearchable, notes are the searchable channel) | REPLICATE |
| Pinned notes | Pin a note to stay at the top of the activity stream instead of scrolling off | Basic | UNVERIFIED (no dedicated API field confirmed) | E-073 — "pinned to the top so it can't disappear... do not forget this is their rental account" — a direct workaround for missing structured account-purpose data | IMPROVE — give account purpose, standing preferences, and "do not forget" facts a first-class typed home (the Client Map's dated `Fact`) instead of relying on a note staying pinned; keep pinning too, for genuinely freeform memory |
| Note search (keyword only) | Notes are searchable, but only by exact keyword match — no synonym/semantic search | Basic | R | E-024 (implied) — "if you said retirement account... and later search 401k... it won't pop up" | IMPROVE — this is the named, quoted defect; semantic/RAG search over notes is a direct fix |
| Note @-mentions / notify-everybody | Posting a note can @-mention a person or notify the whole team | Basic | R (comments R only) | E-021 — "leave a note in Wealthbox and just notify everybody" | REPLICATE — as an approval-visible team notification, not a silent blast |
| "Inside scoop" / internal-only color | Not a distinct Wealthbox feature — but JBW wants notes that are internal-only and stay searchable, separate from what's sent to a client | Basic | R/W | E-737 region ("the human story, we need the inside scoop too"), E-050 (internal vs client-facing lanes) | IMPROVE — this is the marquee "two audiences, hard-walled" design principle (charter §4.5); Wealthbox has no visual internal/client-facing split, we do |

## 4. Tasks

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| Task record | To-do with due date, complete flag, priority, description, linked contact | Basic | R/W (our connector already creates tasks; Wealthbox requires a due date on every task) | E-049, E-075 — "tasks are like sticky notes... checkable, recurring" | REPLICATE |
| Task assignee | Assign a task to a specific team member | Basic | UNVERIFIED whether writable via API (our connector's `CrmTask` model has no assignee field today) | E-708 — "I'll assign a task to Philip" | REPLICATE |
| Task recurrence | Tasks can repeat on a schedule | Basic | UNVERIFIED (our connector's model has no recurrence field) | E-075 — "they can be recurring" | REPLICATE |
| Task priority | Priority flag on a task | Basic | R (present in our connector's model) | not mentioned directly | REPLICATE |
| Tasks used as information storage | Not a designed feature — a JBW workaround: standing facts (money-movement routing rules) get stored as tasks because there's no better container | n/a | n/a | E-074 — gifting/routing rules "kept in tasks... it's not a task, it's information"; E-076 — wrong-account error traced to this overload | IMPROVE — this is the charter's design principle "information is not a task" (§4.7): give routing rules, account purposes, and preferences a typed `Fact` home so tasks go back to being just actions |
| Tasks as an audit trail for plan changes | JBW logs a Wealthbox task every time a client's financial plan changes, as their de facto change log | Basic | R/W | E-679 — "he gets a task in Wealthbox anytime he needs to change anything about a client plan" | REPLICATE — but make the activity feed (hash-chained, already built for audit) the actual change log, with tasks staying action-only |
| Unified Tasks & Workflow Steps | 2025-2026 Wealthbox change merging plain tasks and workflow-step tasks into one unified task list/view | Basic | R/W | not mentioned | REPLICATE |
| Capacity-aware / judgment-aware task triage | Not a Wealthbox feature — Wealthbox tasks are a flat list with no capacity or context awareness | n/a | n/a | E-119, E-122 — "6 of 21 realistic today," dumb red overdue list | IMPROVE — the charter's "Practice Home" design principle (§4.3): tasks carry judgment, capacity, and meeting-proximity context, not just a deadline |

## 5. Workflows, templates & steps

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| Workflow templates | Named, editable sequential-step or checklist processes, startable on a Contact, Opportunity, or Project | Basic | R (templates), W (steps only) | E-092, E-093 — advisors can't always find/name the right template, causing ad-hoc rework | REPLICATE |
| Wealthbox Library of Workflows | 10 pre-built templates for common processes (lead gen, onboarding, trade requests, life events) | Basic | R | not mentioned | REPLICATE — seed Lantern with a small starter library too |
| Workflow instances (open workflows) | A started workflow tracks steps/owners/progress against its template | Basic | No v1 migration path for current state; see [05 §2.5a](05-migration-importer.md#25a-open-workflow-instances-guided-re-creation-at-cutover) | E-098, E-099 — JBW runs ~40 open post-meeting workflows at a time | REPLICATE — Lantern owns new workflow instances. Wealthbox open-instance state is not API-readable in v1, so cutover uses the guided manual re-creation fallback in [05 §2.5a](05-migration-importer.md#25a-open-workflow-instances-guided-re-creation-at-cutover). |
| Scheduled workflows | A workflow can be scheduled to auto-start on a future date/time | Basic | UNVERIFIED | not mentioned | REPLICATE — `WorkflowTemplate.schedule` is the canonical contract in [02 §1.7](02-data-model.md#17-workflowtemplate-versioned); its editor lives in [04 §6 Templates](04-screens-end-to-end.md#6-home--workflows). |
| Workflow outcomes (branch/restart/complete) | A step can branch to another step, restart on a date, or the whole workflow can be completed/restarted | Basic | UNVERIFIED | not mentioned | REPLICATE — `StepDef.outcomes` is the canonical contract in [02 §1.7](02-data-model.md#17-workflowtemplate-versioned); its editor lives in [04 §6 Templates](04-screens-end-to-end.md#6-home--workflows). |
| Coworker commenting on workflow steps | Team members can comment on an in-progress workflow step | Basic | R (comments) | not mentioned | REPLICATE |
| Contact Actions in Opportunity Workflows | A 2026 addition letting a workflow trigger contact-level actions from within an opportunity workflow | Basic | UNVERIFIED | not mentioned | REPLICATE — reinstated 2026-07-12 (D23 exclusion overridden by the acceptance bar). |
| **Template-edit propagation to open instances** | **Does NOT exist in Wealthbox.** Editing a template never updates already-open (in-flight) workflow instances | n/a | n/a | E-098 — "if you change the template it doesn't change any of the open workflows"; E-099 — "you've got 40 open that don't say remember to do this" | **IMPROVE — this is the charter's marquee, named "only we do this" feature** (§ pre-made decision 6): editing a template offers a reviewed, diffable update to every open instance. Highest design/correctness priority in the whole program. |
| Jump → Wealthbox workflow trigger | Jump can detect "let's open an account" in a meeting and offer to launch the matching Wealthbox workflow | n/a (Jump feature, Wealthbox is the target) | n/a | E-450 — "I think you can do that but we just haven't" (feature exists, unused — friction/adoption gap) | REPLICATE — as an AI-proposed workflow launch from meeting content, with the same friction fix (see AI suite) |

## 6. Opportunities & pipelines

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| Opportunity record | Tracks a potential engagement (annuity, retirement plan, 401k) with AUM/commission/fee fields | Basic | R/W | not mentioned | REPLICATE — `Opportunity` remains a first-class CRM entity under D9 |
| Opportunity pipelines | Customizable stage sequences to move an opportunity through; count gated by plan (Basic=1, Pro=3, Premier=5, Enterprise=unlimited) | Basic (1 pipeline) → Premier (5) | R/W | not mentioned | REPLICATE — `PipelineDef`, `StageDef`, and stage-trigger rules are canonical in [02 §1.14](02-data-model.md#114-opportunity-pipeline); create/edit/order configuration lives in [04 §8 Pipeline settings](04-screens-end-to-end.md#8-home--pipeline). Do not plan-gate a small firm's pipelines. |
| Opportunity stages | Customizable named stages within a pipeline | Basic | R/W | not mentioned | REPLICATE — first-class `StageDef` records in [02 §1.14](02-data-model.md#114-opportunity-pipeline), configured in [04 §8 Pipeline settings](04-screens-end-to-end.md#8-home--pipeline). |
| Launch workflow from new opportunity | An opportunity entering a stage/pipeline can auto-start a workflow | Basic | R/W | not mentioned | REPLICATE — `StageTriggerRule` is canonical in [02 §1.14](02-data-model.md#114-opportunity-pipeline), configured in [04 §8 Pipeline settings](04-screens-end-to-end.md#8-home--pipeline). |

## 7. Projects

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| Project record | Lightweight project-management container (notes, tasks, events) for admin initiatives or complex multi-phase financial-planning engagements | Basic | R/W | not mentioned directly (JBW's "planning-update" workflow stage implies similar multi-step planning work, but never names "Projects") | REPLICATE — reinstated 2026-07-12. A first-class lightweight project container, so imported Wealthbox Projects land as real records rather than read-only legacy rows. |

## 8. Calendar & events

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| Calendar / events | Event records (meetings, appointments) linked to contacts, with two-way sync to Google/Outlook/Apple calendars | Basic | R/W | E-109 region — "exists, unused at JBW" | REPLICATE — build it, but don't over-invest; JBW's own usage shows this is a commodity feature they don't lean on, Lantern's meetings capture already covers the real workflow |
| Calendly integration for scheduling links | Calendar-scheduling integration is a named partner app, not native | Basic | n/a (partner integration) | E-085 — "which Calendly link" is a real scheduling pain point (service-tier-aware link selection) | IMPROVE — `ServicePolicy.schedulingLinkUrl` is the canonical field in [02 §1.9](02-data-model.md#19-servicepolicy); Firm setup and household scheduling actions expose it in [04 §§3 and 13](04-screens-end-to-end.md#3-clients--household-record). The provider integration remains owned by the existing connector under [D23](00-master-spec.md), not a new CRM integration. |

## 9. Email

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| Email sync (Gmail/Outlook) | Two-way sync that pulls sent/received email into a contact's Email tab | Basic (limited) / Pro+ (fuller) | UNVERIFIED (not in confirmed API resource list) | E-020, E-291 — "you cannot keyword-search email content" is a named, direct pain point | REPLICATE — and fix the named defect: full-text + semantic search over synced email, which Lantern's existing email connector + RAG stack already does better |
| BCC Email Dropbox | A unique per-user email address; BCC or forward any email to it and Wealthbox tries to match it to a contact, permanently storing it even if deleted from the original inbox or sync disconnects | Basic | n/a (SMTP-level feature, not API) | not mentioned directly, but matches JBW's manual copy-paste-with-labeling habit (E-009) | IMPROVE — reinstated 2026-07-12. Capture happens CLIENT-SIDE through the existing email connector, so no plaintext ever reaches a server; that keeps the E2EE charter intact and still gives advisors the drop-an-email-in habit. |
| Emails land in Activity Stream, not the Email tab, for dropbox items | A quirk: BCC-dropped emails show only in the activity stream, not threaded, not on the Email tab | Basic | n/a | not mentioned | SKIP as designed — this is a Wealthbox limitation (no threading), not a feature worth copying; our email connector already threads properly |
| Email broadcast | Send a one-to-many email blast to a filtered contact list from inside the CRM | Basic | UNVERIFIED | not mentioned | REPLICATE — reinstated 2026-07-12. A small-firm one-to-many send to a filtered client list, approval-visible; not a marketing blast engine. |

## 10. Reports

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| Automated/canned reports | Pre-built static reports: over-age-65, upcoming birthdays, etc. | Basic | R | E-129 — "fairly limited... age 65, birthday next month" | REPLICATE |
| Dynamic/custom reports | Build a filtered, customized report with chosen fields | Pro | R | not mentioned | REPLICATE |
| AI for Reports (prompt-built reports) | Describe the report you want in a prompt; Wealthbox generates filters, fields, charts automatically | Premier | UNVERIFIED (announced feature, no confirmed API path) | E-129, E-124 — "where's your time going, what is most needy" — exactly the class of question canned reports can't answer | IMPROVE — this is a direct, named gap; computed-on-demand reports stamped "computed just now from N sources" (charter §5.2) both answer the AI-prompt case and add the provenance/freshness Wealthbox reports lack |
| Client-neglect / no-recent-interaction report | "Who hasn't interacted with us in 6 months" — not a canned Wealthbox report | n/a | n/a | E-088 — explicitly wished for, doesn't exist today | IMPROVE — build this; it's requested, absent, and computable from the unified timeline |
| Attention-vs-fee report | "Who's consuming the most attention vs. the fee they pay" | n/a | n/a | E-124 | IMPROVE — same as above, a named gap to fill |

## 11. Activity streams, @mentions & comments

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| Contact activity stream | Chronological feed of everything on a contact (notes, tasks, events, emails) | Basic | R | E-100 — "your lives are really in Wealthbox tasks, workflows... and email" | REPLICATE — becomes the unified, dated, sourced timeline (charter §5.2) |
| Firm-wide activity/dashboard feed | A home-page feed of firm activity across contacts | Basic | R | not mentioned | REPLICATE |
| @-mentioning | Type "@" + a contact name from the publisher box to post a note about them without navigating to their record | Basic | UNVERIFIED | not mentioned directly (matches E-021's "notify everybody" pattern) | REPLICATE |
| Comments on activity | Reply to an activity-stream item; visibility can be set to "everyone" | Basic | R only | not mentioned | REPLICATE — reinstated 2026-07-12 (D23 exclusion overridden by the acceptance bar). |
| Likes/emoji activity reactions | React to an activity-stream item | Basic | R only | not mentioned | REPLICATE — reinstated 2026-07-12 (D23 exclusion overridden by the acceptance bar). |

## 12. Document storage

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| File storage on records | Attach files to contacts/notes/tasks; storage cap by plan (Basic 2GB → Premier 10GB → Enterprise 20GB) | Basic | No v1 API migration path: tested attachment/file/document reads were absent; see [05 §2.5b](05-migration-importer.md#25b-files-and-attachments-operator-export-plus-client-level-gap-flags) | not mentioned directly (E-132/E-841 region touches documents workflow generally) | REPLICATE — reinstated 2026-07-12 (Jameson: the app must do EVERYTHING Wealthbox can). CRM records get first-class attachments that link into the existing Documents subsystem; no parallel file store. |

## 13. Integrations directory (top ~15 of 150+)

| Integration | Category | JBW evidence | Verdict |
|---|---|---|---|
| Wealthbox itself (as a CRM to migrate FROM) | — | — | REPLICATE via the migration importer (design/05) |
| Jump.ai | AI notetaker / meeting layer | E-003 through E-100, extensively — JBW's actual daily driver | REPLICATE — Lantern's own meetings capture already fills this role natively, no external dependency |
| RightCapital | Financial planning | E-029 region (screenshotted into PowerPoint, not exported) | SKIP for v1 — read-only reference integration later if a pilot firm needs it; not a system-of-record feature |
| Charles Schwab | Custodian | E-076 (account confusion happened here) | SKIP — custodial data feeds are a distinct, much larger integration project; out of scope for the CRM-replacement design phase |
| DocuSign | E-signature | E-090 region — named as a trust-building integration | SKIP for v1 — D9 assigns DocuSign tracking to the existing connector rather than a new CRM feature |
| JotForm | Intake forms | E-087 — used heavily for new-client and cashflow intake | SKIP as an external integration — Lantern's responsive intake-link flow is the v1 replacement: link creation, public responsive form, then submission matching/review in [04 §14](04-screens-end-to-end.md#14-existing-surfaces-write-crm-data). |
| Redtail | Competing CRM | market-share leader (crm-market-research.md §2) | REPLICATE via migration importer only (a second migration source, not a live integration) |
| Salesforce | Competing CRM / enterprise | E-105 — named as a trust signal ("big names") | REPLICATE via migration importer only |
| Microsoft Outlook / Gmail | Email & calendar | E-020, E-291 (email pain), E-109 (calendar) | REPLICATE — already shipping in Lantern (email connector) |
| Microsoft Teams | Team chat | E-021, E-307 — where the "real color" actually lives today | IMPROVE — don't integrate Teams; make the CRM itself good enough at internal color that the leak stops (see §3 "inside scoop") |
| Calendly | Scheduling | E-085 (service-tier-aware link problem) | IMPROVE — v1 exposes the service-tier-aware `ServicePolicy.schedulingLinkUrl` in [02 §1.9](02-data-model.md#19-servicepolicy) through Firm setup and household scheduling actions in [04 §§3 and 13](04-screens-end-to-end.md#3-clients--household-record); the provider integration remains the existing connector's job under [D23](00-master-spec.md). |
| AdvicePay | Billing | not mentioned | SKIP for v1 — no evidence of use; revisit if a pilot firm needs it |
| Orion / Black Diamond / Tamarac / Addepar | Portfolio management | not mentioned | SKIP for v1 — same reasoning as Schwab; large integration projects with zero evidence of JBW need |
| eMoney / MoneyGuide / Voyant | Financial planning (RightCapital's peers) | not mentioned directly | SKIP for v1 — same as RightCapital |
| Box / Dropbox / Google Drive | Document storage | not mentioned (JBW uses OneDrive, E-132) | REPLICATE — OneDrive/SharePoint already shipping; Box already a connector elsewhere in the codebase |
| AI assistant integrations (Bloks, CogniCor, DataDasher, DeepVest) | Third-party AI layers on top of Wealthbox | not mentioned | SKIP — this whole integration category exists because Wealthbox itself lacked native AI until 2025-2026; Lantern is AI-native, nothing to bolt on |
| Zapier (meta-integration, powers many of the above) | Automation/workflow glue | not mentioned | SKIP for v1 — no evidence of need at a ≤10-seat firm; revisit only on request |

## 14. Mobile apps

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| iOS / Android native apps | Full CRM access on mobile: Today view, contact search, click-to-call, caller ID, in-person meeting recording uploaded to the AI Notetaker, calendar | Basic | n/a (native apps, not API) | not mentioned | **SKIP — charter locked decision: no mobile app.** Phone-shaped needs are met by the full responsive intake-link flow in [04 §14](04-screens-end-to-end.md#14-existing-surfaces-write-crm-data). |
| Caller ID from Wealthbox contacts | iOS feature: incoming calls matched against Wealthbox contacts | Basic | n/a | not mentioned | SKIP — dialer/phone infrastructure, named exclusion example in the charter |
| Click-to-call | Tap a phone number in the app to dial | Basic | n/a | not mentioned | SKIP — same reason, dialer infra |

## 15. The 2025-2026 AI suite

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| AI Notetaker (launched fall 2025, native iOS recording April 2026) | Records meetings, produces detailed real-time notes, AI summary + AI-drafted follow-up email after each meeting, auto-attaches to the contact/meeting, automatic template selection | Add-on, $49/mo (Basic base tier) or bundled higher on Pro/Premier per some sources — **exact bundling by tier UNVERIFIED beyond the Basic add-on price** | UNVERIFIED (meeting/recording endpoints not in the confirmed resource list) | E-319 through E-488 extensively — this is functionally Jump's role at JBW today, not Wealthbox's own notetaker (JBW doesn't use Wealthbox's) | REPLICATE — Lantern's own meetings capture is the equivalent; the win condition is honoring JBW's exact template (E-464 — "married to the note template," Jump explicitly can't do this) where Wealthbox's own notetaker is unproven to either |
| AI for Reports | Prompt-built dynamic reports (see §10) | Premier | UNVERIFIED | E-129, E-124 | IMPROVE (see §10) |
| Agents (early access, March 2026) | Autonomous background processes on schedules/triggers: monitor workloads, flag overdue tasks, take action without manual prompting | Early access — pricing tier UNVERIFIED | UNVERIFIED | not mentioned (too new) | IMPROVE — the "take action without manual prompting" framing directly conflicts with the charter's locked invariant "AI proposes → user approves for all external writes." Build the monitoring/flagging half (matches E-119's capacity-aware triage); never the autonomous-action half |
| Playbooks (early access, March 2026) | Saved multi-step prompts that execute a full process (onboarding, annual review) in one click | Early access — pricing tier UNVERIFIED | UNVERIFIED | not mentioned (too new) | REPLICATE, approval-gated — this maps closely to "workflow templates," just AI-triggered; keep the same approve-before-write gate as everything else |
| AI Assistant (early access, March 2026) | Conversational Q&A over clients/pipeline, meeting-brief prep, drafts communications, always asks confirmation before acting | Early access — pricing tier UNVERIFIED | UNVERIFIED | E-333 (Jump's meeting-prep crawls Wealthbox, an adjacent behavior) | REPLICATE — this is functionally Lantern's existing Ask surface (charter §5.2, "Ask AND browse"); already the stronger design principle (cited sources, not just a chat answer) |

## 16. User roles, permissions, teams & workspaces

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| Member / Admin / Owner roles | Three-tier role system; Admins/Owners manage custom fields and workspace config | Basic | R (Users resource) | not mentioned | REPLICATE — a simple 2-3 role model fits a ≤10-seat firm |
| Teams | Named subgroups within a workspace for grouping/visibility (Basic=3 teams, Premier=unlimited) | Basic | R (Teams resource) | E-021 region implies an informal "team" already (JBW + Seattle + Philip) | REPLICATE |
| Groups / visibility restrictions | Restrict a contact or activity's visibility to a specific group only | Basic | UNVERIFIED | not mentioned | REPLICATE — maps onto the existing ethical-wall ACL machinery already built for the E2EE relay (feasibility doc §2) |
| Multiple Workspaces | Silo different books of business into separate environments, toggle between them | Premier (5) / Enterprise (unlimited) | R | not mentioned | REPLICATE — reinstated 2026-07-12. Separate books of business, switchable; small-firm scale, not an enterprise console. |
| Org Admin cross-workspace user management | Centralized admin console managing users across many workspaces | Premier Enterprise | UNVERIFIED | not mentioned | REPLICATE — reinstated 2026-07-12. Manage people across those workspaces from one place. |
| Default permissions per user | Admin sets a user's default data-visibility permissions | Basic | UNVERIFIED | not mentioned | REPLICATE — small-firm version only (a handful of toggles, not a permissions engine) |

## 17. Import, export & migration

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| Self-service CSV/Excel/vCard/Outlook import | In-app bulk import tool for contacts and related data | Basic | UNVERIFIED (import tooling, not confirmed as an API path) | not mentioned | REPLICATE — reinstated 2026-07-12. A self-service importer alongside the Wealthbox migration wizard. |
| White-glove migration service | Wealthbox's team migrates a firm's data from another CRM (Salesforce, Redtail, Junxure, Dynamics, ACT!, etc.), typically a few days to weeks | Included at all tiers, per help center | n/a (service, not API) | not mentioned directly, but this is exactly the switching-cost calculus in the market research (§3, 1-2 week typical migrations) | REPLICATE, inverted — **this becomes design/05's Wealthbox→Lantern migration wizard**, the make-or-break surface per the deep-dive (§7): mirror → parallel-run → cutover with a fidelity report |
| Data portability / export | All tiers can export their own data out of Wealthbox | Basic | UNVERIFIED | not mentioned | REPLICATE — frozen, decrypted archive export and rollback export are explicit user actions with readiness/status screens in [04 §11](04-screens-end-to-end.md#11-home--firm--migration-wizard-and-fidelity-report), not merely a manifest viewer. |
| External Unique ID field for import linking | A field used to key imported notes/tasks back to the right contact during bulk import | Basic | R (part of Contacts resource) | not mentioned | REPLICATE — same pattern, needed for idempotent re-import during a parallel-run migration |

## 18. API & webhooks

| Feature | What it does | Pricing tier | API | JBW evidence | Verdict |
|---|---|---|---|---|---|
| REST API (OAuth2 + token auth) | Full CRUD-ish access to Contacts, Tasks, Events, Notes, Opportunities, Projects, Workflows/Workflow Templates/Workflow Steps, Contact Roles, Custom Fields (read), Tags (read), Comments (read), Household Members (write), Teams/Users/User Groups (read) | Basic (raw access) / Pro+ ("API Development Support" — implies paid help, not gated API access itself) | This IS the API | Our own connector already exercises Contacts, Households, Notes, Tasks, Events, deletions — proving the surface live | REPLICATE — this is the migration-importer source, not a Lantern outward API. The live-probe boundary in [05 §§2.1 and 2.5](05-migration-importer.md#21-full-object-coverage-plan) is binding: no open-workflow-current-state or attachment API import is promised in v1. |
| Rate limiting | ~1 request/sec sustained over a 5-min window, burst-tolerant, 429 on excess | all tiers | n/a | Our connector already respects ~1 rps with 429 backoff | n/a — a constraint on OUR importer, not a Lantern feature |
| Native webhooks | **Does not exist.** Wealthbox has no native webhook/push system; third parties (Zapier) fake it by polling | n/a | **None confirmed** | not mentioned | IMPROVE — irrelevant to Lantern's own architecture (the E2EE relay's WebSocket fan-out is already push-based for connected peers per the feasibility doc §2), but worth naming as a gap Wealthbox itself hasn't closed |
| Workflow trigger via API | External tools (Jump) can trigger a Wealthbox workflow start via the API | Basic | W | E-450 — Jump can trigger Wealthbox workflows from meeting content | n/a — not a Lantern-native feature, this describes how Jump uses Wealthbox; Lantern's meetings capture triggers workflows natively, no external API round-trip needed |

---

## (a) Count summary

Counting each row's verdict across all 18 category tables (95 feature rows total,
including the two n/a "constraint, not a feature" rows in §18):

| Verdict | Approx. count |
|---|---|
| **REPLICATE** | 52 |
| **IMPROVE** | 18 |
| **SKIP** | 23 |
| **n/a** | 2 |
| **Total** | 95 |

SKIP breakdown by reason: mobile app / dialer infra (3 — the charter's own named example), enterprise/multi-workspace scale (2), D9/D23 exclusions (8: BCC Dropbox conflicts with E2EE; DocuSign tracking belongs to the existing connector; activity comments and reactions are deferred; generic CSV/vCard imports are deferred; Projects remain legacy-import records; Contact Actions bulk actions are excluded; and files stay in the existing Documents subsystem), out-of-scope external tools with zero JBW evidence of need (9: RightCapital, Schwab, JotForm-as-integration, AdvicePay, Orion/Black Diamond/Tamarac/Addepar, eMoney/MoneyGuide/Voyant, third-party AI-on-Wealthbox layers, Zapier, email-broadcast blasts), and one Wealthbox-own limitation not worth copying (dropbox emails are not threaded).

## (b) The 10 features that define parity in a sales conversation

A firm evaluating "can I actually leave Wealthbox for this" will check these first —
in order of how often they came up as either heavily-used or a named pain point in the
JBW evidence:

1. **Household/contact records with owner + service tier visible together** (E-085/086) — "is this my client, and what do they get."
2. **Workflow templates that propagate to open instances** (E-098/099) — the single feature Wealthbox provably cannot do; the marquee differentiator.
3. **Tasks with assignee, due date, recurrence, priority** (E-049/075/708) — the daily-driver object.
4. **Notes that honor the firm's exact template, with a hard-walled internal/client-facing split** (E-464, E-050) — "married to the template" is a gating requirement, not a preference.
5. **Full-text/semantic search across notes AND email** (E-024, E-020/291) — the two named, quoted search failures.
6. **Pinned/structured facts (account purpose, standing preferences) that don't rot into pinned notes or misused tasks** (E-073/074/076) — a real error (wrong Roth IRA) traces directly to this gap.
7. **A migration importer with a fidelity report** (deep-dive §7) — the whole pitch collapses if a firm can't trust the switch didn't lose data.
8. **Reliable email capture through the existing email connector** (§9) — BCC Dropbox itself is excluded because server-side plaintext capture would violate E2EE.
9. **Computed, dated reports beyond canned age/birthday lists** (E-088/124/129) — "who's been neglected," "who's costing us the most attention."
10. **Team activity/notification without leaking to Slack/Teams** (E-021/307) — the CRM has to be where the real color lives, or people route around it exactly like JBW routes around Wealthbox today.

## (c) UNVERIFIED — could not confirm from public sources

- Exact API write-scope for Task assignee and Task recurrence fields (our own connector's `CrmTask` model has neither field yet — this needs a live-token check, same caveat the deep-dive already flagged in §7).
- Whether Custom Objects are exposed via the public API at all (no confirmed resource in dev.wealthbox.com's list).
- File/attachment upload-download API endpoints — the live probe found no v1 read path; migration uses the operator-export or per-client-gap fallback in [05 §2.5b](05-migration-importer.md#25b-files-and-attachments-operator-export-plus-client-level-gap-flags), not an API importer.
- AI Notetaker's exact plan-by-plan bundling (Basic shows a clear $49/mo add-on price; Pro/Premier bundling terms weren't confirmed from primary sources in this pass).
- Agents / Playbooks / AI Assistant pricing tier and exact API surface — these are March 2026 early-access announcements; no pricing or API detail has surfaced yet as of 2026-07-11.
- Whether Scheduled Workflows, Workflow Outcomes (branch/restart), and Contact Actions in Opportunity Workflows are API-writable or UI-only.
- The `help.wealthbox.com` Features category page returned HTTP 403 on direct fetch; category/article titles used throughout this matrix were reconstructed from indexed search results, not a first-hand crawl of the category page — a full manual pass through the help center (ideally with a live Wealthbox trial account) would surface any remaining minor features this matrix missed (e.g. exact default-permission granularity, exact custom-field display-customization options).
- Precise per-tier Custom Object limits beyond what the pricing page states (25/100/200 fields, 20K/1M/2M records) — not cross-checked against a second source.

*Traceability: pricing/feature facts per wealthbox.com/pricing and wealthbox.com/features/*
*pages (accessed 2026-07-11); AI suite per PRNewswire 2026-03 and wealthbox.com blog posts*
*(2025-05 through 2026-04); API surface per dev.wealthbox.com plus this program's own live*
*connector code in `~/lantern-plus/src-tauri/src/commands/crm/`; JBW usage evidence per*
*`~/lantern-plus/user-research/01-evidence-ledger.md` E-### citations throughout.*
