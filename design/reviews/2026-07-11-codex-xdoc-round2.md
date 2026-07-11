# Round-2 cross-doc consistency review — 2026-07-11

1. **XD2-1 — BLOCKER**  
   **Docs:** 02 §2.2; 03 §§1.1–1.2  
   **Conflict:** 02 says confidential task text “lives in that household’s `crm:record`.” 03 instead defines a separate `crm:task-notes` document, and also says “no `__firm__` pseudo-matter,” while 02 repeatedly uses `__firm__`.  
   **Minimal fix:** Pick one exact firm-home identifier and one confidential-task-body location. Make the topology tables, document shapes, SQL examples, and subscription rules identical.

2. **XD2-2 — BLOCKER**  
   **Docs:** 00 D4; 02 §§1.7–1.8, 2.3–2.4; 03 §4; 04 §§6–7; 06 §1.5  
   **Conflict:** D4 requires “revision-set based” propagation. 03 implements `acceptedRevisionIds` and `displayedRevisionSet`, explicitly saying “There is no … integer `templateVersionApplied`.” But 02 defines `WorkflowTemplate.rev`, `displayedTemplateRev`, and numeric `derivedFieldRevs`; 04 renders “v7 → v8”; 06 tests “monotonic version.”  
   **Minimal fix:** Make 02 the canonical shape match 03’s revision graph and per-field source revision IDs. Then replace numeric-version language in 04 and 06 with revision-set language.

3. **XD2-3 — BLOCKER**  
   **Docs:** 02 §3.2; 05 §2.2  
   **Conflict:** 02 defines `external_refs` as `PRIMARY KEY (provider, external_id)`. 05 defines the required replay lookup as `(provider, sourceType, sourceId, scope) → EntityRef`. These keys can produce different identities, especially for multi-household notes.  
   **Minimal fix:** Choose one canonical external-reference key shape, define it in 02’s entity and SQL contracts, and use it verbatim in 05 and 06’s idempotency tests.

4. **XD2-4 — BLOCKER**  
   **Docs:** 02 §1 `EntityKind`; 05 §3.2  
   **Conflict:** The canonical fidelity matrix names targets that do not exist as 02 entities: “Read-only legacy Project record,” separate “Organization, Trust,” and “Existing calendar event via `EntityRef`.” 02 instead has `Person.personType`, no Project entity, and says imported events become `ActivityEvent`s.  
   **Minimal fix:** Define the missing legacy Project record and its storage/merge/import shape, or change the matrix target to a real 02 entity. Normalize Organization/Trust and Event rows to the exact 02 names.

5. **XD2-5 — BLOCKER**  
   **Docs:** 00 D1; 03 §§1.1–1.4, 5; 06 §§2.2–2.3, 3.3  
   **Conflict:** D1 requires lazy client-record subscriptions, and 03 says walled content is unavailable. Yet 06 requires “100% of clients’ materialized views are byte-identical” and later requires all six seats’ “full materialized state” hashes to match.  
   **Minimal fix:** Compare only the shared, authorized, subscribed document set. Add separate assertions that unsubscribed and walled content is absent.

6. **XD2-6 — MAJOR**  
   **Docs:** 03 §2.2; 06 §1.3  
   **Conflict:** 03 accepts that a later wall cannot retract an already-addressed pending envelope: “a recipient who already retained an old key could decrypt” it until expiry. 06 requires that after revocation “the relay and client do not deliver or reveal the envelope.”  
   **Minimal fix:** Update the test to enforce D5’s actual rule: reject new ineligible sends, rotate future keys, expire/dead-letter old pending envelopes, and do not claim retrospective withdrawal.

7. **XD2-7 — MAJOR**  
   **Docs:** 01 §9; 04 §§3, 14; 05 §§2.5b, 3.2; 06 §3.2  
   **Conflict:** D9 excludes BCC-dropbox capture, but 04 says “BCC-dropbox message appears in Email and Timeline” and “BCC mail appears Email/Timeline.” D8’s canonical matrix says attachments have “0% via API,” yet 06 Day 1 says the importer ingests a “file/email/meeting corpus.”  
   **Minimal fix:** Remove BCC-dropbox behavior from 04 unless a separately designed client-side alternative exists. Change Day 1 to use the documented attachment export-or-gap process, not API ingestion.

8. **XD2-8 — MAJOR**  
   **Docs:** 04 §11; 05 §§2.5a–b, 3.2  
   **Conflict:** 05 requires guided manual recreation for open workflows and attachment gap accounting. 04 instead groups “opportunities/workflows/projects/unsupported fields” under “Read-only mirror until cutover,” and its cutover gate omits both required workflow operator decisions and attachment-gap resolution.  
   **Minimal fix:** Add explicit migration-screen states for open-workflow checklists/operator decisions and attachment exported-or-gap status; make both visible cutover requirements.

9. **XD2-9 — MAJOR**  
   **Docs:** 01 §§5, 8, 11–13; 02; 04  
   **Missing feature homes:** These REPLICATE/IMPROVE rows still lack both a defined data contract and a clear screen flow:
   - “Contact Actions in Opportunity Workflows”
   - “Calendly integration for scheduling links”
   - “Comments on activity”
   - “File storage on records” for contacts, notes, and tasks  
   02 has no contact-action, scheduling-link, activity-comment, or record-attachment fields/entities. 04 has no corresponding management or use flows.  
   **Minimal fix:** Add each as a defined 02 contract plus a 04 flow, or change the 01 verdict to a documented exclusion.

10. **XD2-10 — MAJOR**  
    **Docs:** 02 §3.2; 04 §5  
    **Conflict:** D2 permits exactly one `assigneeUserId`, but 04’s task detail lists “assignees.” Also, 04 exposes task “comments,” but 02’s Task has no comments field or linked comment entity.  
    **Minimal fix:** Change task UI wording and controls to a single assignee. Either define task comments in 02 or remove that screen feature.

11. **XD2-11 — MAJOR**  
    **Docs:** 02 §1; 06 §1.1  
    **Conflict:** 06 calls its EntityKind catalog exhaustive but omits `importArchiveManifest`. It also requires a Fact to have a “non-empty shared source,” while 02 defines `Provenance.sources` as `0..n`.  
    **Minimal fix:** Add `importArchiveManifest` to the catalog and test its real schema. Require a `source` object, but permit an empty citations array unless 02 is deliberately tightened.

12. **XD2-12 — MAJOR**  
    **Doc:** 02 §3.2  
    **Conflict:** `CREATE TABLE notes` defines `anchor_household_id`, but the next statement creates `idx_note_hh_aud ON notes(household_id, audience)`. `household_id` does not exist on that table.  
    **Minimal fix:** Index `anchor_household_id`, or add the intended `household_id` column and define its meaning for multi-household notes.

13. **XD2-13 — MINOR**  
    **Docs:** 00 D10; 04 header; 05 introduction; 06 introduction and §3.1  
    **Conflict:** 04 says only “Conforms to 00-master-spec D11,” not D1–D10. 05 says 02 “had not landed.” 06 refers to “still-being-written output” and says to finalize against the screen doc “when it lands.”  
    **Minimal fix:** Update 04’s header to D1–D11 and remove the stale reconciliation wording from 05 and 06.

14. **XD2-14 — MINOR**  
    **Docs:** 00 D11; 06 §§3.2, 5  
    **Conflict:** D11 replaces Practice with Home, but 06 still says “Practice Home surfacing” and “Practice Home, reports, the household record.”  
    **Minimal fix:** Rename these test references to Home.

VERDICT: NOT-READY (5 blockers)

