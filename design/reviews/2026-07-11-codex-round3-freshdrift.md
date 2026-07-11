# Round-3 fresh-drift sweep — 2026-07-11

1. **FD-1 — BLOCKER**  
   **Docs:** 02 §1.8; 03 §§4.1–4.2  
   **Conflict:** 03 requires step state containing "`origin: template | local`" and "`removalRequestedBy: OR-Set<revisionId>`," then says removal writes `removalRequestedBy`. 02 `WorkflowStepProgress` defines neither field.  
   **Minimal fix:** Add both fields, their merge rules, and SQL projection to 02, or remove them from 03 and define an equivalent supported representation.

2. **FD-2 — MAJOR**  
   **Docs:** 02 §1.8; 03 §4.1  
   **Conflict:** 03 names step progress `assigneeUserId`; 02 defines `WorkflowStepProgress.assigneeId`. 03 also relies on “assignment history,” which 02 does not store.  
   **Minimal fix:** Choose one exact field name and define append-only assignment history, or narrow 03’s removal rule to fields actually represented.

3. **FD-3 — MAJOR**  
   **Docs:** 02 §2.2; 03 §1.2  
   **Conflict:** 02 says `firm_home / crm:directory` contains only `FirmDirectoryEntry` and `ImportArchiveManifest`; 03 says it contains “non-identifying household directory shells.” No shell entity exists in 02.  
   **Minimal fix:** Define the shell entity and its fields/merge rules in 02, or remove it from 03.

4. **FD-4 — MAJOR**  
   **Docs:** 02 §1.8; 03 §4.4; 06 §1.5  
   **Conflict:** 02 defines `CompletionOperation.completedBy`; 03 P1 and 06 P1 require immutable "`completed_by`." That is only a SQL column name, not the CRM field.  
   **Minimal fix:** Change 03/06 to `completedBy` and reserve `completed_by` for SQL mapping only.

5. **FD-5 — BLOCKER**  
   **Docs:** 02 EntityKind/§1; 04 §14  
   **Conflict:** 04 creates named intake links, public submissions, matching/review, and an “intake record.” 02 defines no `IntakeLink`, `IntakeSubmission`, or equivalent entity/mutation.  
   **Minimal fix:** Add the intake entities, storage location, merge rules, and matching decision mutation to 02.

6. **FD-6 — MAJOR**  
   **Docs:** 02 §1.6, §1.13; 04 §12  
   **Conflict:** 04 says Task detail has custom-field value editors. 02 says values are stored on Household/Person/Account/Task, but `Task` has no `customFields` field.  
   **Minimal fix:** Add `customFields: CustomFieldValueMap` to `Task` and its Field Merge Contract row.

7. **FD-7 — MAJOR**  
   **Docs:** 02 §1.18; 04 §11; 05 §§2.5a–b  
   **Conflict:** 04 requires durable in-flight-workflow checklist decisions, attachment exported-or-gap records, archive-export readiness/status, and rollback-export readiness/status. 02 has only `ImportArchiveManifest`; none of those records or mutations exist.  
   **Minimal fix:** Define durable migration checklist, attachment-accounting, and export-job/status contracts, or explicitly make them fields of a defined existing entity.

8. **FD-8 — MAJOR**  
   **Docs:** 02 §1.7; 04 §6  
   **Conflict:** 04 says publishing “asks for a human-readable update label.” `TemplateRevision` has no label field.  
   **Minimal fix:** Add an immutable `TemplateRevision.label` field and merge/storage treatment, or remove the required label from the screen.

9. **FD-9 — MAJOR**  
   **Doc:** 02 §1.15  
   **Conflict:** `ProposalRecord.householdRef` is required, while `task_create` embeds `Task.householdRef`, which may be `null` for a firm task. A proposal for a valid firm task cannot satisfy both shapes.  
   **Minimal fix:** Make `ProposalRecord.householdRef` nullable with defined firm-scope semantics, or prohibit firm-task proposals.

10. **FD-10 — MAJOR**  
    **Docs:** 02 §§1.16, 2.2; 05 §3.2  
    **Conflict:** 05 requires imported Projects with “linked/unlinked cases,” while 02 stores every `LegacyProject` in an anchor household’s `crm:record`; the type has no `anchorHouseholdId` and no firm-level fallback.  
    **Minimal fix:** Define `anchorHouseholdId` plus a deterministic fallback for unlinked projects, or make unlinked projects an explicit allowed skip.

11. **FD-11 — MAJOR**  
    **Docs:** 02 §1.18; 05 §2.2  
    **Conflict:** 05’s archive manifest requires capture-layer version, fixture identity, typed outcome, target `EntityRef`/skip reason, and resulting `external_refs` projection. 02’s `ImportArchiveManifest.records` has only raw ID, path, timestamp, hash, and byte length.  
    **Minimal fix:** Extend `RawArchiveEntry`/manifest with those required fields, or narrow 05 to the actual 02 contract.

12. **FD-12 — MAJOR**  
    **Docs:** 02 §1; 06 §§1.1–1.2, 2.2  
    **Conflict:** 06 calls its EntityKind catalog exhaustive but omits `legacyProject`. It also scripts Task edits to "`assignee`," “note,” and “checklist item”; 02’s Task fields are `assigneeUserId` and `body`, with no checklist-item field.  
    **Minimal fix:** Add `legacyProject` to the catalog and rewrite Task tests to use only canonical Task fields.

13. **FD-13 — MINOR**  
    **Docs:** 01 §18; 04 §15; 06 §1.1  
    **Conflict:** Three new links are broken:
    - 01 links to `05...#21-coverage-table-probed-endpoints-and-typed-targets`; 05 §2.1 is “Full object coverage plan.”
    - 04 links to `03...#23-durable-outbox-and-approval-classes`; 03 §2.3 is “API and delivery protocol.”
    - 06 links to `02...#117-importarchivemanifest`; the manifest is now §1.18.  
    **Minimal fix:** Update each fragment to its current heading anchor.

14. **FD-14 — MINOR**  
    **Docs:** 02 §1.7; 03 §3  
    **Conflict:** 03 says "`rev` is reserved for propagation revision mechanics." 02 and D12 replace numeric `rev` with immutable `revisionId`/revision sets; no `rev` field exists.  
    **Minimal fix:** Replace the sentence with “No `rev` field exists; propagation uses immutable `revisionId` values and revision sets.”

VERDICT: DRIFT-FOUND (14)
