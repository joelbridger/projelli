# 04 - End-to-end screen specification

**Lane D · LANTERN-CRM program · DRAFT for freeze review**

**Conforms to 00-master-spec decisions D1–D25.**

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
- Offline work stays usable. Connector-backed content uses the shared freshness language in
  §15: Live, Syncing, Last synced, or Offline. Where source checks matter, Last synced also
  shows the last full check.

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
│     ├─ Intake links               create, preview, and review submissions
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
│  └─ Whole firm, summaries only
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
┌ Home / Today                                         [Ask the firm...] ┐
│ Good morning, Maya                                      Live · Connected │
│ ┌ Today, realistically ───────────────────────────────────────────────┐ │
│ │ 6 of 21 open items fit today. 4 are suggested for later. [Review]  │ │
│ │ Henderson review Thursday: 3 open items                 [Open]      │ │
│ │ Miller transfer needs Andy's approval                   [Review]    │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│ ┌ Waiting for you ────────────────┐ ┌ Sync state ─────────────────────┐ │
│ │ 2 local changes need approval   │ │ Last synced 10:42               │ │
│ │ 1 template update needs review  │ │ Full check: yesterday 11:04     │ │
│ └─────────────────────────────────┘ └─────────────────────────────────┘ │
│ Recent firm activity                                                        │
└────────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, SegmentedToggle, AskBar, CapacityTriageStrip, Card,
CountBadge, SyncStateBanner, TimelineEntry, CiteChip, Button.

**Actions:** Review opens side panel with suggested keep, move, delegate choices. Saving
directly edits local tasks and creates ActivityEvents. Rows route to household, task, or
proposal. Sync state routes to Home > Firm > Migration. Marking activity read changes only
this device's local inbox state.

**States:** Empty: Your firm is clear for today. Loading: shell and Ask bar appear
immediately with card skeletons. Offline: You're working offline. Your local plan is ready.
New changes will deliver when you reconnect. Last synced: amber banner names both timestamps.
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
│ Active · Owned by Maya · Platinum · Next review Sep 18 · Live             │
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
│ │ Review summary · local note · audience fixed at creation             │ │
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
- Service tier opens ServicePolicy with cadence, next review, linked review workflow, and
  the firm scheduling link when one is set.
- Both audience lanes remain visible even empty.

| Action | Result | Class |
|---|---|---|
| Add/edit Fact | Requires type, value, dates, source, and state. | Direct local edit |
| Accept suggested Fact | Tracked preview then selected Fact write. | Proposal |
| Add Account | Requires custodian, type, purpose. No full account number field. | Direct local edit |
| Add internal note | Immutable-audience Note in amber lane. | Direct local edit |
| Add client-facing note | Creates a local Note in the immutable client-facing audience lane. | Direct local edit |
| Draft email | Opens the existing mail surface; verified recipients and external approval happen there. | External approval |
| Change service tier | Updates household policy reference. | Direct local edit |
| Start workflow | Pick published template, household, start date, owners. | Direct local edit |

**States:** Empty: Start the client map with Add a fact. Loading: header/tabs stay,
section skeletons follow. Offline: local edits work and say Waiting to deliver; an outside
email is blocked until verification can be confirmed in the mail surface. Last synced:
imported Facts are amber and the header names connector clocks. Error: retry failed section
only, retain rest.

**Efficiency:** a opens Add, f Fact, t Task, n internal note, 1 through 6 changes
sub-tab, ? opens shortcuts.

### Note editor

A Note is always a local CRM record. Creation chooses Internal or Client-facing once; the
audience cannot later be changed. The editor exposes **Pin**, **@mentions**, and a clear
notification-review strip listing who will be notified before the local note is saved.
Mentions create the appropriate notification record; they do not turn a Note into email.
The only email action is **Draft email**, which opens the existing mail surface and follows
its separate recipient verification and external-approval flow. There is no send button,
recipient picker, or activity-comment control on a Note.

Household scheduling actions appear beside the service tier and upcoming review: **Schedule
with this household** opens the configured `ServicePolicy.schedulingLinkUrl` in the existing
calendar connector. A missing link says Ask a firm admin to add a scheduling link.

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
Empty, loading, offline, Last synced, error respectively show no-history copy, dated skeletons,
Waiting to deliver, source-specific Last synced chips, inline retry. Shortcuts: [/] date groups,
o opens, i toggles permitted internal view, / searches.

### Documents, Email, Meetings, Activity

These preserve existing layouts. Each gets a collapsible top ProposalCard when that source
made CRM suggestions. It never hides source content. Documents can add sourced Fact/task/
workflow or draft follow-up. Email remains threaded/searchable. Meetings retain
notes-left/transcript-right and one checkbox review
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
approval. Empty/loading/offline/Last synced/error show next action, skeletons, last-known
verification, source timestamp, retry. Shortcuts: / search, p add, e external, v needs
verification.

## 5. Home > Tasks

**Purpose:** keep commitments assignable, recurring, connected to context, and honest about
what fits today.

**Strong action:** New task.

~~~
┌ Home / Tasks                         [Ask the firm...]          [New task] ┐
│ My work | Team work | Money movement | Review due | + Save view             │
│ [List] [Board] Assignee: me Due: this week Status: open [Filters]           │
│ 6 of 21 fit today. You can review the suggested plan. [Review plan]         │
│ □ Send review packet · Hendersons · High · Thu · Priya                      │
│ □ Confirm transfer · Miller · Urgent · Today · Andy                         │
│ □ Schedule annual review · Ortiz · recurring · Sep 18 · Maya                │
└─────────────────────────────────────────────────────────────────────────────┘
~~~

Board columns: To do, In progress, Blocked, Done. Detail SlidePanel has title, body notes,
status, singular assignee, dates, priority, recurrence, household, context/source, workflow
links rendered from `contextRefs`, and Activity history. Tasks have no comments feature.

**Components:** SurfaceHeader, AskBar, SurfaceToolbar, SegmentedToggle, FilterToggle,
FilterPanel, SearchField, EntityTable, WorkflowBoard, Card, Badge, Chip, CountBadge,
SlidePanel, Button, EmptyState, Callout.

New/edit/status/assignment/priority/date/recurrence/board move are direct local edits.
One RecurrenceRule is stored; completion materializes the next child. Convert to workflow
is template-match proposal. Save as a fact instead opens prefilled Fact editor. Parallel-run
Wealthbox task creation is external approval and cannot send without due date.

Capacity ranks due date, urgency, meeting proximity, money movement, blocked state, service
tier, assignee load. It never moves work itself and never scolds. Empty distinguishes no
matches/no tasks. Loading: list/board skeleton. Offline: all local edits work. Last synced:
source/time. Error: local index plus retry. Shortcuts: c complete, a assign, d due,
p priority, w match workflow, v views, g then t opens Home > Tasks.

## 6. Home > Workflows

### Templates

**Purpose:** maintain versioned, findable ways of working.

**Strong action:** Publish update, only after a draft changes.

~~~
┌ Home / Workflows / Templates                  [Find a workflow] [New template] ┐
│ Onboarding · published: Welcome sequence refresh · 12 open workflows [Edit draft] │
│ 1 Confirm household details · Ops · +0 days · Required                        │
│ 2 Open accounts · Advisor · +2 days · Required                                │
│ 3 Send welcome packet · CSA · +3 days · Required                              │
│ Draft update: Added 1 · Changed 2 · Removed 0            [Publish update]     │
└───────────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, SearchField, RailShell, Card, Button, IconButton, Chip,
Badge, Callout, Accordion, SlidePanel, ConfirmDialog, PropagationDiff.

Create/edit/reorder/soft-remove steps, roles, default assignee, due offsets, required,
category, trigger hints, and tags directly in draft. The template has a dedicated **schedule
editor**, and every step has an **outcomes and branching editor**. Publish asks for a
human-readable update label, shows the exact diff/affected
count, creates an immutable revision set and offers only, and never changes an open workflow.
Archive blocks new instance but keeps history. Empty offers small starter library. Offline
saves draft but blocks publish until the required template/instance state is available.
Last synced/error retain draft. Shortcuts: n, e, Shift+Enter, Alt+Up/Down, p, /.

### Instances

**Purpose:** show live household work while preserving independently completed steps.

~~~
┌ Home / Workflows / Henderson household / Onboarding · 5 of 7 complete [Open household] ┐
│ □ Send welcome packet · Priya · due Jun 5 · required [Open task]                    │
│ □ Confirm recurring transfer · Andy · due Jun 8 [Open task]                         │
│ ✓ Open accounts · Maya · Jun 3                                                      │
│ Update pending: Welcome sequence refresh · full change-set not yet present [Review] │
└─────────────────────────────────────────────────────────────────────────────────────┘
~~~

Start, complete, skip, reopen, assign, and add a per-step note directly. Client-facing output
from a step is external approval. An instance shows a human-readable update label as Pending
until its full composed change-set is present; unrelated pending offers do not hold it back.
Offline edits say Waiting to deliver; Last synced state names the available revision set;
error retains snapshots. x complete, s skip, o task, r review, g then w opens Home > Workflows.

## 7. Home > Workflows > Propagation Review

**Purpose:** safely apply a named template update to selected open workflows without wiping
out real progress.

This is a full Home > Workflows route, never a modal. Publishing mints **one
PropagationOffer per open WorkflowInstance**. Each offer contains its changed steps and
fields; publishing changes nothing. The revision-set mechanics and decision ledger are
canonical in [03 §4](03-sync-and-notifications.md#4-workflow-template-propagation-d4).

~~~
┌ Home / Workflows / Propagation review                                          ┐
│ Onboarding · Welcome sequence refresh · 12 eligible instances                  │
│ [All] [Ready: 8] [Need a decision: 4] [Already decided] [Approve all eligible]│
│ ┌ Henderson household · one offer · update pending ──────────────────────────┐ │
│ │ Confirm recurring transfer: [Accept] due +4 · Ops                           │ │
│ │ Send welcome packet / owner: [Reject] current routing stays for this run    │ │
│ │ Paper welcome kit: [Accept] untouched step will be removed                  │ │
│ │ Full composed change-set pending until these decisions apply [Show diff]    │ │
│ └────────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Miller household · one offer · unresolved concurrent update heads ─────────┐ │
│ │ Review the two source updates before choosing fields.          [Review]     │ │
│ └────────────────────────────────────────────────────────────────────────────┘ │
│ 18 accepted fields across 7 instances                              [Apply]    │
└───────────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, FilterToggle, FilterPanel, SearchField, Card, Accordion,
Badge, CountBadge, Chip, Button, Callout, SlidePanel, ConfirmDialog, PropagationDiff,
existing UndoToast only for short discovery.

**Diff rules:**

- Compare stable step IDs, never position/title alone.
- Add shows title, owner/role, due offset, required state, and future task effect.
- Modify shows before/after every changed template field with Accept/Reject controls. Every
  per-step and per-field control defaults to **Accept**.
- Progress is a fixed, separate field. Propagation never alters a completed step, its outcome,
  completion, step notes, or assignment history. An owner-role change affects only future
  routing; where useful the offer may separately offer a **new assignment**.
- Remove shows untouched/in-progress/completed. A completed or progressed step keeps its
  history; in-progress work remains as No longer in template and is never deleted.
- The row is one instance offer, not an offer per step. **Approve all eligible instances**
  accepts the default selections for every conflict-free instance. Expanded rows make the
  individual decisions visible. Unresolved concurrent heads require explicit review.

**Partial approval:** decisions are recorded per instance, step, and field. A rejected
field remains rejected until a descendant update changes that same field and re-offers it.
The instance continues to show the named target update as Pending until its complete composed
change-set is present. A pending offer unrelated to that change-set never blocks advancement.
Completed/cancelled workflows remain in Already decided.

**Conflict:**

~~~
┌ Home / Workflows / Miller household / Send welcome packet                    ┐
│ Two concurrent updates changed the due offset. Review is required.           │
│ Update A: +2 days · Update B: +4 days                                         │
│ Current step is complete. It will not change.                                 │
│ [Use resolved +4 days]                         [Keep current +1 day]         │
└─────────────────────────────────────────────────────────────────────────┘
~~~

Conflict means another-device unresolved change or incompatible derived-field history.
Choices are Accept a resolved source value or Reject and keep the current derived value.
There is no hidden merge editor. A custom value requires rejecting the field and making a
normal, visible instance edit. A merged other-person decision becomes Already reviewed by
Priya at 10:14.

**Approval and undo:** Approval creates an ActivityEvent per decision plus a batch summary.
Persistent result: 18 derived fields applied to 7 instances. Progress was kept. Undo is the
D4 conditional compensating operation: it automatically restores only still-untouched derived
cells from this apply. It lists protected cells with a plain reason, such as later template
work or a local edit, and leaves them intact. There is no compare/decide dialog for protected
cells. History shows publisher, named update, per-field decisions, reasons, and reversals.

States: Empty says all workflows match. Loading waits for encrypted index. Offline:
Reconnect to review firm workflow changes safely, read-only. Syncing says, “Showing at least
the changes received through 10:42; newer changes may still arrive,” and blocks bulk approval.
Last synced blocks bulk approval until the eligible instance set is complete. Error retains
diff/selection/retries idempotently.
Shortcuts: Space offer, Shift+Space household, Enter diff, u undo, f filters, a footer.

## 8. Home > Pipeline

**Purpose:** track potential work without introducing another project container.

Opportunities are the data model pipeline entity; stages are firm configuration. Imported
**Legacy Projects** remain a read-only historical view. They are never folded away or
auto-converted; their explicit action is **Start a workflow from this**, which opens a
prefilled, human-reviewed workflow start.

~~~
┌ Home / Pipeline                                   [Ask the firm...] [New opportunity] ┐
│ Retirement conversions · Open $1.8m · Weighted $940k                                  │
│ Discovery: Patel $400k Sep 14 | Recommendation: Avery $250k Sep 20                    │
│ Decision: Chen $180k today   | Won: Lewis $600k                                       │
└────────────────────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, AskBar, SegmentedToggle, WorkflowBoard, EntityTable, Card,
Badge, Chip, SlidePanel, Button, EmptyState, Callout.

Edit value, probability, owner, close date, tags/custom fields locally. Stage drag is direct.
Won/lost needs close reason for lost. Stage can propose linked workflow. Imported Legacy
Projects show Read-only historical record with **Start a workflow from this**; no edit implies
write-back. Empty/loading/offline/Last synced/error give new opportunity, columns, last-known
data, timestamp, retry. n, arrows, Enter, w, g then p opens Home > Pipeline.

### Pipeline settings

Home → Pipeline → **Settings** is the firm configuration route. Admins can create, edit,
archive, and order pipelines; within each pipeline they create, edit, archive, and order
stages. Each stage exposes its `StageTriggerRule` list: entry/exit event, optional workflow
template, whether a proposal is required, and enabled state. The preview states exactly what
will be proposed on stage entry; it never launches a workflow automatically. This surface
edits `PipelineDef`, `StageDef`, and `StageTriggerRule` from
[02 §1.14](02-data-model.md#114-opportunity-pipeline).

## 9. Home > Reports

**Purpose:** answer operational questions from current records without a cached dashboard
pretending to be truth.

**Strong action:** Run report.

~~~
┌ Home / Reports                                   [Ask the firm...] [New report] ┐
│ [No contact in 6 months] [Attention vs fee] [Birthdays] [Age 65] [Review due]  │
│ Computed just now from 1,284 sources · Local index Live · [Run report]          │
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
local data while offline; Last synced banner; error prior result/retry. g then r opens Home >
Reports; 1-6, r, s, e, / work.

## 10. Activity feed and notifications

**Purpose:** deliver meaningful team work without a noisy chat surface or relay content leak.

Firm activity is on Home > Today. Household activity is in household Activity. Activity has
no comments in v1. Each item offers Like, Celebrate, and Appreciate reactions; the saved count
and a hover list of the people who reacted are visible in both timelines. A count beside existing account
identity opens SlidePanel, never floating bell/fourth tab.

~~~
┌ Notifications (3)                                                            ┐
│ New assignment · Confirm transfer · Miller household · recipient: Maya [Open]│
│ Sent 10:34 · delivered 10:35 · acked 10:36 · ciphertext: 4–16 KiB             │
│ Opaque id: env_7f…91 · Template update needs review                [Review]   │
│ Mentioned you in an internal note · recipient: Maya · 8–32 KiB       [Open]   │
│ [Mark all read on this device]                                               │
└──────────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** CountBadge, SlidePanel, EnvelopeNotificationList, TimelineEntry, Badge,
CiteChip, Button, EmptyState, Callout.

Encrypted envelopes decrypt only on the recipient device. The notification detail plainly
discloses the relay metadata it really has: recipient, sent/delivery/ack timestamps,
ciphertext-size band, delivery/ack timing, and opaque envelope ID. It never invents a sender
field. Open routes to the authoritative record. Ordinary read/unread is local device inbox
state and never dismisses a task or claims a synced member read state; approval visibility
comes from the synced approval record. Mention offers recipient chip review. No silent
notify-everybody. Empty/loading/offline/Last synced/error: caught-up copy, decrypt local
envelopes, local read state, last check, retry. g then n, j/k, Enter, r, Shift+r work.

## 11. Home > Firm > Migration wizard and fidelity report

**Purpose:** take firm from mirror to parallel-run to cutover, with a report it can retain.

Home → Firm → Migration is a first-class route with phase rail.

~~~
┌ Home / Firm / Migration / Wealthbox migration                         ┐
│ Mirror ● Last synced    Parallel run ○ Next    Cutover ○ Locked       │
│ Last synced 10:42 · Last full check yesterday 02:15                   │
│ 80 households · 262 people · 1,904 notes · 311 tasks                 │
│ [Review fidelity report] [Archive export] [Rollback export] [Start parallel run]│
└──────────────────────────────────────────────────────────────────────┘
┌ Home / Firm / Migration / Fidelity report / Jul 11 10:42 [Export report] ┐
│ Result: Attention needed before cutover                              │
│ Households 80 fetched / 80 imported / 0 skipped · Complete           │
│ Notes 1,904 fetched / 1,892 imported / 12 skipped · Review [See 12]  │
│ Last update 10:42 · Last full check yesterday 02:15                  │
│ Open workflows: 4 checklists · 3 decided · 1 needs operator decision │
│ Attachments: 78 exported · 2 explicit client gaps                    │
│ [Open frozen archive manifest] [Archive export readiness]             │
└──────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, RailShell, Card, Callout, Badge, CountBadge, EntityTable,
Accordion, Progress, Button, SlidePanel, ConfirmDialog, FidelityReportCard,
CrmWriteReviewCard.

Mirror is read-only, resumable per record type, two clocks, drillable skipped rows. Primary
action is Review fidelity report. Parallel run starts after admin confirms Wealthbox remains
authoritative. Its workflow mirror is deliberately limited to **readable workflow templates
and activity traces**. It never presents API-derived open-workflow state. Notes/tasks/proven
writable fields use external approval; Legacy Projects and unsupported fields are read-only;
Lantern-only fields say so before edit. Writes use CrmWriteReviewCard conventions: tracked
diff, checkbox, edit-before-approve, provenance, multi-household picker, changed-since-review
re-read,
inline retry, never auto-send.

### Required fallback routes, visible through cutover

The fidelity report exposes two explicit routes: **In-flight workflow re-creation** and
**Attachment accounting**. Their summary cards stay visible through cutover.

**In-flight workflow re-creation** lists every affected client and requires a guided operator
checklist: source template, linked client, available activity evidence, operator decision,
resulting Lantern instance, and any unresolved trace gap. **Start Lantern workflow** opens a
new instance at the operator-selected current step; it never claims to import open-workflow
state from the API. The checklist remains visible until the decision and resulting instance or
gap are recorded.

**Attachment accounting** lists every client with one explicit status: Exported (with export
source and operator) or Attachment gap (with reason and owner). It stays visible until every
affected client is accounted for; absence is never silently treated as no attachments.

### Archive and rollback exports

**Archive export** opens a readiness screen for the sealed import archive: manifest present,
raw-capture checksums verified, fidelity counts matched, storage destination selected, then
**Create archive export**. Its status screen shows Preparing, Ready, Failed with retry, or
Exported with date and manifest identifier.

**Rollback export** opens a separate readiness screen: full check complete, current report
saved, eligible Lantern changes counted, destination format checked, and known unsupported
items listed. **Create rollback export** is an explicit action. Its status screen shows the
same clear Preparing/Ready/Failed/Exported states and exposes the generated reconciliation
report. These actions prepare exports; neither silently changes a connector account.

Cutover is disabled until the current report has zero unexplained skips for active-client
households, contacts, notes, tasks, events, and opportunities; a full check; frozen raw
archive/manifest; matching report export; and rollback export readiness. It also requires a
recorded operator decision for every in-flight-workflow checklist and explicit
exported-or-gap accounting for every affected client's attachments. Prepare cutover opens
review, not a destructive button, explaining Lantern replaces Jump meeting writes versus
keeping Jump connected to Wealthbox temporarily. Actual connector account change belongs to
the build contract.

States: no connection Connect Wealthbox; loading per-type progress not modal; offline safely
paused/resumable; Last synced shows two clocks; error checkpoint and Resume import; incomplete fidelity
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
States: empty next action, loading skeleton, offline CRDT pending, Last synced possible admin update,
error retry. n, /, Enter, Shift+S work.

The owning record surfaces contextual **Values and tags** editors: Household Client Map,
Person detail, Account detail, and Task detail each show only fields that apply to that record,
plus its tags. A value save records its source/date as required by the data contract; it does
not send the person into Firm settings for ordinary data entry.

**Firm documents** is a minimal companion list in this route: title, type, tags, last update,
and **Open in document editor**. Creating, reading, and editing content stay in the existing
document editor; this CRM screen does not make a second editor.

## 13. Home > Firm > Firm setup

**Purpose:** manage few firm rules shaping real work.

**Strong action:** Open firm administration.

~~~
┌ Home / Firm / Firm setup                          [Open firm administration] ┐
│ Members | Roles | Service tiers | Retention | Teams                            │
│ Maya Patel · Owner · Active · display from firm administration                 │
│ Priya Shah · Operations · Active · display from firm administration            │
│ Platinum · quarterly · scheduling link: https://… · Annual review              │
└─────────────────────────────────────────────────────────────────────────────┘
~~~

**Components:** SurfaceHeader, tabs, EntityTable, Card, Badge, Chip, Callout, SlidePanel,
ConfirmDialog, Button, EmptyState.

Firm setup is a CRM shell over the existing firm-admin rails. `FirmDirectoryEntry` is
display-only: roles, teams, invitations, deactivation, access, and ethical-wall changes route
to those existing admin surfaces and never edit a CRM document. Deactivation retains
attribution. Service tiers edit ServicePolicy: cadence, custom days, review rule/workflow,
description, and `schedulingLinkUrl`; household exception visibly shows override. Retention
gives category, period, plain consequence, protected compliance/archive policy. Offline safety
checks are read-only; Last synced names the available firm state; error is isolated. g then f
opens Home > Firm; m/r/t, i work.

## 14. Existing surfaces write CRM data

- **Ask:** cited answers render durable ProposalCards backed by the extended
  `ProposalRecord` in [02 §1.15](02-data-model.md#115-proposalrecord-ai-approval-queue):
  `workflow_launch`, `task_create`, `fact_add`, or `communication_draft`. Local approval
  writes CRM; a communication draft routes to the existing mail surface for external
  approval.
- **Meetings:** preserve record pill, consent, notes-left/transcript-right, prep strip.
  One review card offers facts, notes, tasks, workflows, follow-ups. Chip opens exact moment.
- **Documents:** selected text actions Add fact, Create task, Start workflow, Draft follow-up.
  Follow-up is external approval.
- **Email:** remains household-scoped/threaded. Incoming mail may propose local CRM data.
  Outbound checks verified recipients and needs external approval.
- **Intake links:** Home → Firm → Intake links lets a person create a named, scoped intake
  link, choose the responsive fields and confirmation copy, preview it on phone and desktop,
  then copy/share the link. The public form is responsive, plain, and accessible; it collects
  only the selected fields and clearly says who will review it. Submission creates an intake
  record, not a direct household write. Matched submissions route to a household review strip;
  uncertain submissions route to **Match this response** with candidate households and a
  deliberate match/create decision. Extraction proposes dated Facts with the intake source.
  AI-suggested records are reviewed; intentional person-created local records save directly.

## 15. Cross-cutting patterns

### Approval cards

ProposalCard renders one durable `ProposalRecord`, never a generic UI-only suggestion. It
shows its one supported kind, state, rationale, context, and approval outcome. It uses the
record's durable review semantics from [02 §1.15](02-data-model.md#115-proposalrecord-ai-approval-queue)
and [03 §2.3](03-sync-and-notifications.md#23-api-and-delivery-protocol): tracked
green/red change, source chips, changed-since-review automatic unselection, one Approve, durable inline
error/retry, and recoverable dismiss history. `communication_draft` says it will open the
existing mail approval flow; it never blends an outside send with a local record write.

### Internal-only marking

Use all signals: amber border/background; lock plus Internal only; persistent lane; sentence
Never included in client-facing drafts; source picker block in client-facing composer. Screen
reader says Internal only content. Color is never sole signal.

### Sync states

| State | Marker | Meaning |
|---|---|---|
| Live | green dot, Live | Every contributing subscription has reached its watermark. |
| Syncing | blue progress, Syncing | “Showing at least the changes received through 10:42; newer changes may still arrive.” |
| Last synced | amber timestamp | Shows the last received update and last full check where available. |
| Offline | gray cloud, Working offline | Local edits work; delivery waits. |
| Needs attention | red inline Callout | Specific failure; readable local data remains |

### Capacity-honest copy

Use: 6 of 21 open items fit today. Four can wait without affecting a meeting or due date.
You can move this to next week, keep it today, or assign it to someone else.
Never: You are behind. Overdue crisis. Failed SLA. Fix your workload. You must clear this
backlog.

## 16. Freeze-ready implementation checks

1. Propagation uses the canonical revision-set, decision-ledger, conditional-undo rules in
   [03 §4](03-sync-and-notifications.md#4-workflow-template-propagation-d4); this screen does
   not create a second merge rule.
2. Notification screens disclose the accepted relay metadata and preserve the distinction
   between local inbox read state and synced approval state.
3. Open-workflow migration state is never inferred from an API. The guided re-creation
   checklist and attachment exported-or-gap accounting remain required through cutover.
4. Parallel-run writes require live connector proof and external approval. Everything else is
   visibly read-only.
5. External email remains blocked when the existing mail surface cannot confirm a recipient.
6. Retention/archive policy is shown in Firm setup and governs archive-export readiness.
7. Attention-versus-fee begins with a named fee source or plainly says it is missing; it never
   silently estimates.

## End-of-run summary

1. CRM joins the existing three-tab app without a fourth main tab.
2. Every requested surface has route, layout, action, states, and keyboard behavior.
3. Propagation review uses one offer per instance, named revision-set updates, safe partial
   decisions, and conditional undo.
4. Approval, internal-only, provenance, sync, Ask, migration fallbacks, and triage rules are
   shared.
