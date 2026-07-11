# Round-3 closure verification — 2026-07-11

## Cross-doc report

| Finding | Verdict | Evidence |
|---|---|---|
| XD2-1 | CLOSED | [02 §2.2] defines `firm_home`, `crm:task-notes`, and says task text is “never in `crm:record`.” [03 §1.1] matches the same topology. |
| XD2-2 | CLOSED | [02 §§1.7–1.8, 2.4] uses immutable `revisionId`, `headRevisionIds`, `displayedRevisionSet`, and decision ledger. [03 §4.1] says “not an integer version.” [04 §7] and [06 §1.5] use revision-set language. |
| XD2-3 | PARTIAL | [02 §3.2] and [05 §2.2] match on `(provider, sourceType, sourceId, scope)`. But [06 §1.4] tests generic “stable id-mapping” without requiring that canonical four-part key or linking to 02. |
| XD2-4 | PARTIAL | [02 §1.16] adds `LegacyProject`; [04 §8] gives it a read-only screen and manual workflow action. But [05 §3.2] still names non-02 targets: “Organization, Trust,” “Existing calendar event via `EntityRef`,” and “Read-only legacy Project record,” rather than `Person.personType`, `ActivityEvent`, and `LegacyProject`. |
| XD2-5 | CLOSED | [06 §§1.2, 2.3, 3.3] compares only authorized + subscribed sets and separately asserts unsubscribed/walled records and task-notes are absent. |
| XD2-6 | CLOSED | [06 §1.3] tests the forward-only wall rule: reject new ineligible sends, allow old-key pending envelope to expire, and does not claim retrospective withdrawal. |
| XD2-7 | CLOSED | [04 §3] removes BCC capture and sends email through the existing mail surface. [06 §3.2 Day 1] explicitly says attachments are not API-imported and requires exported-or-gap status. |
| XD2-8 | CLOSED | [04 §11] has visible “In-flight workflow re-creation” and “Attachment accounting” routes, both required through cutover. |
| XD2-9 | CLOSED | [01 §§5, 11–13] records the exclusions; [02 §1.9] adds `schedulingLinkUrl`; [04 §§3, 13–14] provides scheduling and intake flows. |
| XD2-10 | CLOSED | [04 §5] says “singular assignee,” workflow links come from `contextRefs`, and “Tasks have no comments feature.” |
| XD2-11 | PARTIAL | [06 §1.1] now includes `importArchiveManifest` and correctly permits Fact `source.sources` to be empty. But it calls the manifest contract “[02 §1.17]”; it is actually [02 §1.18]. Its claimed exhaustive EntityKind list also omits `legacyProject`. |
| XD2-12 | CLOSED | [02 §3.2] creates `idx_note_hh_aud ON notes(anchor_household_id, audience)`. |
| XD2-13 | PARTIAL | [04] and [06] headers conform to D1–D25. But [05 introduction] still says 02 “had not landed” and tells readers to use “conceptual” names pending future reconciliation. |
| XD2-14 | CLOSED | [06] uses Home, not “Practice Home,” for the tested product surface. |

## Sync-attack report — round-1 partial closure audit

| Finding | Verdict | Evidence |
|---|---|---|
| Durable cursor / duplicate relay row handling | CLOSED | [03 §0.1] defines `cursor <= durableCursor` identity verification and ignore, exact-next apply, and bounded gap repair. |
| 80-household bootstrap budget | CLOSED | [03 §1.3] sets one socket, 12-record/12-task-notes cap, 64 MiB maximum, and a 56 MiB itemized allocation. |
| Topology disagreement | CLOSED | [02 §2.2] and [03 §1.1] both use `firm_home`, per-household `crm:record`, and `crm:task-notes`. |
| Checkpoint completeness validation | CLOSED | [03 §6.1] requires independent reconstruction from prior checkpoint plus contiguous raw replay through frontier F. |
| Checkpoint chunk-size conflict | CLOSED | [03 §1.3] and [03 §6.1] both set a 768 KiB ciphertext limit. |
| Approval envelope expiry | CLOSED | [03 §2.3] makes approval envelopes TTL-exempt until terminal state and every active recipient device has durably acked. |
| Blind relay synthetic-summary / unresolved approval loss | CLOSED | [03 §2.3] says the relay “never invents” a summary and “never drops an unresolved action prompt merely to enforce a cap.” |
| HLC clamp outside canonical contract | CLOSED | [02 §2.3] now owns issuance, relay-observed-time persistence, five-minute clamp, first-observation behavior, and quarantine. |
| Mutable template-version collision | CLOSED | [02 §1.7] uses immutable graph revisions and explicitly rejects integer versions. |
| Displayed version skipping changes | CLOSED | [02 §1.8] and [03 §4.2] advance `displayedRevisionSet` only after the complete required change-set exists. |
| Removal versus offline progress | CLOSED | [03 §4.2] uses `UNTOUCHED = 'todo'` and re-runs reconciliation after merge. |
| Mutable completion fields | CLOSED | [02 §1.8] makes completions append-only `CompletionOperation`s; displayed completion is a projection only. |

## Sync-attack report — new findings

| Finding | Verdict | Evidence |
|---|---|---|
| SA2-1 | CLOSED | [03 §0.1] has the required duplicate / next-row / gap triage and idempotency by cursor/blob ID. |
| SA2-2 | CLOSED | [03 §2.3] makes approval envelopes TTL-exempt until terminal plus active-device ack; [06 §1.3] tests an eight-day offline recipient. |
| SA2-3 | CLOSED | [02 §§1.7–1.8, 2.3–2.4] matches 03’s immutable revision graph, append-only completions, decision ledger, and `UNTOUCHED = 'todo'`. |
| SA2-4 | CLOSED | [03 §6.1] requires replay-and-compare validation, signed receipts, and minimal relay control metadata. |
| SA2-5 | CLOSED | [03 §2.3] requires relay acceptance of the referenced operation before envelope dispatch; early envelopes wait for referenced state. |
| SA2-6 | CLOSED | [03 §1.3] has one 768 KiB limit and a 56 MiB bootstrap allocation that includes 12 `crm:task-notes` documents. |
| SA2-7 | PARTIAL | [03 §§0, 2.1–2.3, 6.2] scopes relay notification cursors, queries, acknowledgements, idempotency, and retirement by `org_id`. But [02 §3.2] defines local `crm_outbox` and `crm_inbox` without `org_id`, so the durable inbox/outbox schema does not fully carry the same scope. |
| SA2-8 | CLOSED | [03 §4.1] defines immutable decision-ledger entries keyed by `(instanceId, revisionId, stepId, field)` and descendant-only re-offers. |
| SA2-9 | CLOSED | [03 §4.2] defines target closure, topological order, HLC/operation-ID collision resolution, and explicit concurrent-head review. |
| SA2-10 | CLOSED | [02 §2.3] contains the full HLC clamp, first-observation rule, persisted relay time, and invalid-stamp quarantine; [03 §3] references it only. |

## Screens-vs-contracts report

| Finding | Verdict | Evidence |
|---|---|---|
| SC-1 | CLOSED | [04 §§1–2] uses Home, Clients, Ask, “firm,” and “Ask the firm”; no rejected Practice UI wording remains. |
| SC-2 | CLOSED | [02 §1.15] defines durable `ProposalRecord` kinds for workflow, task, fact, and communication drafts; [04 §14] renders those durable records. |
| SC-3 | CLOSED | [04 §5] uses singular assignee, `contextRefs` workflow links, and no task comments. |
| SC-4 | CLOSED | [04 §3] makes client-facing Notes direct local records; “Draft email” opens the existing mail surface. |
| SC-5 | CLOSED | [04 §3] contains no BCC-dropbox promise; [01 §9] retains the documented v1 exclusion. |
| SC-6 | CLOSED | [04 §7] defines one offer per instance, per-step/per-field controls, accept defaults, and Approve all eligible instances. |
| SC-7 | CLOSED | [04 §§6–7] uses human-readable update labels and revision-set/change-set wording, not integer version labels. |
| SC-8 | CLOSED | [04 §7] says propagation never alters assignment history on completed steps; owner changes can offer a separate new assignment. |
| SC-9 | CLOSED | [04 §7] makes undo automatically restore safe cells and report protected cells, with no compare/decide dialog. |
| SC-10 | CLOSED | [04 §11] adds visible workflow re-creation and attachment-accounting routes through cutover. |
| SC-11 | CLOSED | [04 §11] limits mirror workflow data to readable templates and activity traces, never API-derived open state. |
| SC-12 | CLOSED | [04 §15] defines Live, Syncing with lower-bound wording, Last synced, and Offline. |
| SC-13 | CLOSED | [04 §10] discloses recipient, timestamps, size band, delivery/ack timing, opaque ID, and local-only ordinary read state. |
| SC-14 | CLOSED | [04 §8 Pipeline settings] supports create/edit/archive/order pipelines and stages plus `StageTriggerRule`. |
| SC-15 | CLOSED | [04 §6 Templates] adds a schedule editor and per-step outcomes/branching editor. |
| SC-16 | CLOSED | [04 §8] provides read-only Legacy Projects and explicit “Start a workflow from this.” |
| SC-17 | CLOSED | [04 §3 Note editor] provides pin, mentions, notification review; [04 §10] and [01 §11] explicitly exclude activity comments/reactions in v1. |
| SC-18 | CLOSED | [04 §13] makes FirmDirectoryEntry display-only and routes authority changes to existing admin rails. |
| SC-19 | CLOSED | [04 §12] provides contextual field/tag value editors and a Firm documents list that opens the existing editor. |
| SC-20 | CLOSED | [04 §14] specifies intake-link creation, responsive public form, and matching/review routes. |
| SC-21 | CLOSED | [02 §1.9] defines `schedulingLinkUrl`; [04 §§3, 13] exposes it for household scheduling and service-tier setup. |
| SC-22 | CLOSED | [04 §11] provides archive and rollback export actions with readiness and status screens. |

Remaining fixes:

- XD2-3: Make [06 §1.4] explicitly test the canonical `(provider, sourceType, sourceId, scope)` identity from [02 §3.2].
- XD2-4: Replace the three stale target labels in [05 §3.2] with `Person.personType`, `ActivityEvent`, and `LegacyProject`.
- XD2-11: Correct the [06 §1.1] manifest link to [02 §1.18] and add `legacyProject` to its exhaustive EntityKind catalog.
- XD2-13: Remove the obsolete “02 had not landed” / conceptual-entity note from [05 introduction].
- SA2-7: Add `org_id` to [02 §3.2] local notification outbox/inbox identity and indexes, or explicitly state and enforce a single-org-per-database boundary.

VERDICT: REMAINING (XD2-3, XD2-4, XD2-11, XD2-13, SA2-7)
