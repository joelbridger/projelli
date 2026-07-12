# Built CRM screens: independent UX audit

## What I reviewed

I compared the frozen screen intent in `design/04-screens-end-to-end.md` with the built Home and Clients screens in `src/features/crm-home/` and `src/features/crm-clients/`.

This is a design audit, not a check that every frozen requirement was implemented. The question here is simpler: would a financial advisor feel clear, helped, and safe using these screens?

The core finding: the screens have many of the right building blocks, but the highest-stakes moments do not yet earn trust. Today presents invented-looking totals instead of the advisor's actual morning. Propagation exposes system language. Migration reports problems honestly, but makes the firm translate them into technical terms before it can act.

Research grounding:

- Advisors need dated, source-backed current information. Staleness sharply reduces trust. E-066, E-067, E-072.
- Review must be quick, human-readable, and explicitly controlled by a person who knows the client. E-027, E-036, E-038, E-062.
- Equal-weight task lists are a known failure. The desired morning view is helpful triage, not scolding. E-119, E-121, E-122.
- Small language mismatches stop comprehension before value is clear. E-001 through E-006, especially E-001's preference for “firm,” not “practice.”

## P0: fix before an advisor sees it

### P0-1: Today looks authoritative even when it has no real plan

**File:** `src/features/crm-home/CrmHome.tsx:163-170`, `:116-118`, `:180-183`

**Problem:** The screen says “6 of 21 open items fit today,” “2 local changes need approval,” and shows named firm activity even when the non-preview adapter contains zero tasks, offers, and migration records. The review panel then has no rows. Tasks repeats the same “6 of 21” claim and falls back to “No tasks match these filters.” This is worse than an empty state: it makes an advisor wonder whether the screen is stale, broken, or quietly showing sample data.

**Why it matters:** Morning triage is supposed to solve the equal-weight task-list problem, not create another one. Advisors welcomed capacity-aware help only when it is credible and non-judgmental (E-119, E-121, E-122). A number that does not visibly come from their work also damages the freshness trust the product needs for any “what is current?” claim (E-066, E-067, E-072).

**Concrete fix:** Drive every count, row, and activity item from the same adapter data. Make the first card the actual prioritized list, with a reason under each item, such as “Due today” or “Before Henderson review Thursday.” When there is no data, show one honest state: “Your firm is ready to set up Today. Add tasks or finish your import.” Give it `New task` and `Open migration` actions. Never show fixed example counts outside visibly labelled preview mode.

### P0-2: Workflow update review speaks in internal machinery, not advisor decisions

**File:** `src/features/crm-home/CrmHome.tsx:218-239`, especially `:221`, `:227`, `:235`, and `:239`

**Problem:** The review uses phrases such as “concurrent updates,” “stable step ID,” “derived fields,” “apply payload,” “protected progress,” “descendant update,” and “instance.” An advisor has to decode system concepts before deciding a simple business question: should this workflow change affect this household's open work?

**Why it matters:** This is a high-consequence approval moment. Advisors want a human who knows the client to make the call, but reviewer time is scarce and long or poorly formatted review creates abandonment (E-027, E-036, E-038, E-062). The research also describes a real failure where template changes do not reach open workflows (E-098, E-099). This screen should make that problem safer, not turn it into a technical puzzle.

**Concrete fix:** Translate the screen into a decision-first summary. For example: “Henderson household: this update changes two future steps. Work already done stays as it is.” Each row should say “Move due date from June 5 to June 9” or “Send new work to Operations,” followed by a plain reason. Replace “concurrent update” with “This workflow was changed in two places. Compare the two dates before choosing.” Put technical record details behind a quiet “Details for support” disclosure. Change the success message to “12 workflow updates are ready to apply. Completed work and notes will not change.”

### P0-3: Migration shows the right gaps but makes a firm feel responsible for the software's vocabulary

**File:** `src/features/crm-home/CrmHome.tsx:263-282`

**Problem:** The migration path uses “API,” “operator,” “resulting instance,” “trace gap,” “raw-capture checksums,” “manifest,” and “engine.” The fidelity report says 12 notes were skipped, one workflow needs a decision, and two attachments have gaps, but offers no direct, named action for the 12 skipped notes. A firm is left with counts, several technical routes, and a long cutover rule instead of a simple answer to “What is missing, who needs to decide, and is it safe to move on?”

**Why it matters:** A migration is a trust test. Advisors are anxious about incorrect data spreading and about changes happening without their review (E-028, E-058). They also judge the product first on whether they can use it, before whether it is useful (research recommendation B5, supported by E-001 through E-006). Honest gaps are good. Making the firm translate them into system language is not.

**Concrete fix:** Make the fidelity report the control center. Lead with a human status: “Not ready to switch yet: 15 items need your firm’s decision.” Split it into three action cards: “12 notes we could not bring over,” “1 active workflow to rebuild,” and “2 attachments to account for.” Each card opens the exact list and says what to do in one sentence. Rename the checklist actions to “Rebuild this workflow in Lantern” and “Mark this attachment exported” / “Explain this missing attachment.” Keep checksums, manifests, and connector details in an expandable “Import details” section for administrators.

## P1: important improvements to make the product feel dependable

### P1-1: Freshness is a global badge, not proof for the information in front of the advisor

**File:** `src/features/crm-home/CrmHome.tsx:132-146`; `src/features/crm-clients/HouseholdRecordSurface.tsx:36-52, 93-103`

**Problem:** A single banner says “Live,” “Syncing,” or “Last synced,” but Live has no time, the household badge has no time or source at all, and the state is not attached to the facts, tasks, or imported records it is meant to qualify. “Every contributing subscription has caught up” also asks an advisor to understand subscriptions rather than what they can trust.

**Why it matters:** The product's central promise is current information with proof. Freshness is a trust cliff, not decorative status (E-066, E-067, E-072). A generic green dot can falsely reassure someone looking at an old imported fact.

**Concrete fix:** Use one compact, plain-language trust strip per relevant surface: “Client Map is current through 10:42 today. Wealthbox checked at 02:15.” On a fact or imported task, show its own source and last update where it changes interpretation. Use “Getting the latest changes” instead of “Syncing,” and “We are offline. You can keep working; changes will send when you reconnect” with a count of waiting changes. Keep the error beside the affected source and offer `Try again` there.

### P1-2: Empty, loading, and recovery states are mostly absent or misleading

**File:** `src/features/crm-home/CrmHome.tsx:183, 242-254`; `src/features/crm-clients/DirectorySurface.tsx:101-124`; `src/features/crm-clients/HouseholdRecordSurface.tsx:266-389, 393-451`

**Problem:** Empty directories say “No households match this search” even for a brand-new firm. The People view can render nothing at all. Empty account and people sections are blank. Documents, meetings, timeline, and activity collapse into a generic “No history yet,” while the built Home routes largely render permanent sample-like cards. There are no useful loading skeletons, source-specific retries, or clear offline states in these surfaces.

**Why it matters:** The frozen experience makes each state teach the next safe action. Without that, a new firm cannot distinguish “nothing exists,” “the import is still running,” “this filter hid it,” and “we cannot reach the source.” That ambiguity directly undermines the source-of-truth promise (E-104, E-128) and makes an already busy reviewer do extra detective work (E-038).

**Concrete fix:** Give each surface four deliberately different states: first-use, no-result, updating, and problem. Example for Directory: “No households yet. Finish your import or add your first household.” Example for Timeline: “No recorded history yet. Add a note, task, or fact.” Preserve readable local content while updating; use skeletons only while the section genuinely has no usable data. Put `Try again` next to the failed source, never as a detached generic message.

### P1-3: Client Map is a stack of equal cards rather than a glanceable client brief

**File:** `src/features/crm-clients/HouseholdRecordSurface.tsx:266-389`

**Problem:** Facts, accounts, people, and both note audiences have equal visual weight in a long vertical stack. The important working context, such as next review, open work, current key facts, account purpose, and internal context, is not grouped into a quick first read. A rich household becomes a scroll exercise instead of a briefing.

**Why it matters:** Advisors want the system to help them avoid asking clients things twice and show the current story with proof (E-014 through E-017, E-066, E-067). The research's “inside scoop” is important, but it must be strongly separated from client-facing information (E-050 through E-052, E-034). Equal cards make both priorities harder to scan.

**Concrete fix:** Make a two-column desktop brief. Start with a “For the next conversation” area: next review, open commitments, service tier, and the few key current facts with dates and citations. Put accounts and people beneath it. Keep “Internal only” as a persistent amber lane, visually distinct and collapsed to a short preview when long; keep the client-facing lane adjacent but clearly separate. On narrow screens, preserve that order rather than simply stacking all four cards.

### P1-4: Keyboard support is partial and unpredictable in the screens that promise fast work

**File:** `src/features/crm-home/CrmHome.tsx:163-199, 286-298`; `src/features/crm-clients/DirectorySurface.tsx:89-94, 139-144`

**Problem:** The app implements only a small part of the promised shortcuts. Today has no row navigation or Enter-to-open. Review has no keyboard way to choose Accept or Reject. Task board movement relies on double-click. The global listener ignores inputs but not textareas or selects, so typing in a note or choosing a field can trigger a route shortcut. Panels do not visibly move focus into the opened work.

**Why it matters:** At 8am, fast movement between a task, household, and approval should feel calm and reliable. Incomplete shortcuts are worse than no shortcuts when they interrupt note-taking or require mouse-only actions. The review bandwidth problem in E-038 and E-062 makes this especially costly.

**Concrete fix:** Implement the frozen shortcuts as one complete system: visible focus, j/k row movement, Enter open, r review, c complete, and ? help. Suspend global shortcuts for every editable control, including textarea and select. Use buttons or a clear move menu for board movement, not double-click. When a side panel opens, move focus to its heading or first meaningful control and return it on close.

### P1-5: The notification panel leaks technical privacy details before the useful work

**File:** `src/features/crm-home/CrmHome.tsx:299-302`

**Problem:** The first notification is followed by “ciphertext,” size bands, “opaque id,” “relay,” and delivery/ack mechanics. This pushes the advisor's actual task below privacy implementation detail. It also makes a small notification panel feel like a debugging tool.

**Why it matters:** Advisors need safe handoffs and clear approvals, not more systems to interpret (E-049, E-053). The privacy boundary matters, but review must remain lightweight (E-038, E-062).

**Concrete fix:** Show the practical content first: task, household, sender context when available, and action. Place a single `How this stays private` link in the panel. That disclosure can explain the metadata in plain language for people who need it, while the normal inbox remains about work.

## P2: polish that will prevent avoidable friction

### P2-1: Several labels sound like product documentation instead of advisor language

**File:** `src/features/crm-home/CrmHome.tsx:205-206, 242-252, 256-282, 297-299`; `src/features/crm-clients/HouseholdRecordSurface.tsx:393-451`

**Problem:** Examples include “Versioned ways of working,” “project container,” “firm configuration,” “display-only shell,” “external writes,” “source API,” “tracked diff,” “recipient verification flow,” and “existing surface.” None uses the banned word “practice,” which is good, but several still explain the product's internals instead of the advisor's next action.

**Why it matters:** Research found that language mismatches break comprehension before the benefit lands, and specifically asks for “firm,” not “practice” (E-001 through E-006). Advisors first ask “Can we use it?”

**Concrete fix:** Rewrite supporting copy around an action and outcome. For example: “Edit the steps your firm follows,” “Potential client work,” “Set up shared fields,” “Open firm admin,” “Changes outside Lantern need your approval,” and “Open email to check the recipient before drafting.” Keep implementation terms out of default copy.

### P2-2: The task list compresses the decision into one weak text line

**File:** `src/features/crm-home/CrmHome.tsx:188-194`

**Problem:** Household, priority, due date, and assignee are all squeezed after a dot separator in muted text. Urgent money movement can look almost identical to routine work, recreating the equal-weight problem the product is meant to solve.

**Why it matters:** Equal task weight is a direct research pain (E-119). Advisors want the system to apply the judgment currently trapped in people's heads (E-122).

**Concrete fix:** Use a compact task row with a strong due-time/meeting cue, a visible priority treatment, household as a clickable context link, and one brief “why today” label. Keep quiet work visually quiet without using shame-oriented red overload.

### P2-3: No dark-theme issue found in this audit scope, but light-theme resilience is not demonstrated

**File:** `src/features/crm-home/CrmHome.tsx:129-160, 302`; `src/features/crm-clients/HouseholdRecordSurface.tsx:356-387`; `src/features/crm-clients/NoteEditor.tsx:30-52`

**Problem:** I found no dark-mode branch or dark-surface assumption in the reviewed screens. The code generally uses the light design tokens and white/light backgrounds. However, several important states rely on inline amber, teal, and red color values without a visible contrast or non-color check in this audit.

**Why it matters:** Light mode is the product requirement. Internal-only content and errors must remain unmistakable without relying on color alone, especially in dense client records.

**Concrete fix:** Keep the light theme as the only supported default. Test the amber internal lane, teal client-facing lane, sync states, and error borders at normal advisor screen brightness. Retain the written labels and lock icon already present; do not introduce a dark-mode variant as part of this work.

## The five changes I would make first

1. Replace Today’s fixed counts and sample activity with real ranked work, clear reasons, and an honest first-use state.
2. Rewrite Propagation Review around plain-language business decisions, hiding all graph and payload language behind optional support details.
3. Turn the Fidelity Report into one action dashboard for the 12 skipped notes, active workflow decisions, and attachment gaps.
4. Make freshness local and dated: show what is current through when, for the exact client record or source being viewed.
5. Add distinct first-use, empty, updating, offline, and retry states to Directory, Client Map, Timeline, and Home.
