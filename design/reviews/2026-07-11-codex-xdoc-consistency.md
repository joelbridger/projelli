Read-only cross-document review complete. I found 20 issues: 9 BLOCKER, 10 MAJOR, 1 MINOR.

1. **BLOCKER — Required screen and master contracts are missing.**  
   Docs: Charter; all five specs.  
   The charter requires `04-screens-end-to-end.md`, `00-master-spec.md`, and `SPEC-FREEZE.md`. None exist. That means no feature has an agreed screen/flow home yet, and the promised place to settle lane disagreements does not exist.  
   Fix: create those three design deliverables before freezing. The screens spec must map every user-facing 01 feature to a screen and its backing entities.

2. **BLOCKER — The two core docs disagree on where CRM data lives and how it syncs.**  
   Docs: 02 §§2.2, 2.5, 3.2; 03 §§1.1–1.4.  
   02 says one Yjs document per entity, using streams such as `crm/tasks` under each household matter. 03 chooses one Yjs document per collection, using streams such as `crm:tasks`, with task shells in a firm-wide matter. Their database designs also assume different truth units.  
   Fix: choose one topology. Update 02’s `crm_docs`, cursor, projection, and SQL rules to match it exactly.

3. **BLOCKER — Task contracts do not match.**  
   Docs: 02 §1.6, §2.4; 03 §§1.2–1.4, §3; 06 §2.  
   02 defines `assigneeIds`, statuses `open/in_progress/done/cancelled`, `householdId`, and a full task record. 03 defines one `assignee_user_id`, statuses `todo/doing/done/blocked`, `client_matter_id`, plus a split shell/body design. 06 writes tests against both shapes.  
   Fix: publish one canonical Task schema, status list, assignee rule, and firm-shell mapping. Make all three docs use it.

4. **BLOCKER — Merge rules are contradictory, and `[DM-fields]` is still a placeholder.**  
   Docs: 02 §§2.2–2.4; 03 opening contract, §3.4, §7 Q6.  
   02 requires explicit HLC timestamps for last-writer-wins fields. 03 says not to add HLCs and to use Yjs internal clocks. 03 also needs a per-entity `rev`, but 02 has no `rev` field.  
   Fix: make a named, versioned “field merge contract” table in 02 and reference that section directly from 03. Add `rev` if retained, or remove it from 03 and replace its use with a defined alternative.

5. **BLOCKER — Workflow propagation is two incompatible products.**  
   Docs: 02 §§1.8, 2.7; 03 §4; 06 §§1.5, 2.2, 3.2.  
   02 creates one `PropagationOffer` per changed step, with per-step accept/reject decisions. 03 creates one per-instance checkbox and applies an entire version diff. 02 uses `pendingPropagations`, `templateVersion`, and task-linked progress; 03 uses `templateVersionApplied`, `templateFieldsRev`, `detachedFromTemplate`, and undo events.  
   Fix: select one approval unit: per-step or per-instance. Then publish one shared instance shape, offer/event shape, undo rule, and version field names.

6. **BLOCKER — The ten required propagation properties are not represented one-for-one in the test plan.**  
   Docs: 03 §4.6; 06 §1.5.  
   03 defines P1–P10. 06 only specifies four broad tests. It misses explicit tests for idempotency, version pinning, undo scope, added-step uniqueness, monotonic versions, and reassign-after-complete. It also invents “bounded blast radius,” which is useful but is not one of 03’s ten named properties.  
   Fix: create ten named Layer-1 tests, one for each P1–P10, then add extra tests separately.

7. **BLOCKER — Notification metadata exceeds the charter’s locked privacy promise.**  
   Docs: Charter decision 3; 03 §§2.1, 2.6.  
   The charter says the relay learns only that a member has pending envelopes, plus timing/count metadata. 03 stores `sender_seat` and explicitly admits the server can learn who directs work to whom. That is more than the locked promise.  
   Fix: remove persisted sender identity from `notify_envelopes`; keep sender identity inside encrypted content. If rate limiting needs sender identity, use short-lived server-side enforcement without retaining a sender-to-recipient history.

8. **MAJOR — Notification wall behavior and its test disagree.**  
   Docs: 03 §§1.2, 2.4, 2.7; 06 §1.3.  
   03 intentionally sends firm-home task notifications to all firm members, including someone walled from the client content. 06 requires that a walled member never receives any envelope for that matter. Both cannot be true. Also, 03’s send endpoint only requires any shared matter, so a sender could send a client-key envelope to a recipient who can never decrypt it.  
   Fix: define notification eligibility per type. Prevent a client-confidential envelope from being sent unless the recipient holds that client matter key. Update the test to distinguish firm operational notices from client-confidential notices.

9. **MAJOR — Checkpoint deletion can violate the five-year retention posture.**  
   Docs: 02 §6.2; 03 §6.4.  
   02 says soft-deleted CRM records remain recoverable through the retention period. 03 allows checkpoint compaction to hard-remove tombstones after an unspecified “checkpoint horizon.”  
   Fix: prohibit hard deletion before the approved retention period, preserve audit/export history, and define one retention policy with an admin-approved purge process.

10. **BLOCKER — Migration does not have a settled landing contract into the new CRM core.**  
    Docs: 02 §§3–4; 05 §§2.1–2.2.  
    05 describes extending the old SQL mirror and its `crm_key()` records. 02 requires app-minted IDs, `external_refs`, CRDT documents, and a new SQLCipher index. No handoff from raw Wealthbox objects into the new core is defined.  
    Fix: add a mapping pipeline: raw response → typed source record → Lantern entity/CRDT mutation → `external_refs` projection. Make this the only idempotency rule.

11. **MAJOR — Multi-household links conflict with the external-ID rule.**  
    Docs: 02 §3.2, §4.4; 05 §2.2.  
    05’s current importer stores a note once per linked household using IDs like `note:<id>@<household>`. 02 permits only one `(provider, external_id)` mapping, and a Note has one `householdId`.  
    Fix: choose either one cross-household note with many links, or separate imported copies with a composite source reference. Update uniqueness and confidentiality rules accordingly.

12. **MAJOR — Raw migration archives have no defined relationship to Lantern records.**  
    Docs: 02 `Provenance`/`ExternalRef`; 05 §§2.1, 3, 5.  
    05 correctly requires verbatim raw JSON and a frozen archive. 02 has `importBatchId`, but no raw-record ID, archive manifest entity, or way to trace a CRM record back to a precise archived payload.  
    Fix: add an immutable import-batch/archive manifest and `rawRecordRef` to imported entities.

13. **BLOCKER — The docs authorize real data despite the charter banning it.**  
    Docs: Charter ground rules; 05 §§2, 7; 06 §0.  
    05 calls for a live token against a “real or sandbox” workspace. 06 calls its importer fixture a real 229-contact export. The charter permits only fabricated Northcrest data and synthetic fixtures.  
    Fix: use only a sandbox/demo workspace populated with approved synthetic data. Remove “real” from the test plan unless the data is formally confirmed fabricated and scrubbed.

14. **MAJOR — Many 01 parity features have no data-model home.**  
    Docs: 01; 02; 03; 05.  
    Missing explicit homes include:

    - Contact Roles distinct from household member roles.
    - Note mentions and “notify everybody” recipient state.
    - Semantic/full-text note search index.
    - Capacity, workload, effort, and meeting-proximity inputs for task triage.
    - Scheduled workflows, branching/restart outcomes, step comments, and contact actions.
    - AI-proposed workflow launches and approval records.
    - Pipeline definitions, stages, and stage-triggered workflow rules.
    - Calendly/service-tier scheduling links.
    - Email records, BCC dropbox capture, and email-to-household links.
    - Attention-versus-fee inputs.
    - Activity comments, likes, and reactions.
    - Record attachment references on Notes, Tasks, and Contacts.
    - DocuSign tracking status.
    - Teams, member roles, default permissions, and group membership.
    - Self-service CSV/Excel/vCard/Outlook import jobs and mappings.

    Fix: add entities or explicit integrations for each item, or change 01 from REPLICATE/IMPROVE to a documented exclusion.

15. **MAJOR — Opportunity, pipeline, and Project decisions are unfinished.**  
    Docs: 01 §§6–7; 02 §1.14; 05 §2.1.  
    02 says a pipeline can be a FirmDoc-like object “or” a new entity. That is not a frozen contract. 01 says Projects fold into Tasks/Workflows, while 05 plans to fetch and preserve Projects as a source object.  
    Fix: define `PipelineDef`, `StageDef`, and workflow trigger rules. State exactly how each imported Project becomes a Workflow, Task set, or preserved legacy record.

16. **MAJOR — Calendar, email, and files have conflicting ownership stories.**  
    Docs: 01 §§8–9, 12; 02 §§3.5, 4.4; 05 §2.5; 06 §3.  
    01 says calendar/events and email parity are required. 02 deliberately has no editable event entity and sends imported events into ActivityEvent. It also only provides a generic workspace pointer for attachments. 05 treats Wealthbox attachments as likely non-goal, while 06 expects file/email/meeting content in the Day-1 import.  
    Fix: define which system owns calendar events, emails, BCC capture, and attachments; then give each a storage/linking/import contract.

17. **MAJOR — User, Team, and permission imports have no destination model.**  
    Docs: 01 §16; 02 EntityKind; 05 §2.1.  
    05 plans to import Users, Teams, and Categories. 02 has no User, Team, Role, Group, or permission entity. `ActorRef` is only a small reference, not firm membership data.  
    Fix: either define firm-directory and permission configuration entities, or state these remain on existing firm-admin rails and provide explicit import mappings.

18. **MAJOR — Migration fidelity means different things in 05 and 06.**  
    Docs: 05 §3.2; 06 §4.  
    05’s “records that matter” are households, contacts, notes, tasks, events, and opportunities tied to active clients. 06 uses households, people, accounts, content-bearing tasks, and open workflows, but omits events and opportunities. It also tries to judge all those records using a contacts-only fixture.  
    Fix: create one shared fidelity matrix: source type, target entity, fixture source, required completeness, and allowed skip reasons.

19. **MAJOR — The Layer-1 data-model test contradicts the model and omits entities.**  
    Docs: 02 §§1, 5; 06 §1.1.  
    02 allows `Provenance.sources` to be empty and requires `Fact.asOf` plus `observedAt`. 06 requires a non-empty source and a vague singular “date.” It also says “every entity” but omits ActivityEvent, FirmDoc, Tag, CustomFieldDef, Opportunity, and SavedView.  
    Fix: make tests match the actual required fields and enumerate every `EntityKind`.

20. **MINOR — Stale “not landed yet” wording leaves real contracts dangling.**  
    Docs: 03 opening and §7 Q6; 05 introduction; 06 §§1.5, 6.2, 7.  
    03 still calls `[DM-fields]` a placeholder. 05 says 02 had not landed. 06 says 03 §4 does not yet exist. All three are now present, but their promised reconciliation never happened.  
    Fix: replace those placeholders with exact section links and remove obsolete “future reconciliation” language.

**Summary:** 20 findings total — **9 BLOCKER, 10 MAJOR, 1 MINOR.**

DONE-EXIT
Read-only cross-document review complete. I found 20 issues: 9 BLOCKER, 10 MAJOR, 1 MINOR.

1. **BLOCKER — Required screen and master contracts are missing.**  
   Docs: Charter; all five specs.  
   The charter requires `04-screens-end-to-end.md`, `00-master-spec.md`, and `SPEC-FREEZE.md`. None exist. That means no feature has an agreed screen/flow home yet, and the promised place to settle lane disagreements does not exist.  
   Fix: create those three design deliverables before freezing. The screens spec must map every user-facing 01 feature to a screen and its backing entities.

2. **BLOCKER — The two core docs disagree on where CRM data lives and how it syncs.**  
   Docs: 02 §§2.2, 2.5, 3.2; 03 §§1.1–1.4.  
   02 says one Yjs document per entity, using streams such as `crm/tasks` under each household matter. 03 chooses one Yjs document per collection, using streams such as `crm:tasks`, with task shells in a firm-wide matter. Their database designs also assume different truth units.  
   Fix: choose one topology. Update 02’s `crm_docs`, cursor, projection, and SQL rules to match it exactly.

3. **BLOCKER — Task contracts do not match.**  
   Docs: 02 §1.6, §2.4; 03 §§1.2–1.4, §3; 06 §2.  
   02 defines `assigneeIds`, statuses `open/in_progress/done/cancelled`, `householdId`, and a full task record. 03 defines one `assignee_user_id`, statuses `todo/doing/done/blocked`, `client_matter_id`, plus a split shell/body design. 06 writes tests against both shapes.  
   Fix: publish one canonical Task schema, status list, assignee rule, and firm-shell mapping. Make all three docs use it.

4. **BLOCKER — Merge rules are contradictory, and `[DM-fields]` is still a placeholder.**  
   Docs: 02 §§2.2–2.4; 03 opening contract, §3.4, §7 Q6.  
   02 requires explicit HLC timestamps for last-writer-wins fields. 03 says not to add HLCs and to use Yjs internal clocks. 03 also needs a per-entity `rev`, but 02 has no `rev` field.  
   Fix: make a named, versioned “field merge contract” table in 02 and reference that section directly from 03. Add `rev` if retained, or remove it from 03 and replace its use with a defined alternative.

5. **BLOCKER — Workflow propagation is two incompatible products.**  
   Docs: 02 §§1.8, 2.7; 03 §4; 06 §§1.5, 2.2, 3.2.  
   02 creates one `PropagationOffer` per changed step, with per-step accept/reject decisions. 03 creates one per-instance checkbox and applies an entire version diff. 02 uses `pendingPropagations`, `templateVersion`, and task-linked progress; 03 uses `templateVersionApplied`, `templateFieldsRev`, `detachedFromTemplate`, and undo events.  
   Fix: select one approval unit: per-step or per-instance. Then publish one shared instance shape, offer/event shape, undo rule, and version field names.

6. **BLOCKER — The ten required propagation properties are not represented one-for-one in the test plan.**  
   Docs: 03 §4.6; 06 §1.5.  
   03 defines P1–P10. 06 only specifies four broad tests. It misses explicit tests for idempotency, version pinning, undo scope, added-step uniqueness, monotonic versions, and reassign-after-complete. It also invents “bounded blast radius,” which is useful but is not one of 03’s ten named properties.  
   Fix: create ten named Layer-1 tests, one for each P1–P10, then add extra tests separately.

7. **BLOCKER — Notification metadata exceeds the charter’s locked privacy promise.**  
   Docs: Charter decision 3; 03 §§2.1, 2.6.  
   The charter says the relay learns only that a member has pending envelopes, plus timing/count metadata. 03 stores `sender_seat` and explicitly admits the server can learn who directs work to whom. That is more than the locked promise.  
   Fix: remove persisted sender identity from `notify_envelopes`; keep sender identity inside encrypted content. If rate limiting needs sender identity, use short-lived server-side enforcement without retaining a sender-to-recipient history.

8. **MAJOR — Notification wall behavior and its test disagree.**  
   Docs: 03 §§1.2, 2.4, 2.7; 06 §1.3.  
   03 intentionally sends firm-home task notifications to all firm members, including someone walled from the client content. 06 requires that a walled member never receives any envelope for that matter. Both cannot be true. Also, 03’s send endpoint only requires any shared matter, so a sender could send a client-key envelope to a recipient who can never decrypt it.  
   Fix: define notification eligibility per type. Prevent a client-confidential envelope from being sent unless the recipient holds that client matter key. Update the test to distinguish firm operational notices from client-confidential notices.

9. **MAJOR — Checkpoint deletion can violate the five-year retention posture.**  
   Docs: 02 §6.2; 03 §6.4.  
   02 says soft-deleted CRM records remain recoverable through the retention period. 03 allows checkpoint compaction to hard-remove tombstones after an unspecified “checkpoint horizon.”  
   Fix: prohibit hard deletion before the approved retention period, preserve audit/export history, and define one retention policy with an admin-approved purge process.

10. **BLOCKER — Migration does not have a settled landing contract into the new CRM core.**  
    Docs: 02 §§3–4; 05 §§2.1–2.2.  
    05 describes extending the old SQL mirror and its `crm_key()` records. 02 requires app-minted IDs, `external_refs`, CRDT documents, and a new SQLCipher index. No handoff from raw Wealthbox objects into the new core is defined.  
    Fix: add a mapping pipeline: raw response → typed source record → Lantern entity/CRDT mutation → `external_refs` projection. Make this the only idempotency rule.

11. **MAJOR — Multi-household links conflict with the external-ID rule.**  
    Docs: 02 §3.2, §4.4; 05 §2.2.  
    05’s current importer stores a note once per linked household using IDs like `note:<id>@<household>`. 02 permits only one `(provider, external_id)` mapping, and a Note has one `householdId`.  
    Fix: choose either one cross-household note with many links, or separate imported copies with a composite source reference. Update uniqueness and confidentiality rules accordingly.

12. **MAJOR — Raw migration archives have no defined relationship to Lantern records.**  
    Docs: 02 `Provenance`/`ExternalRef`; 05 §§2.1, 3, 5.  
    05 correctly requires verbatim raw JSON and a frozen archive. 02 has `importBatchId`, but no raw-record ID, archive manifest entity, or way to trace a CRM record back to a precise archived payload.  
    Fix: add an immutable import-batch/archive manifest and `rawRecordRef` to imported entities.

13. **BLOCKER — The docs authorize real data despite the charter banning it.**  
    Docs: Charter ground rules; 05 §§2, 7; 06 §0.  
    05 calls for a live token against a “real or sandbox” workspace. 06 calls its importer fixture a real 229-contact export. The charter permits only fabricated Northcrest data and synthetic fixtures.  
    Fix: use only a sandbox/demo workspace populated with approved synthetic data. Remove “real” from the test plan unless the data is formally confirmed fabricated and scrubbed.

14. **MAJOR — Many 01 parity features have no data-model home.**  
    Docs: 01; 02; 03; 05.  
    Missing explicit homes include:

    - Contact Roles distinct from household member roles.
    - Note mentions and “notify everybody” recipient state.
    - Semantic/full-text note search index.
    - Capacity, workload, effort, and meeting-proximity inputs for task triage.
    - Scheduled workflows, branching/restart outcomes, step comments, and contact actions.
    - AI-proposed workflow launches and approval records.
    - Pipeline definitions, stages, and stage-triggered workflow rules.
