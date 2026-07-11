# 04 - End-to-end screen specification

**Lane D · LANTERN-CRM program · DRAFT for freeze review**

**Conforms to 00-master-spec D11 (amended 2026-07-11).**

This is the screen contract for the CRM build. It renders the entities defined in
design/02-data-model.md. It does not create parallel client or workflow concepts.
matter and matter_id stay internal only. User-facing language says client or household.
All UI uses Lantern's existing light theme and existing components.

## 0. Rules that bind every screen

- The navy spine keeps exactly three primary tabs: Home, Clients, and Ask. Home is the
  landing surface and opens on Today. Its left rail contains Today, Tasks, Workflows,
  Pipeline, Reports, and Firm. Clients contains the directory and household records.
  Client Map remains the name of the facts view inside an individual household record.
- There is one strong action per screen. Everything else is secondary.
- People directly edit local encrypted CRM records. AI-created local changes are
  proposals. Every outside write, including email and parallel-run Wealthbox write-back,
  requires a person to approve it.
- Every Fact shows As of date, learned date, current/stale/disputed state, and source chips.
  Updating value makes a new Fact and preserves the old Fact in history.
- Internal and client-facing Notes are separate immutable audience lanes. Moving content
  across the boundary means creating a new note in the other lane.
- Offline work stays usable. Connector-backed content always shows Last update received
  and Last full check when those times differ.

| Action class | Meaning |
|---|---|
| Direct local edit | Saves encrypted CRM record and adds ActivityEvent. |
| Proposal | Saves suggested local change for review. |
| External approval | Sends selected reviewed change only after approval. |
| Read-only mirror | Shows imported source data that cannot safely be edited yet. |

## 1. Information architecture

~~~
Navy spine
├─ Home                             landing surface; default on launch
│  ├─ Today                         morning triage, approvals, activity
│  ├─ Tasks                         List | Board | Saved views
│  ├─ Workflows                     Templates | Instances | Propagation review
│  ├─ Pipeline                      opportunities and stages
│  ├─ Reports                       computed on demand
│  └─ Firm
│     ├─ Firm setup                 directory, roles, service tiers, retention, teams
│     ├─ Fields and tags            custom fields and tags
│     └─ Migration                  mirror, parallel run, cutover, fidelity
├─ Clients
│  ├─ Directory                     Households | People
│  └─ Household record
│     ├─ Client Map                 facts, accounts, people, service tier
│     ├─ Timeline                   human-readable combined history
│     ├─ Documents                  existing scoped surface
│     ├─ Email                      existing scoped surface
│     ├─ Meetings                   existing scoped surface
│     └─ Activity                   detailed append-only activity
├─ Ask
│  ├─ This household
│  └─ Whole practice, summaries only
~~~

Home is the landing surface, not a fourth tab or an optional Client Map toggle. Today holds
the morning triage, approvals, and firm-activity content. The household row inside Clients becomes Client Map,
Timeline, Documents, Email, Meetings, Activity. Saved views stay with the list, board,
pipeline, or report that owns them rather than appearing as a Firm section.
Timeline is readable daily client history. Activity is detailed operational history and
links to the existing compliance audit log. Ask bar stays above all CRM content with a
scope pill such as Asking: Henderson household · 214 sources.

Use SurfaceHeader, Button, IconButton, Card, Callout, Chip, CiteChip, Badge, CountBadge,
SearchField, FilterToggle, FilterPanel, SegmentedToggle, SurfaceToolbar, RailShell,
SlidePanel, EmptyState, PromptDialog, ConfirmDialog, tabs, and accordion. New pieces only
compose these: AskBar, FactChipRow, SyncStateBanner, InternalLaneMarker, ProposalCard,
CapacityTriageStrip, EntityTable, TimelineEntry, WorkflowBoard, PropagationDiff,
FidelityReportCard, and EnvelopeNotificationList.

## 2. Home > Today

**Purpose:** help each person start with the few actions that realistically need attention.

**Strong action:** Review today's plan.

~~~
┌ Home / Today                                     [Ask the practice...] ┐
│ Good morning, Maya                    Synced 2 min ago · Connected     │
│ ┌ Today, realistically ───────────────────────────────────────────────┐ │
│ │ 6 of 21 open items fit today. 4 are suggested for later. [Review]  │ │
│ │ Henderson review Thursday: 3 open items                 [Open]      │ │
│ │ Miller transfer needs Andy's approval                   [Review]    │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│ ┌ Waiting for you ────────────────┐ ┌ Sync state ─────────────────────┐ │
│ │ 2 local changes need approval   │ │ Mirror current                  │ │
│ │ 1 template update needs review  │ │ Full check: yesterday 11:04     │ │
│ └─────────────────────────────────┘ └─────────────────────────────────┘ │
│ Recent practice activity                                                    │
└────────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, SegmentedToggle, AskBar, CapacityTriageStrip, Card,
CountBadge, SyncStateBanner, TimelineEntry, CiteChip, Button.

**Actions:** Review opens side panel with suggested keep, move, delegate choices. Saving
directly edits local tasks and creates ActivityEvents. Rows route to household, task, or
proposal. Sync state routes to Home > Firm > Migration. Marking activity read changes
encrypted member read state only.

**States:** Empty: Your practice is clear for today. Loading: shell and Ask bar appear
immediately with card skeletons. Offline: You're working offline. Your local plan is ready.
New changes will deliver when you reconnect. Stale: amber banner names both timestamps.
Error: keep last plan and show Try again in failed card.

**Efficiency:** g then h opens Home, j/k moves rows, Enter opens, r reviews selected work,
/ focuses Ask. Multi-select revises several suggestions in one save.

## 3. Clients > household record

**Purpose:** make a household's truth, history, commitments, service level, and private
context understandable at a glance.

**Strong action:** Add to this household. Menu: Fact, Note, Task, Account, Person,
Opportunity, Workflow. Fact is first because information is not a task.

~~~
┌ ‹ Clients / Henderson household                    [Ask this household] ┐
│ Active · Owned by Maya · Platinum · Next review Sep 18 · Synced just now │
│ [Add to this household]                                                  │
│ Client Map | Timeline | Documents | Email | Meetings | Activity          │
├──────────────────────────────────────────────────────────────────────────┤
│ Income $240,000 · As of Jun 30 [Tax return] │ Annual review · Sep 18     │
│ Risk tolerance: balanced · May 12 [...]     │ 3 open tasks [Workflow]    │
│ Wells Fargo · •4821 · Rentals               │ Dana, Lee, Omar Chen CPA   │
│ ┌ INTERNAL ONLY ──────────────────────────────────────────────────────┐ │
│ │ Lock. Inside context. Never included in client-facing drafts.        │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│ ┌ CLIENT-FACING ──────────────────────────────────────────────────────┐ │
│ │ Review summary · verified recipients: Dana, Lee                      │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
~~~

### Client Map

**Components:** SurfaceHeader, AskBar, tabs, Badge, Chip, CiteChip, Card, Callout,
Accordion, Button, Dropdown, SlidePanel, ProposalCard, existing ClientMapPanel.

**Render contract:**

- Header always shows lifecycle, primary advisor, mine/shared/other ownership, service
  tier, and next review due together.
- FactChipRow shows label/value, status, As of, Learned, and source chips. Older values
  collapse into history instead of disappearing.
- Account row shows custodian, type, masked last four, status, owner, and bold purpose.
  Missing purpose says Needs a purpose.
- People separate household members from external parties. External parties show role and
  verified-recipient state.
- Service tier opens ServicePolicy with cadence, next review, and linked review workflow.
- Both audience lanes remain visible even empty.

| Action | Result | Class |
|---|---|---|
| Add/edit Fact | Requires type, value, dates, source, and state. | Direct local edit |
| Accept suggested Fact | Tracked preview then selected Fact write. | Proposal |
| Add Account | Requires custodian, type, purpose. No full account number field. | Direct local edit |
| Add internal note | Immutable-audience Note in amber lane. | Direct local edit |
| Draft client-facing note/email | Select verified recipients and create review item. | Proposal then external approval |
| Change service tier | Updates household policy reference. | Direct local edit |
| Start workflow | Pick published template, household, start date, owners. | Direct local edit |

**States:** Empty: Start the client map with Add a fact. Loading: header/tabs stay,
section skeletons follow. Offline: local edits work and say Waiting to deliver; outside
send is blocked until verification can be confirmed. Stale: imported Facts are amber and
header names connector clocks. Error: retry failed section only, retain rest.

**Efficiency:** a opens Add, f Fact, t Task, n internal note, 1 through 6 changes
sub-tab, ? opens shortcuts.

### Timeline

**Purpose:** show one readable history across meetings, email, notes, tasks, Facts,
workflows, accounts, and activity.

~~~
┌ Clients / Henderson household / Timeline          [Ask this household] ┐
│ [All] [Meetings] [Email] [Notes] [Tasks] [Facts] [Internal only] Search │
│ ✓ Priya completed Send review packet · Workflow · 9:14                   │
│ ▣ New fact: Rental account purpose · Jun 30 [meeting]                    │
│ ┌ INTERNAL ONLY  Dana prefers a phone call before detailed email. [Open]│ │
│ ✉ Follow-up draft waiting for approval · Client-facing · [Review]        │
└──────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceToolbar, FilterToggle, SearchField, TimelineEntry,
InternalLaneMarker, CiteChip, Badge, SlidePanel, Button, EmptyState.
Filters are view state. Open routes to natural detail. Task completion is direct local
edit. Suggestions route to proposal. Email/connector writes route to approval.
Empty, loading, offline, stale, error respectively show no-history copy, dated skeletons,
Waiting to deliver, source-specific stale chips, inline retry. Shortcuts: [/] date groups,
o opens, i toggles permitted internal view, / searches.

### Documents, Email, Meetings, Activity

These preserve existing layouts. Each gets a collapsible top ProposalCard when that source
made CRM suggestions. It never hides source content. Documents can add sourced Fact/task/
workflow or draft follow-up. Email remains threaded/searchable; BCC-dropbox message appears
in Email and Timeline. Meetings retain notes-left/transcript-right and one checkbox review
card for facts, tasks, workflows, notes, follow-ups. Activity is detailed ActivityEvent list
and link to compliance audit log. Standard states are empty source copy, skeleton, offline
pending delivery, source timestamp, and inline retry. Source links and shortcuts keep their
current behavior.

## 4. Clients > Directory > people and external parties

**Purpose:** safely manage people, trusts, organizations, and professionals attached to
households.

This is Clients → Directory → Households | People, never a fourth tab.

~~~
┌ Clients / Directory / People                     [Find a person] [Add] ┐
│ [Households] [People] [All roles] [External] [Needs verification]      │
│ Omar Chen, CPA · External · serves 4 households · Email verified ✓     │
│ Grace Lee · Henderson household · Spouse                               │
│ Redwood Family Trust · External organization · needs verification       │
└────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, SegmentedToggle, SearchField, FilterPanel, RailShell,
Badge, Chip, Card, SlidePanel, Button, EmptyState.

Add/edit person, trust, organization, channel, external role, and household relationship
directly. Review recipient opens channel/address, verification date/verifier, related
households. Verification is recorded local action. Sending through it remains external
approval. Empty/loading/offline/stale/error show next action, skeletons, last-known
verification, source timestamp, retry. Shortcuts: / search, p add, e external, v needs
verification.

## 5. Home > Tasks

**Purpose:** keep commitments assignable, recurring, connected to context, and honest about
what fits today.

**Strong action:** New task.

~~~
┌ Home / Tasks                     [Ask the practice...]          [New task] ┐
│ My work | Team work | Money movement | Review due | + Save view             │
│ [List] [Board] Assignee: me Due: this week Status: open [Filters]           │
│ 6 of 21 fit today. You can review the suggested plan. [Review plan]         │
│ □ Send review packet · Hendersons · High · Thu · Priya                      │
│ □ Confirm transfer · Miller · Urgent · Today · Andy                         │
│ □ Schedule annual review · Ortiz · recurring · Sep 18 · Maya                │
└─────────────────────────────────────────────────────────────────────────────┘
~~~

Board columns: To do, In progress, Blocked, Done. Detail SlidePanel has title,
description, status, assignees, dates, priority, recurrence, household, context/source,
workflow, comments, Activity history.

**Components:** SurfaceHeader, AskBar, SurfaceToolbar, SegmentedToggle, FilterToggle,
FilterPanel, SearchField, EntityTable, WorkflowBoard, Card, Badge, Chip, CountBadge,
SlidePanel, Button, EmptyState, Callout.

New/edit/status/assignment/priority/date/recurrence/board move are direct local edits.
One RecurrenceRule is stored; completion materializes the next child. Convert to workflow
is template-match proposal. Save as a fact instead opens prefilled Fact editor. Parallel-run
Wealthbox task creation is external approval and cannot send without due date.

Capacity ranks due date, urgency, meeting proximity, money movement, blocked state, service
tier, assignee load. It never moves work itself and never scolds. Empty distinguishes no
matches/no tasks. Loading: list/board skeleton. Offline: all local edits work. Stale:
source/time. Error: local index plus retry. Shortcuts: c complete, a assign, d due,
p priority, w match workflow, v views, g then t opens Home > Tasks.

## 6. Home > Workflows

### Templates

**Purpose:** maintain versioned, findable ways of working.

**Strong action:** Publish version 8, only after a draft changes.

~~~
┌ Home / Workflows / Templates                  [Find a workflow] [New template] ┐
│ Onboarding · published v7 · 12 open workflows                    [Edit draft] │
│ 1 Confirm household details · Ops · +0 days · Required                        │
│ 2 Open accounts · Advisor · +2 days · Required                                │
│ 3 Send welcome packet · CSA · +3 days · Required                              │
│ Draft v8: Added 1 · Changed 2 · Removed 0                    [Publish v8]     │
└───────────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, SearchField, RailShell, Card, Button, IconButton, Chip,
Badge, Callout, Accordion, SlidePanel, ConfirmDialog, PropagationDiff.

Create/edit/reorder/soft-remove steps, roles, assignees, due offsets, required, category,
trigger hints, tags directly in draft. Publish shows exact diff/affected count, creates
version and offers only, never changes open workflow. Archive blocks new instance but keeps
history. Empty offers small starter library. Offline saves draft but blocks publish until
current template/instances sync. Stale/error retain draft. Shortcuts: n, e, Shift+Enter,
Alt+Up/Down, p, /.

### Instances

**Purpose:** show live household work while preserving independently completed steps.

~~~
┌ Home / Workflows / Henderson household / Onboarding · v7 · 5 of 7 complete [Open household] ┐
│ □ Send welcome packet · Priya · due Jun 5 · required [Open task]                    │
│ □ Confirm recurring transfer · Andy · due Jun 8 [Open task]                         │
│ ✓ Open accounts · Maya · Jun 3                                                      │
│ Template update available: v8 has 3 proposed changes. [Review]                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
~~~

Start, complete, skip, reopen, assign, comment directly. Client-facing output from step is
external approval. Instance shows honored/newer version. Offline edits say Waiting to
deliver; stale version is shown; error retains snapshots. x complete, s skip, o task,
r review, g then w opens Home > Workflows.

## 7. Home > Workflows > Propagation Review

**Purpose:** safely apply a template version to selected open workflows without wiping out
real progress.

This is a full Home > Workflows route, never a modal. Publishing mints one PropagationOffer for
each changed stable step ID on each open WorkflowInstance. Publishing changes nothing.

~~~
┌ Home / Workflows / Propagation review                                     ┐
│ Onboarding v7 → v8 · 12 open workflows · 31 proposed changes              │
│ [All] [Ready: 24] [Need a decision: 7] [Already decided]                  │
│ + Confirm recurring transfer · new step · 12 workflows                     │
│ ~ Send welcome packet owner · 11 workflows                                 │
│ − Paper welcome kit · 8 workflows                                          │
│ ┌ □ Henderson household · 3 changes · Ready ────────────────────────────┐ │
│ │ + Confirm recurring transfer · due +4 · Ops                             │ │
│ │ ~ Send welcome packet · Priya → CSA · Progress kept: Done               │ │
│ │ − Paper welcome kit · Not started                [Show full diff]       │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
│ ┌ □ Miller household · 2 changes · Needs a decision ─────────────────────┐ │
│ │ Current owner changed locally.                         [Compare]         │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
│ 18 changes selected across 7 workflows                     [Approve changes]│
└────────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, FilterToggle, FilterPanel, SearchField, Card, Accordion,
Badge, CountBadge, Chip, Button, Callout, SlidePanel, ConfirmDialog, PropagationDiff,
existing UndoToast only for short discovery.

**Diff rules:**

- Compare stable step IDs, never position/title alone.
- Add shows title, owner/role, due offset, required state, future task effect.
- Modify shows before/after each changed template field. Progress is fixed separate field
  labelled Progress kept; approval never alters todo/in progress/done/skipped.
- Remove shows not-started/in-progress/done. Done keeps history. In-progress retains linked
  task as No longer in template, never deletes work.
- Household checkbox selects conflict-free pending offers. Expanded rows select individual
  offers. Conflict rows start unselected. Footer always names selected changes/workflows.

**Partial approval:** selected offers alone are accepted, timestamped, and apply their
template-backed snapshot changes. Unselected offers remain Needs review. Keep this workflow
as it is explicitly rejects offer, preserves version difference/history, allows internal
reason. Completed/cancelled workflows remain in Already decided. Honored template version
advances only when no pending offer remains across intervening versions.

**Conflict:**

~~~
┌ Home / Workflows / Miller household / Send welcome packet               ┐
│ Template v7: Owner Priya                                                 │
│ This workflow now: Owner Maya, changed Jul 10 by Maya                    │
│ Template v8 proposes: Owner CSA                                          │
│ Progress: Done. This will not change.                                    │
│ [Use template owner: CSA]              [Keep workflow owner: Maya]       │
└─────────────────────────────────────────────────────────────────────────┘
~~~

Conflict means local template-backed change, another-device unresolved change, or incompatible
offer. Choices are exactly Use template (accept) and Keep workflow (reject). No hidden
merge editor. Custom value requires keeping workflow then normal visible instance edit.
Merged other-person decision becomes Already reviewed by Priya at 10:14.

**Approval and undo:** Approval creates ActivityEvent per decision plus batch summary.
Persistent result: 18 changes applied to 7 workflows. Progress was kept. Undo creates
append-only reversal, restores only batch-altered template fields, never rewinds progress,
completed tasks, comments, or later edits. Unsafe reversal opens compare/decide. History
shows publisher, versions, household decisions, reasons, reversals.

States: Empty says all workflows match. Loading waits for encrypted index. Offline:
Reconnect to review firm workflow changes safely, read-only. Stale blocks bulk approval
until current open-instance set syncs. Error retains diff/selection/retries idempotently.
Shortcuts: Space offer, Shift+Space household, Enter diff, u undo, f filters, a footer.

## 8. Home > Pipeline

**Purpose:** track potential work without introducing another project container.

Projects fold into workflows/tasks. Opportunities are the data model pipeline entity; stages
are firm configuration.

~~~
┌ Home / Pipeline                               [Ask the practice...] [New opportunity] ┐
│ Retirement conversions · Open $1.8m · Weighted $940k                                  │
│ Discovery: Patel $400k Sep 14 | Recommendation: Avery $250k Sep 20                    │
│ Decision: Chen $180k today   | Won: Lewis $600k                                       │
└────────────────────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, AskBar, SegmentedToggle, WorkflowBoard, EntityTable, Card,
Badge, Chip, SlidePanel, Button, EmptyState, Callout.

Edit value, probability, owner, close date, tags/custom fields locally. Stage drag is direct.
Won/lost needs close reason for lost. Stage can propose linked workflow. Parallel-run imports
say Read-only mirror until cutover; no edit implies write-back. Empty/loading/offline/stale/
error give new opportunity, columns, last-known data, timestamp, retry. n, arrows, Enter,
w, g then p opens Home > Pipeline.

## 9. Home > Reports

**Purpose:** answer operational questions from current records without a cached dashboard
pretending to be truth.

**Strong action:** Run report.

~~~
┌ Home / Reports                               [Ask the practice...] [New report] ┐
│ [No contact in 6 months] [Attention vs fee] [Birthdays] [Age 65] [Review due]│
│ Computed just now from 1,284 sources · Local index current · [Run report]    │
│ Henderson household · Last meaningful contact Jan 8 · Platinum [Open]        │
│ Ortiz household · Last meaningful contact Dec 17 · Gold [Open]               │
│ [Save this view] [Export as Word]                                             │
└───────────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, AskBar, SegmentedToggle, SurfaceToolbar, EntityTable, Card,
Badge, CiteChip, Callout, SlidePanel, Button, EmptyState.

Built-ins: no contact in 6 months, attention vs fee, birthdays, age 65, RMD due, review due.
Custom report is SavedView query. Ask can propose query, person reviews filters before save.
Every result is stamped: Computed just now from N sources. N means decrypted records and
source-backed Facts considered after filters. Detail shows record kinds, exclusions,
calculation time, index freshness.

Run is local computation. Open routes household. Save personal/firm view has explicit Share
with firm. Export is local Word/PDF and logs Activity. Emailing export is external approval.
Empty no matches; loading preserves prior result as Updating; offline says computed from
local data while offline; stale banner; error prior result/retry. g then r opens Home >
Reports; 1-6, r, s, e, / work.

## 10. Activity feed and notifications

**Purpose:** deliver meaningful team work without a noisy chat surface or relay content leak.

Firm activity is on Home > Today. Household activity is in household Activity. A count beside
existing account identity opens SlidePanel, never floating bell/fourth tab.

~~~
┌ Notifications (3)                                                     ┐
│ New assignment · Confirm transfer · Miller household · 8 min ago [Open]│
│ Template update needs review · Onboarding v8 · 32 min ago [Review]    │
│ Mentioned you in an internal note · Henderson household [Open]         │
│ [Mark all read]                                                        │
└───────────────────────────────────────────────────────────────────────┘
~~~

**Components:** CountBadge, SlidePanel, EnvelopeNotificationList, TimelineEntry, Badge,
CiteChip, Button, EmptyState, Callout.

Encrypted envelopes decrypt only on recipient device. Relay learns only pending count/timing.
Open routes entity. Read/unread is encrypted member state and never dismisses task. Mention
offers recipient chip review. No silent notify-everybody. Empty/loading/offline/stale/error:
caught-up copy, decrypt local envelopes, queued read updates, last check, retry. g then n,
j/k, Enter, r, Shift+r work.

## 11. Home > Firm > Migration wizard and fidelity report

**Purpose:** take firm from mirror to parallel-run to cutover, with a report it can retain.

Home → Firm → Migration is a first-class route with phase rail.

~~~
┌ Home / Firm / Migration / Wealthbox migration                         ┐
│ Mirror ● Current    Parallel run ○ Next    Cutover ○ Locked           │
│ Mirror current · Last update 10:42 · Last full check yesterday 02:15 │
│ 80 households · 262 people · 1,904 notes · 311 tasks                 │
│ [Review fidelity report]                           [Start parallel run]│
└──────────────────────────────────────────────────────────────────────┘
┌ Home / Firm / Migration / Fidelity report / Jul 11 10:42 [Export report] ┐
│ Result: Attention needed before cutover                              │
│ Households 80 fetched / 80 imported / 0 skipped · Complete           │
│ Notes 1,904 fetched / 1,892 imported / 12 skipped · Review [See 12]  │
│ Last update 10:42 · Last full check yesterday 02:15                  │
│ [Open frozen archive manifest]                                       │
└──────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, RailShell, Card, Callout, Badge, CountBadge, EntityTable,
Accordion, Progress, Button, SlidePanel, ConfirmDialog, FidelityReportCard,
CrmWriteReviewCard.

Mirror is read-only, resumable per record type, two clocks, drillable skipped rows. Primary
action is Review fidelity report. Parallel run starts after admin confirms Wealthbox remains
authoritative. It states exact boundary: notes/tasks/proven writable fields use external
approval; opportunities/workflows/projects/unsupported fields say Read-only mirror until
cutover; Lantern-only field says so before edit. Writes use CrmWriteReviewCard conventions:
tracked diff, checkbox, edit-before-approve, provenance, multi-household picker, stale re-read,
inline retry, never auto-send.

Cutover is disabled until current report has zero unexplained skips for active-client
households, contacts, notes, tasks, events, opportunities. Require full check, frozen raw
archive/manifest, matching report export, rollback export, recorded Jump choice. Prepare
cutover opens review, not destructive button, explaining Lantern replaces Jump meeting writes
versus Keep Jump connected to Wealthbox temporarily. Actual connector account change belongs
to build contract.

States: no connection Connect Wealthbox; loading per-type progress not modal; offline safely
paused/resumable; stale two clocks; error checkpoint and Resume import; incomplete fidelity
never green. g then m opens Home > Firm > Migration; arrows, Enter, f, e work.

## 12. Home > Firm > Fields and tags

**Purpose:** useful shared structure without configuration before value.

Home → Firm → Fields and tags contains Custom fields | Tags. Saved views remain in the
Tasks, Pipeline, and Reports surfaces where people use them.

~~~
┌ Home / Firm / Fields and tags                                   [New field] ┐
│ [Custom fields] [Tags]                                                     │
│ Service region · Choice · Household · Optional                 [Edit]       │
│ Referral source · Choice · Household · Optional                [Edit]       │
│ Tags: [Tax planning] [New client] [Money movement]             [Manage]     │
└─────────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, tabs, EntityTable, Card, Chip, Badge, SearchField,
FilterPanel, SlidePanel, PromptDialog, ConfirmDialog, Button, EmptyState, Callout.

Admins create/edit/archive CustomFieldDef requiring label, applies-to, type, choices,
required. Type change after values blocked: make replacement. Admins create/rename/merge/
archive tags; merge preview counts affected records. Any person saves current list/board/
pipeline/report personally; sharing explicit. Shared view edit gives visible revision/Activity.
States: empty next action, loading skeleton, offline CRDT pending, stale possible admin update,
error retry. n, /, Enter, Shift+S work.

## 13. Home > Firm > Firm setup

**Purpose:** manage few firm rules shaping real work.

**Strong action:** Invite member.

~~~
┌ Home / Firm / Firm setup                                    [Invite member] ┐
│ Members | Roles | Service tiers | Retention | Teams                         │
│ Maya Patel · Owner · Active [Edit]                                          │
│ Priya Shah · Operations · Active [Edit]                                     │
│ Platinum · quarterly · review workflow: Annual review                       │
└─────────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, tabs, EntityTable, Card, Badge, Chip, Callout, SlidePanel,
ConfirmDialog, Button, EmptyState.

Roles Owner/Admin/Member. Owners/Admins manage firm config; existing ethical walls control
visibility. Deactivation retains attribution. Tiers edit firm ServicePolicy: cadence, custom
days, review rule/workflow, description. Household exception visibly shows override.
Retention gives category, period, plain consequence, protected compliance/archive policy.
Teams are routing/visibility groups, not workspaces. Invite email external approval; all
else direct local firm-doc edit by role. Offline safety checks read-only; stale last firm
sync; error isolated. g then f opens Home > Firm; m/r/t, i work.

## 14. Existing surfaces write CRM data

- **Ask:** cited answers propose Facts/tasks/workflows/communications in ProposalCard.
  Local approval writes CRM. External rows continue to external approval.
- **Meetings:** preserve record pill, consent, notes-left/transcript-right, prep strip.
  One review card offers facts, notes, tasks, workflows, follow-ups. Chip opens exact moment.
- **Documents:** selected text actions Add fact, Create task, Start workflow, Draft follow-up.
  Follow-up is external approval.
- **Email:** remains household-scoped/threaded. Incoming mail may propose local CRM data.
  Outbound checks verified recipients and needs external approval. BCC mail appears Email/Timeline.
- **Intake:** matched response makes review strip; uncertain match makes Match this response
  proposal. Extraction makes dated Fact with intake source. AI-suggested new record reviewed;
  intentional person-created local record saves directly.

## 15. Cross-cutting patterns

### Approval cards

ProposalCard extends CrmWriteReviewCard: collapsed count/Review, per-row checkbox, tracked
green/red change, source chips, stale automatic unselection, one Approve changes, durable
inline error/retry, recoverable dismiss history. Outside rows say Will be sent outside Lantern,
need verification/current check, and never blend with local results.

### Internal-only marking

Use all signals: amber border/background; lock plus Internal only; persistent lane; sentence
Never included in client-facing drafts; source picker block in client-facing composer. Screen
reader says Internal only content. Color is never sole signal.

### Sync states

| State | Marker | Meaning |
|---|---|---|
| Current | green dot, Synced just now | Current known local index |
| Offline | gray cloud, Working offline | Local edits work; delivery waits |
| Stale mirror | amber banner | Last update and last full check |
| Needs attention | red inline Callout | Specific failure; readable local data remains |

### Capacity-honest copy

Use: 6 of 21 open items fit today. Four can wait without affecting a meeting or due date.
You can move this to next week, keep it today, or assign it to someone else.
Never: You are behind. Overdue crisis. Failed SLA. Fix your workload. You must clear this
backlog.

## 16. Open questions for freeze review

1. Lane C must lock convergent undo and when partial propagation makes instance reconciled.
   This UI requires append-only history and never rollback of step progress.
2. Encrypted envelopes expose pending-count/timing metadata. Freeze accepts that or polling.
3. Live Wealthbox API must establish whether open workflow step state can be read faithfully.
4. Every parallel-run writable field needs live connector proof. Until then it is read-only.
5. Freeze must accept blocking external send when current recipient verification is unavailable.
6. Compliance review must set retention/archive policy before live cutover.
7. Freeze must decide whether attention-versus-fee begins with fee source or plainly says it
   is missing. It must never silently estimate.

## End-of-run summary

1. CRM joins existing three-tab app without fourth main tab.
2. Every requested surface has route, layout, action, states, keyboard behavior.
3. Propagation review covers partial approval, conflict, history, safe undo.
4. Approval, internal-only, provenance, sync, Ask, and triage rules are shared.
5. Remaining risks are named plainly for freeze review.

DONE-EXIT
