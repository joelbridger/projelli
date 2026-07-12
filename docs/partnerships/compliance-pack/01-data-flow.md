# 01 - Data-Flow Memo

Draft date: 2026-07-09
Audience: CCO, RIA compliance consultant, security reviewer
Status: Draft for review. This is not legal or compliance advice.

## Executive summary

Advisor Prep Hero is designed so the firm's client files are processed locally by default. In ordinary desktop use, the advisor's documents, email, notes, AI chat files, client map, local index, and audit log live on the advisor's device or firm-managed storage chosen by the firm. Advisor Prep Hero does not run a cloud database that stores those client files.

The main data-flow decision for a CCO is the AI mode:

- Local-only: no prompt or file content leaves the machine for AI inference.
- Direct cloud: prompt content goes directly from the advisor's machine to the approved AI provider, under the firm's or advisor's own provider account. Advisor Prep Hero is not in the request path.
- Firm Assured: if enabled, prompt content routes through Advisor Prep Hero's zero-retention relay to the firm's AI provider. This path needs its own contract/DPA review before approval.

## Described diagram

Use this as the diagram text for a slide or PDF:

```text
Advisor computer
  - Workspace files: documents, notes, drafts, AI chats
  - Local search index and embeddings
  - Local encrypted email store
  - Local encrypted audit log
  - OS keychain for AI keys and local encryption keys
  - Local AI option: Advisor Prep Hero Local AI or Ollama

Outbound paths
  1. Local-only AI: no outbound AI path
  2. Direct cloud AI: advisor computer -> approved AI provider API
  3. Firm Assured AI: advisor computer -> Advisor Prep Hero relay -> approved AI provider API
  4. License: advisor computer -> Advisor Prep Hero license service
  5. Updates: advisor computer -> signed update manifest/release host
  6. Optional telemetry/diagnostics: advisor computer -> Advisor Prep Hero forms endpoint
  7. Optional support: advisor computer -> Advisor Prep Hero support endpoint or email
  8. Optional connectors: advisor computer -> firm-approved CRM/email/calendar/custodian provider
  9. Optional firm sync: advisor computer -> Advisor Prep Hero encrypted relay

Advisor Prep Hero servers
  - Do not store workspace documents in normal desktop use
  - Do not store direct BYOK prompts or responses
  - Store license/payment/support/optional telemetry records as described
  - Store ciphertext only for firm collaboration if that feature is enabled
```

## Data-flow inventory

| Data category | Where it lives | Can Advisor Prep Hero servers see it? | Can another vendor see it? | Reg S-P review note |
|---|---|---:|---:|---|
| Workspace documents, notes, drafts, client map | Local workspace folder or firm-approved storage chosen by the firm | No, unless the user sends it to support or enables a firm relay path that handles encrypted blobs | Yes, if the firm stores the folder in OneDrive, Dropbox, network storage, backup, or another firm system | Treat as customer information under the firm's safeguard program. Device and storage controls matter. |
| AI chat history | Local workspace files | No in local-only/direct cloud desktop use | Yes if included in firm backups or synced storage chosen by the firm | Treat as firm records if the chat relates to advice, recommendations, client communications, or compliance decisions. |
| Local search index and embeddings | Local app/workspace data store | No | No, unless the firm backs up or syncs the local store | Passage text and paths are local. Some metadata can remain readable for search isolation. Protect through disk encryption and access controls. |
| Imported email | Local encrypted database | No | Email provider sees the mailbox under the firm's existing email relationship | Imported email is customer information if it contains client data. Email provider remains a separate firm vendor. |
| Audit log | Local encrypted, append-only audit database | No | No, unless exported or backed up to firm systems | Supports supervision and records review. It is not a substitute for the firm's official archive. |
| AI provider API keys | OS keychain on the device | No | The AI provider receives the key as part of normal API authentication | Key handling should be covered by the firm's access-control and offboarding policy. |
| Local-only AI prompts/responses | Local machine only | No | No cloud AI provider receives them | Strongest posture for sensitive client work. |
| Direct cloud AI prompts/responses | Sent from device to approved AI provider | No | Yes, the chosen provider receives prompt content and returns output | The AI provider should be reviewed under the firm's vendor/AI policy. |
| Firm Assured AI prompts/responses | Device -> Advisor Prep Hero relay -> provider, if enabled | Transient relay path only; no retention claimed | Yes, provider receives prompt content | Requires DPA, provider agreement, and current technical evidence before approval. |
| License checks | Advisor Prep Hero license service | Yes: license key, machine identifier, app/license status | Payment processor has purchase records | Not workspace content, but still vendor/business data. |
| Update checks | Public release/update host | No client content | GitHub or release host sees ordinary download metadata | Update process should be covered by software patch policy. |
| Optional telemetry | Advisor Prep Hero forms endpoint | Yes: anonymous install ID, app version, platform, lifecycle event, license tier, days since install | Hosting provider for that endpoint may process logs | Off by default. Should be disabled unless the firm approves. No content, prompts, files, email, client names, or search queries. |
| Optional diagnostics/error reporting | Advisor Prep Hero forms endpoint | Yes: structure-only counts, internal IDs, error category/component | Hosting provider for that endpoint may process logs | Off by default. Should be disabled unless the firm approves. No free-text content fields by design. |
| Optional support or bug report | Advisor Prep Hero support process | Yes: anything the user types or attaches | Support tooling/email provider may process it | Firm policy should prohibit sending client content to support unless approved and logged. |
| Optional CRM/email/calendar/custodian connector | Device to third-party provider, using firm credential | No, unless a firm relay feature is used for that connector | Yes, the connector provider sees its normal data | Each connector should be separately approved as a firm vendor or existing firm system. |
| Firm encrypted collaboration relay | Advisor Prep Hero API relay, if enabled | Ciphertext, org/seat metadata, sync metadata | Hosting provider may process encrypted blobs | Review as a service provider for encrypted customer-information systems. Key management is central. |

## What client data cannot go to Advisor Prep Hero in normal desktop use

In local-only and direct-cloud desktop use, Advisor Prep Hero servers do not receive:

- Client documents.
- Client email content.
- AI prompts or responses.
- Local search index contents.
- AI chat history.
- Client map contents.
- API keys for direct BYOK cloud use.
- Audit log contents.

Exceptions are user-driven or firm-tier features: support uploads, optional telemetry/diagnostics without content, encrypted firm sync, and firm Assured proxy if enabled.

## Reg S-P mapping

Regulation S-P applies to registered investment advisers and other covered institutions. It requires written safeguards that address administrative, technical, and physical protection of customer information, and it requires incident-response and customer-notice procedures for unauthorized access or use of customer information. The 2024 amendments also define a service provider as an entity that receives, maintains, processes, or is permitted access to customer information through services provided to a covered institution.

Advisor Prep Hero's local-first design matters because a vendor that does not receive, maintain, process, or access client files in the ordinary desktop path presents a narrower Reg S-P service-provider question than a cloud SaaS product that stores client data. But the firm still has to evaluate:

- The device and storage environment where client data lives.
- Any AI provider that receives direct-cloud prompts.
- Any connector provider that receives or already stores client data.
- Any Advisor Prep Hero path the firm enables that could involve customer information, including firm sync, Assured relay, and support uploads.
- The firm's own privacy notices, safeguards, incident response, disposal, and records program.

## CCO approval checklist

- [ ] Decide whether local-only mode is approved for client work.
- [ ] Decide whether direct-cloud mode is approved, and list approved providers/accounts.
- [ ] Decide whether firm Assured mode is approved. If yes, attach [signed DPA date], [provider zero-retention evidence], and [technical evidence date].
- [ ] Disable optional telemetry and diagnostics unless the firm approves them.
- [ ] Ban the web demo for real client data.
- [ ] Approve or block each connector: CRM, email, calendar, custodian, cloud drive, backups.
- [ ] Define how Advisor Prep Hero records move into the firm's official books-and-records archive.
- [ ] Add Advisor Prep Hero to the firm's vendor and technology inventory with this data-flow memo attached.

## Sources

- 17 CFR Part 248, Regulation S-P: https://www.ecfr.gov/current/title-17/chapter-II/part-248
- SEC Reg S-P 2024 final rule release: https://www.sec.gov/files/rules/final/2024/34-100155.pdf
- SEC 2026 Examination Priorities: https://www.sec.gov/files/2026-exam-priorities.pdf
