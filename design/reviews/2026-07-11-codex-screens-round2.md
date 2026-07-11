# Round-2 screens-vs-contracts review — 2026-07-11

1. **SC-1 — MAJOR — Rejected “Practice” IA language remains.**  
   **04 §1/§2/§5/§8/§9 exact text:** “Whole practice,” “[Ask the practice…]” (four wireframes), “Recent practice activity,” and “Your practice is clear for today.”  
   **Violates:** 00 D11.  
   **Minimal fix:** Replace these UI labels with “firm” wording. Keep only `Home · Clients · Ask` as named spaces.

2. **SC-2 — MAJOR — Generic proposals have no durable contract.**  
   **04 §14/§15 exact text:** “Ask: cited answers propose Facts/tasks/workflows/communications in ProposalCard” and “ProposalCard … recoverable dismiss history.”  
   **Violates:** 02 §1.15 defines `ProposalRecord` only for `workflow_launch`; 03 §2.3 only guarantees durable approval/outbox behavior for defined mutations.  
   **Minimal fix:** Either define durable proposal types and states for Facts, Tasks, and communications in 02/03, or limit `ProposalCard` to workflow-launch proposals and existing mail approvals.

3. **SC-3 — MAJOR — Task detail invents unsupported fields and cardinality.**  
   **04 §5 exact text:** “assignees … workflow, comments, Activity history.”  
   **Violates:** 00 D2; 02 §1.6 and §2.3. A Task has one `assigneeUserId`, `contextRefs`, and `body`; it has no `comments` field or `workflow` field.  
   **Minimal fix:** Use singular “assignee,” represent workflow links through `contextRefs`, and either remove task comments or add a defined comment entity/merge contract.

4. **SC-4 — MAJOR — Client-facing Notes are incorrectly treated as outbound mail.**  
   **04 §3 Client Map exact text:** “Draft client-facing note/email | Select verified recipients and create review item. | Proposal then external approval.”  
   **Violates:** 02 §1.5. A `Note` has an immutable audience lane but no recipients or send state; verified recipients belong to `Person.verifiedRecipient`.  
   **Minimal fix:** Make client-facing Notes direct local records. Model outbound email separately through the existing mail surface and its external-approval flow.

5. **SC-5 — BLOCKER — BCC-dropbox is explicitly excluded but the screens promise it.**  
   **04 §3 exact text:** “BCC-dropbox message appears in Email and Timeline” and “BCC mail appears Email/Timeline.”  
   **Violates:** 00 D9; 01 §9, which marks BCC Email Dropbox as a v1 skip because server-side plaintext capture conflicts with E2EE.  
   **Minimal fix:** Remove both promises. Only add a client-side alternative after a separate approved contract.

6. **SC-6 — BLOCKER — Propagation uses the wrong approval unit and omits required per-step decisions.**  
   **04 §7 exact text:** “one PropagationOffer for each changed stable step ID,” “Expanded rows select individual offers,” and “selected offers alone are accepted.”  
   **Violates:** 00 D4; 02 §1.8/§2.4; 03 §4.2. There must be one offer per instance, containing a decision for every changed step/field. Decisions default to accept, support explicit per-step accept/reject toggles, and support batch approve-all.  
   **Minimal fix:** Redesign the review as one instance card → per-step/field toggles, all initially on → explicit “Approve all eligible instances.” Remove offer-per-step language.

7. **SC-7 — BLOCKER — Integer `v7 → v8` UI contradicts revision-set propagation.**  
   **04 §6/§7/§10 exact text:** “published v7,” “Draft v8,” “Onboarding v7 → v8,” “Template v8 proposes,” and “Honored template version advances only when no pending offer remains across intervening versions.”  
   **Violates:** 00 D4; 03 §4.1–§4.2 and P5. The head is a revision graph/set, not a mutable integer version. An instance may display a target revision set only after its full required composed change-set is present.  
   **Minimal fix:** Replace integer-version UI with human-readable revision/update labels backed by revision sets. Show target updates as pending until their complete change-set is present; do not make unrelated pending offers the advancement rule.

8. **SC-8 — BLOCKER — Propagation proposes changing an assignee on a completed step.**  
   **04 §7 exact text:** “Send welcome packet · Priya → CSA · Progress kept: Done” and “Use template owner: CSA.”  
   **Violates:** 03 §4.2, P6, and P10. Propagation never changes a step’s assignee, progress, notes, completion, or outcome. Reassigning after completion creates a new open assignment; it does not rewrite the completed step.  
   **Minimal fix:** Render template owner-role changes as future/default routing only. For a completed step, offer a separate new assignment if needed; never mutate the completed step’s assignee.

9. **SC-9 — BLOCKER — Undo is described as a risky rollback instead of required conditional undo.**  
   **04 §7 exact text:** “Unsafe reversal opens compare/decide.”  
   **Violates:** 00 D4; 03 §4.3 and P7. Undo must automatically restore only untouched derived cells from its own operation and report each untouched-by-undo cell with its reason.  
   **Minimal fix:** Make undo a compensating operation that performs the safe partial undo, then reports “not undone because later template work exists.” Do not require a merge decision for those protected cells.

10. **SC-10 — BLOCKER — Migration lacks both mandatory non-API fallback screens.**  
    **04 §11 exact text:** the migration surface offers only “Review fidelity report” and generic “drillable skipped rows.”  
    **Violates:** 05 §2.5a, §2.5b, and §3.2. There is no in-flight-workflow checklist showing source template, client, activity evidence, operator decision, resulting Lantern instance, and unresolved trace. There is also no per-client attachment exported-or-gap surface.  
    **Minimal fix:** Add two explicit migration/fidelity routes: guided workflow re-creation and attachment accounting. Both must remain visible through cutover until resolved or explicitly recorded as gaps.

11. **SC-11 — MAJOR — “Workflows” are incorrectly promised as a parallel-run mirror.**  
    **04 §11 exact text:** “opportunities/workflows/projects/unsupported fields say Read-only mirror until cutover.”  
    **Violates:** 05 §2.5a and §4.2. Open workflow state is not API-readable in v1 and must not be presented as an API-derived mirror.  
    **Minimal fix:** Limit the mirror to readable workflow templates and activity traces. Route in-flight workflows to the guided re-creation checklist.

12. **SC-12 — MAJOR — Freshness states are weaker than the sync contract.**  
    **04 §15 exact text:** “Current … Current known local index”; screens use “Synced just now” and “Mirror current.”  
    **Violates:** 03 §5. A view is authoritative only after every contributing subscription reaches its watermark; while catching up it is a visible lower-bound. Required states include Live, Syncing, Last synced, and Offline.  
    **Minimal fix:** Add `Syncing / partial data` state and lower-bound wording. Reserve “current/live” for views whose contributing subscriptions have reached their watermarks.

13. **SC-13 — MAJOR — Notification UI overstates relay metadata and read-state guarantees.**  
    **04 §10 exact text:** “Relay learns only pending count/timing,” “Marking activity read changes encrypted member read state only,” and “Read/unread is encrypted member state.”  
    **Violates:** 03 §2.1–§2.5. The relay also sees recipient, timestamps, ciphertext-size band, delivery/ack timing, and opaque IDs. General inbox read state is durable per recipient device; 02 only defines encrypted record-side `NoteMention.notifyState`.  
    **Minimal fix:** Correct the metadata disclosure. Make ordinary read/unread local inbox state, not synchronized member state; retain authoritative approval visibility from synced records.

14. **SC-14 — MAJOR — Pipeline configuration has no screen.**  
    **04 §8 exact text:** “Stage drag is direct. Stage can propose linked workflow.”  
    **Violates:** 02 §1.14; 01 §6. `PipelineDef`, `StageDef`, ordering, status effects, and `StageTriggerRule` are first-class user-configured entities, but no configuration route exists.  
    **Minimal fix:** Add Pipeline settings for creating/editing/ordering pipelines and stages, and for configuring stage-entry/exit workflow proposal rules.

15. **SC-15 — MAJOR — Template editor omits required schedules and outcomes.**  
    **04 §6 exact text:** “Create/edit/reorder/soft-remove steps, roles, assignees, due offsets, required, category, trigger hints, tags.”  
    **Violates:** 02 §1.7; 01 §5. The list omits `WorkflowTemplate.schedule` and `StepDef.outcomes`, despite scheduled workflows and branch/restart outcomes being replicate features.  
    **Minimal fix:** Add a schedule editor and per-step outcome/branch editor to Templates.

16. **SC-16 — MAJOR — Imported legacy Projects disappear from the screen contract.**  
    **04 §8 exact text:** “Projects fold into workflows/tasks.”  
    **Violates:** 00 D9; 01 §7; 05 §3.2. Imported Wealthbox Projects must remain read-only legacy records with optional manual conversion, never be silently folded away.  
    **Minimal fix:** Add a read-only Legacy Projects view with an explicit manual “start a workflow from this” action.

17. **SC-17 — MAJOR — Note and activity collaboration features have no usable surface.**  
    **04 §3/§10 exact text:** “Add internal note,” “Mention offers recipient chip review,” and the Activity screen is only “detailed ActivityEvent list.”  
    **Violates:** 02 §1.5; 01 §§3 and 11. No note editor exposes pinning, @mentions, or explicit firm-wide notification review. No activity-comment composer exists, and no comment entity is defined.  
    **Minimal fix:** Add a Note editor with pin, mention, and explicit notification controls. Add a defined activity-comment model plus composer, or revise the feature matrix verdict.

18. **SC-18 — MAJOR — Firm setup treats the directory read-model as editable authority.**  
    **04 §13 exact text:** “Roles Owner/Admin/Member” and “all else direct local firm-doc edit by role.”  
    **Violates:** 02 §1.16 and 00 D9. `FirmDirectoryEntry` is display-only; existing firm-admin, team, and key-membership rails remain the authority.  
    **Minimal fix:** Make Firm setup a shell over those existing admin rails. Do not present roles, teams, or access changes as CRM-document edits.

19. **SC-19 — MAJOR — Defined firm records and field values lack user surfaces.**  
    **04 §12 exact text:** “Admins create/edit/archive CustomFieldDef” and §13’s limited configuration tabs.  
    **Violates:** 02 §§1.11 and 1.13; 01 §2. The screens define custom-field definitions but not editing values on Household, Person, Account, and Task records. They also provide no surface for `FirmDoc` process documents, note templates, or report layouts.  
    **Minimal fix:** Add contextual custom-field/tag editors to each applicable record, plus a Firm documents/templates surface.

20. **SC-20 — MAJOR — Responsive intake links are referenced but not designed.**  
    **04 §14 exact text:** “Intake: matched response makes review strip.”  
    **Violates:** 01 §§13–14. Phone-shaped needs are explicitly handled through responsive intake-style links, not a mobile app. No intake-link creation, public form, mobile layout, or submission-review route is specified.  
    **Minimal fix:** Add a responsive intake-link flow and its internal matching/review screen.

21. **SC-21 — MAJOR — Service-tier-aware scheduling links have no screen or data home.**  
    **04 §3/§13 exact text:** Service tiers show “cadence, next review, and linked review workflow,” while Firm setup lists only cadence and review rule/workflow.  
    **Violates:** 01 §8 and §13. The required service-tier-aware Calendly/scheduling-link improvement is absent.  
    **Minimal fix:** Add a scheduling-link field to the relevant ServicePolicy contract and expose it in Firm setup and household scheduling actions.

22. **SC-22 — MAJOR — Data portability is not reachable.**  
    **04 §11 exact text:** “[Open frozen archive manifest]” and “rollback export” appears only as a cutover prerequisite.  
    **Violates:** 01 §17 and 05 §5. The required frozen/decrypted archive export and rollback outputs need user actions, not just a manifest viewer and prose.  
    **Minimal fix:** Add explicit archive-export and rollback-export actions with their readiness/status screens.

VERDICT: NOT-READY (6 blockers)
