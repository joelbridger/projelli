# 04 - Vendor Due-Diligence Questionnaire

Draft date: 2026-07-09
Audience: CCO, outside compliance consultant, security reviewer
Status: Draft for review. This is not legal or compliance advice.

## Vendor profile

| Question | Answer |
|---|---|
| Product name | Advisor Prep Hero |
| Legal entity | [legal entity name] |
| Website | [advisorprephero.com / current website] |
| Security contact | [security contact email] |
| Legal/DPA contact | [legal contact email] |
| Support contact | [support contact email] |
| Product category | Local-first desktop AI workspace for financial-advisor client work |
| Deployment model | Desktop app, with optional firm services for licensing, encrypted collaboration, and firm Assured AI routing |
| Primary data posture | Client workspace data is local by default and is not stored on Advisor Prep Hero servers in normal desktop use |
| Intended users | Solo and small/mid RIA practices, financial advisors, and staff under firm supervision |

## Service description

Advisor Prep Hero helps advisors organize client files, search across local documents and email, ask AI-assisted questions with citations, draft work product, maintain a client map, and prepare meeting materials. It is a drafting and supervision aid. It is not a custodian, portfolio accounting system, trading platform, payment tool, or autonomous advice engine.

## Data handled

| Data type | Handled by product? | Stored by Advisor Prep Hero servers? | Notes |
|---|---:|---:|---|
| Client documents | Yes | No in normal desktop use | Local workspace files. |
| Client notes/drafts | Yes | No in normal desktop use | Local workspace files. |
| AI chats | Yes | No in normal desktop use | Local workspace files. |
| Local search index | Yes | No | Stored locally. |
| Imported email | Optional | No | Local encrypted store. |
| AI prompts/responses | Yes | No in local-only and direct cloud modes | Direct cloud prompts go to the approved AI provider, not Advisor Prep Hero. |
| License records | Yes | Yes | License key, machine identifier, entitlement status. |
| Payment records | Yes | Payment processor | LemonSqueezy or current merchant of record. |
| Telemetry | Optional | Yes, if enabled | Off by default; no content or prompts. |
| Diagnostics/error reporting | Optional | Yes, if enabled | Off by default; structure-only events. |
| Support tickets | Optional | Yes | Only what the user submits. |
| Firm collaboration data | Optional | Encrypted blobs only | Requires separate firm review. |
| Firm Assured proxy data | Optional | Transient processing only, no retention claimed | Requires DPA and evidence before approval. |

## Security questionnaire

| Control question | Answer |
|---|---|
| Does the vendor host customer workspace content? | Not in normal desktop use. Client files, AI chats, local index, imported email, and audit logs live on the advisor's machine or firm-approved storage. |
| Does the vendor receive direct BYOK prompts or responses? | No. In direct cloud mode, the request goes from the advisor's machine directly to the selected AI provider. |
| Does the vendor train models on customer content? | No. Advisor Prep Hero does not use customer workspace content to train models. Provider training is governed by the firm's AI provider terms. |
| How are AI keys stored? | In the operating system keychain on the advisor's device. |
| Is data encrypted at rest? | Local encrypted stores are used for imported email and audit logs. Optional workspace vault encrypts file contents. Plain workspace files rely on device/storage encryption unless the vault is enabled. |
| Is data encrypted in transit? | Yes, external service calls use TLS/HTTPS. Local model calls use localhost. |
| Is there a formal access-control system? | Local use relies on OS account controls and firm device management. Firm tier can add seat entitlements and firm controls: [firm admin/SSO status]. |
| Can vendor support access client data remotely? | No remote browsing access to the local workspace. Support sees only what the user sends. |
| Is there an audit log? | Yes, a local encrypted append-only audit log records AI, retrieval, egress, citation, and approval-related events. |
| Is there a vulnerability disclosure process? | Security reports should go to [security contact]. |
| Is there a third-party penetration test? | No current third-party penetration test report. Planned target: [pen-test target/date/provider]. |
| Is there SOC 2 Type I or Type II? | No current SOC 2 Type I or Type II report. Planned/evaluating scope: [SOC 2 target/date/scope]. |
| Is there cyber insurance? | [cyber insurance carrier/limits]. |
| Is there a DPA? | No final signed DPA template is included in this pack. Current status: [DPA target/date]. |
| Is there a BCP/DR plan? | [BCP/DR status/date/owner]. |
| Does the product support deletion/return? | Local workspace deletion is controlled by the firm. Advisor Prep Hero server-side records are limited and listed in the retention schedule below. |

## SOC 2 status

Current status: Advisor Prep Hero does not currently have a SOC 2 Type I or Type II report. Planned/evaluating scope: [SOC 2 target/date/scope].

Truthful response:

Advisor Prep Hero does not currently have a SOC 2 Type I or Type II report. The product is local-first, so the highest-risk client workspace data is not stored in Advisor Prep Hero's cloud. The company plans to scope future assurance work around the infrastructure that does exist: license service, update/release process, optional telemetry/support endpoints, firm encrypted relay, and firm Assured proxy if offered.

Do not state or imply SOC 2 certification until a report exists.

## Incident response

Advisor Prep Hero should maintain an incident response process covering:

- Intake and triage.
- Severity classification.
- Containment and eradication.
- Customer-information impact analysis.
- Customer/firm notice support.
- Reg S-P service-provider notice within 72 hours where applicable.
- Evidence preservation.
- Root-cause review.
- Remediation tracking.

Current formal incident-response policy status: draft packet created here; not yet approved as a final company policy. Target approval: [incident response approval date/owner].

See [05-incident-response-regs-p.md](05-incident-response-regs-p.md).

## Business continuity and disaster recovery

Because customer workspaces are local, BCP/DR is shared:

- Advisor Prep Hero is responsible for continuity of its license, update, support, optional telemetry, firm sync, and firm Assured services.
- The firm is responsible for backup and recovery of local workspace data, endpoint devices, cloud drive, email, CRM, and archive systems.

Current Advisor Prep Hero BCP/DR status: [BCP/DR summary/date].

Minimum BCP/DR facts to provide:

- Recovery time objective for license service: [RTO].
- Recovery point objective for license service: [RPO].
- Recovery time objective for firm relay/API service: [RTO].
- Recovery point objective for firm relay/API service: [RPO].
- Backup frequency for server-side records: [backup frequency].
- Test date of restore process: [restore-test date].

## Subprocessors and third-party services

| Service | Role | Customer/workspace content? | Approval note |
|---|---|---:|---|
| LemonSqueezy or current merchant of record | Payments, invoices, tax handling, purchase records | No workspace content | Payment/vendor review; not a client-file processor. |
| License service at `licenses.lanternplatform.app` | License validation and entitlement checks | No workspace content | Receives license key and machine identifier. |
| GitHub Releases / release host | Update manifest and app downloads | No workspace content | Software update supply-chain review. |
| Forms endpoint at `forms.lanternplatform.app` | Optional telemetry, diagnostics, bug reports, support forms | No content unless user types/uploads it | Disable optional reporting unless approved. |
| API endpoint at `api.lanternplatform.app` | Firm services, encrypted relay, firm Assured routing if enabled | Ciphertext for firm sync; transient prompt content for Assured if enabled | Requires DPA and firm-mode approval. |
| Hosting provider for Advisor Prep Hero services | Infrastructure hosting | Depends on service path | Fill once hosting is final: [hosting provider]. |
| Anthropic/OpenAI/Google | AI provider in direct cloud or Assured mode | Yes, receives prompts selected by user | In direct cloud mode, this is the firm's/provider account relationship, not Advisor Prep Hero's processor path. Firm must approve terms. |
| Ollama/local model | Local AI runtime | No cloud content | Confirm local mode only; no cloud-hosted Ollama service. |
| Wealthbox, Microsoft Graph, Google, calendar/CRM/custodian providers | Optional connectors | Yes, if enabled by firm/user | Treat each as a separate firm-approved vendor or existing system. |
| Support email/helpdesk provider | Support communication | Only what user sends | Prohibit client content unless approved. Fill vendor: [support tool/vendor]. |

## Data-retention schedule

| Data category | Location | Retention |
|---|---|---|
| Local workspace files | Advisor device or firm storage | Firm retention schedule. Advisor Prep Hero has no server copy. |
| Local AI chats | Advisor device or firm storage | Firm retention schedule. |
| Local search index | Advisor device | Until reindexed, deleted, or workspace removed, subject to firm policy. |
| Local email store | Advisor device | Until deleted or archived under firm policy. |
| Local audit log | Advisor device | Preserve under firm records policy; recommended export/archive schedule in 06. |
| License records | Advisor Prep Hero license service | [license retention period]. |
| Payment records | Merchant of record | [payment/tax retention period]. |
| Optional telemetry | Advisor Prep Hero forms service | [telemetry retention period]. |
| Optional diagnostics | Advisor Prep Hero forms service | [diagnostics retention period]. |
| Support tickets | Support system | [support retention period]. |
| Firm sync ciphertext | Advisor Prep Hero relay/storage | [firm sync retention period]. |
| Firm Assured prompts/responses | Transient memory only, if enabled | No retention claimed; verify with current DPA/evidence. |

## Contract/DPA checklist

A compliance consultant will likely ask for these clauses or exhibits:

- Confidentiality.
- No sale of customer data.
- No training on customer content by Advisor Prep Hero.
- Subprocessor list and update notice.
- Security controls exhibit.
- Incident notice and cooperation.
- Reg S-P service-provider notice support where applicable.
- Data return/deletion.
- Support access limits.
- Firm-controlled AI-provider approval.
- Audit and evidence cooperation.
- Limitation of liability reviewed by counsel.
- Data-location and hosting commitments: [data location].
- Insurance evidence: [insurance].

## Trusted-list / XYPN packet status

This due-diligence packet is the security/compliance backbone for XYPN or a similar trusted-list review. The partner packet still needs:

- [Advisor use-case one-pager]
- [Pricing sheet]
- [Onboarding/support SLA]
- [Member references or design partners]
- [SOC 2 or SOC 2 roadmap]
- [Pen-test/security evidence]
- [Plain-English demo script]
- [Partner owner]

## Sources

- 17 CFR Part 248, Regulation S-P: https://www.ecfr.gov/current/title-17/chapter-II/part-248
- SEC Reg S-P 2024 final rule release: https://www.sec.gov/files/rules/final/2024/34-100155.pdf
- SEC 2026 Examination Priorities: https://www.sec.gov/files/2026-exam-priorities.pdf
