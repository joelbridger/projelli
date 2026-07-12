# 06 - Records Retention and Books-and-Records Guide

Draft date: 2026-07-09
Audience: CCO, RIA compliance consultant, operations lead
Status: Draft for review. This is not legal or compliance advice.

## Executive summary

Advisor Prep Hero creates and stores work product that may become books-and-records material. The product helps preserve AI chats, drafts, citations, approvals, and audit events locally, but it is not itself the firm's official archive, WORM system, or full Rule 204-2 compliance program.

The firm should decide:

- Which Advisor Prep Hero records must be retained.
- How those records are exported or preserved.
- Where the official archive lives.
- How long records are kept.
- How deletion, legal holds, and client offboarding work.

## Rule 204-2 mapping

Rule 204-2 requires registered investment advisers to make and keep true, accurate, and current books and records relating to the advisory business. It includes written communications relating to advice and recommendations, advertisements and certain related substantiation, policies and procedures, and Reg S-P documentation added by the 2024 amendments. Many records must be preserved for at least five years from the end of the fiscal year during which the last entry was made, with the first two years in an easily accessible place.

Advisor Prep Hero can support the record by keeping the AI work tied to files, citations, and audit events. It does not decide what the firm is legally required to retain.

## Where records live

| Record type | Where it lives | Retention concern |
|---|---|---|
| AI chat | Local workspace chat file | Retain if related to advice, recommendations, client communications, compliance decisions, or firm work product. |
| Generated draft | Local workspace document | Retain final and material drafts according to firm policy. |
| Source citations | In AI answer, client map, draft, or related source reference | Retain with the output so the firm can reconstruct the basis. |
| Client map | Local workspace data/files | Retain if used in client work, meeting prep, advice, or records review. |
| Approval/rejection events | Local audit log and, where applicable, product record | Retain if used to prove supervision or external action approval. |
| AI egress events | Local audit log | Retain for AI supervision and Reg S-P review. |
| Retrieval/search events | Local audit log | Retain where needed to show what source set was used. |
| CRM write-back review | Local audit/event record and CRM record | Retain both local approval evidence and resulting CRM entry. |
| Email drafts and sent emails | Local draft plus email provider/archive | Official record likely belongs in the firm's email archive. |
| Meeting notes/transcripts, if enabled | Local workspace and/or firm-approved meeting storage | Treat as client records if used in advice or meeting documentation. |
| Policy documents and WISP/WSP language | Firm compliance archive | Retain under Rule 204-2 and annual-review process. |
| Incident-response records | Firm compliance archive | Retain investigation, determination, notices, and service-provider contracts under Rule 204-2 and Reg S-P. |

## Recommended firm retention procedure

### 1. Classify records

The firm should classify Advisor Prep Hero output into:

- Client communication.
- Advice/recommendation support.
- Meeting prep or meeting follow-up.
- Compliance record.
- Marketing/advertising material.
- Internal research/draft not used.
- Administrative/system record.

### 2. Save client-specific work in the client file

For client-related outputs, save or export:

- The final document.
- The AI chat or prompt trail if material to the output.
- The cited source list.
- The approval/review note.
- Any CRM/email/custodian action record.

### 3. Preserve the audit log

The firm should export or preserve Advisor Prep Hero's local audit log on a set schedule:

- During pilot: weekly.
- After approval: monthly or quarterly, depending on firm supervision policy.
- At client offboarding.
- At employee offboarding.
- After any incident.
- Before deleting a workspace.

Export target: [firm archive location].

### 4. Archive outside the local machine

Because Advisor Prep Hero is local-first, the official archive should live somewhere the firm controls and supervises, such as:

- Firm document-management system.
- Firm cloud drive with retention policy.
- Email archive.
- CRM record.
- Compliance archive.
- WORM or immutable archive if required by the firm's policy.

Advisor Prep Hero local files should not be the only copy of required books and records.

### 5. Apply legal holds before deletion

Before deleting any workspace, client matter, chat, audit log, source file, or local index, confirm:

- No legal hold applies.
- The official archive already contains required records.
- The CCO or designee approved deletion.
- The deletion is logged.

## Searchability

Advisor Prep Hero helps search local records, but Rule 204-2 review should be based on the firm's official retention system. The firm should be able to produce:

- Client file records.
- AI-generated documents.
- AI chat or prompt records where retained.
- Source citations.
- Audit-log export.
- Approval/review evidence.
- Incident-response evidence.
- Provider/vendor approval evidence.

## Disposal and deletion

Reg S-P includes disposal obligations for customer information and consumer information. Advisor Prep Hero's local-first model means deletion is mostly a firm-controlled endpoint/storage process.

The firm should document:

- Who may delete Advisor Prep Hero workspaces.
- Whether deletion is soft-delete, trash, or permanent removal.
- How local search indexes are cleaned up.
- How backups age out.
- How devices are wiped during offboarding.
- How AI provider logs are handled under the provider's own retention terms.
- How support tickets containing client information are deleted or retained.

## AI provider records

Direct cloud AI requests may leave records with the AI provider under the firm's account terms. The firm should preserve or review:

- Provider account configuration.
- Training/retention settings.
- Zero-data-retention approval, if applicable.
- Provider logs available to the firm.
- Contract/DPA evidence.

Advisor Prep Hero does not control those provider-side records in direct BYOK mode.

## Records-retention policy insert

Paste-ready language:

> Advisor Prep Hero outputs, including AI chats, generated drafts, cited source lists, approval notes, egress/audit records, and exported client-map materials, must be retained when they relate to advice, recommendations, client communications, advertisements, compliance decisions, or other advisory-business records. Users must save final work product and material AI support records to the firm's approved client-file or compliance archive. Advisor Prep Hero's local workspace is a working copy and may not be the firm's sole official archive. Deletion of Advisor Prep Hero records requires confirmation that the firm's retention schedule, legal holds, and archive procedures have been satisfied.

## CCO checklist

- [ ] Decide whether AI chats are retained for all client matters or only when material.
- [ ] Decide whether all AI outputs require citation/source retention.
- [ ] Set audit-log export schedule.
- [ ] Set official archive location: [archive location].
- [ ] Define deletion approval process.
- [ ] Define legal-hold procedure for local workspaces.
- [ ] Document provider-side retention settings.
- [ ] Train users that local files are not automatically in the official archive.

## Sources

- 17 CFR 275.204-2, books and records: https://www.ecfr.gov/current/title-17/chapter-II/part-275/section-275.204-2
- 17 CFR 248.30, Reg S-P safeguards, incident documentation, and disposal: https://www.ecfr.gov/current/title-17/chapter-II/part-248
