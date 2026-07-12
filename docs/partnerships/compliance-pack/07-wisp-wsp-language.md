# 07 - Paste-Ready WISP/WSP Policy Language

Draft date: 2026-07-09
Audience: CCO, RIA compliance consultant
Status: Draft for review. This is not legal or compliance advice.

Use this as starting language for a firm's Written Information Security Program (WISP) and Written Supervisory Procedures (WSP). A qualified compliance professional should adapt it to the firm's actual systems, registration status, state rules, client base, vendors, and recordkeeping program.

## Policy title

Advisor Prep Hero and AI-Assisted Client Work Policy

## Purpose

[Firm name] permits approved personnel to use Advisor Prep Hero as a supervised drafting, retrieval, and client-file analysis tool. Advisor Prep Hero is local-first desktop software. Client workspace files are intended to remain on firm-approved devices or firm-approved storage, not in an Advisor Prep Hero cloud workspace.

This policy is designed to support:

- Protection of customer information under Regulation S-P.
- Books-and-records retention under Rule 204-2.
- Compliance policies and procedures under Rule 206(4)-7.
- Truthful, substantiated marketing and AI claims under Rule 206(4)-1 and SEC AI-washing guidance.

Advisor Prep Hero output is not final advice. It is draft work product that requires human review.

## Approved users

Only the following personnel may use Advisor Prep Hero for client work:

- [Approved role/team]
- [Approved role/team]
- [Approved role/team]

The CCO or designee maintains the approved-user list and reviews access at least annually and during employee onboarding/offboarding.

## Approved AI modes

[Firm name] approves the following Advisor Prep Hero modes:

| Mode | Status | Conditions |
|---|---|---|
| Local-only | [approved/not approved] | Use for the most sensitive client work. Prompts and file content must remain on the device. |
| Direct cloud | [approved/not approved] | Use only with the approved providers and accounts listed below. |
| Firm Assured | [approved/not approved] | Use only after DPA, provider zero-retention evidence, and CCO approval are on file. |
| Web demo | Not approved for client data | No client names, files, account data, or other customer information may be used in the web demo. |

## Approved AI providers

| Provider | Status | Approved account/tier | Required settings | Notes |
|---|---|---|---|---|
| Advisor Prep Hero Local AI | [approved/not approved] | Local, if available in the firm's build | No cloud inference | [notes] |
| Ollama/local model | [approved/not approved] | Local | Confirm model runs locally | [notes] |
| Anthropic API | [approved/not approved] | [account/tier] | [retention/training settings] | [notes] |
| OpenAI API | [approved/not approved] | [account/tier] | [retention/training settings] | [notes] |
| Google Gemini API | [approved/not approved] | [account/tier] | [retention/training settings] | [notes] |

Consumer AI accounts, including consumer ChatGPT or consumer Claude plans, are not approved for client information unless separately approved in writing by the CCO.

## Prohibited uses

Personnel may not use Advisor Prep Hero to:

- Send client information to an unapproved AI provider.
- Use the web demo with real client data.
- Copy client files, client names, account numbers, Social Security numbers, tax IDs, health information, authentication credentials, or other sensitive customer information into consumer AI tools.
- Use AI output as final advice without human review.
- Let AI make discretionary recommendations, trades, account changes, payment changes, beneficiary changes, or custody-related changes.
- Publish AI-generated marketing, performance, testimonial, endorsement, website, newsletter, or social-media content without compliance review.
- Send client content to Advisor Prep Hero support unless the CCO approves and the submission is logged.
- Use cross-client/all-matters search unless the CCO has approved the use case.
- Disable required audit, archive, or retention steps.
- State that Advisor Prep Hero is "SEC approved," "compliant by default," or "SOC 2 certified" unless the firm has current evidence supporting the exact claim.

## Human-review rule

All Advisor Prep Hero output is draft work product. Before using it, the responsible advisor or supervised person must:

1. Review the full output.
2. Open and review cited source material for material claims.
3. Resolve missing, weak, or unverified citations.
4. Confirm the output is fair, balanced, and not misleading.
5. Confirm the output fits the client's facts and the firm's policies.
6. Save required records to the firm's approved archive.
7. Obtain any required principal, CCO, or supervisor approval before external use.

No client communication, recommendation, compliance note, advertisement, CRM write-back, custodian submission, or account-opening data may be sent solely because Advisor Prep Hero produced it.

## Client-data handling rule

Users must keep client information inside approved systems:

- Use firm-approved devices.
- Use firm-approved workspace storage.
- Keep full-disk encryption enabled.
- Use Local-only mode for client work classified as [highest sensitivity category].
- Use direct cloud mode only with approved provider accounts.
- Do not upload client files to support or bug-report forms without CCO approval.
- Do not move Advisor Prep Hero workspaces to personal cloud drives or personal devices.
- Report any lost device, suspected unauthorized access, accidental cloud send, or support upload involving client data immediately.

## Connector rule

Advisor Prep Hero connectors may be used only after CCO approval.

Approved connectors:

| Connector | Status | Conditions |
|---|---|---|
| Email import | [approved/not approved] | [conditions] |
| Wealthbox | [approved/not approved] | [conditions] |
| Microsoft 365 | [approved/not approved] | [conditions] |
| Google Workspace | [approved/not approved] | [conditions] |
| Calendar | [approved/not approved] | [conditions] |
| Custodian/account-opening path | [approved/not approved] | [conditions] |

Any write-back to CRM, email, calendar, custodian, or another external system requires user review of the exact content to be sent before submission.

## Recordkeeping rule

Users must preserve Advisor Prep Hero records that relate to advisory business, including:

- AI chats and prompts when material to advice, recommendations, client communications, or compliance decisions.
- Generated drafts and final outputs.
- Source citations.
- Review and approval notes.
- Egress/audit logs.
- CRM/email/custodian write-back records.
- Marketing drafts and compliance approvals.
- Incident reports and related evidence.

Required records must be saved to [firm archive location]. The local Advisor Prep Hero workspace is a working location and may not be the sole official archive.

Default retention period: [firm retention period], subject to Rule 204-2, state law, firm policy, and legal holds.

## Marketing and client communication rule

AI-generated client or public-facing content must go through normal firm review before use. This includes:

- Client emails and letters.
- Newsletters.
- Website copy.
- Social posts.
- Seminar/webinar scripts.
- Performance language.
- Testimonials and endorsements.
- Third-party ratings.
- Any claim about AI, privacy, security, compliance, or product capabilities.

Users must not make unsubstantiated AI or privacy claims. The CCO must be able to substantiate material claims on demand.

## Incident escalation rule

Users must notify the CCO or designee immediately if:

- A device with Advisor Prep Hero workspace data is lost or stolen.
- A workspace may have been accessed by an unauthorized person.
- Client data was sent to an unapproved AI provider.
- Client data was sent to support without approval.
- A connector sent or wrote incorrect information.
- An AI output was sent externally before required review.
- Advisor Prep Hero or an AI provider sends a security notice.

The CCO will determine whether the firm's Regulation S-P incident-response program is triggered.

## Training

Before using Advisor Prep Hero for client work, users must complete training covering:

- Local-only vs direct cloud vs Assured mode.
- Approved AI providers.
- What data can leave the device.
- Citation review.
- Hallucination risk.
- Recordkeeping.
- Support-upload restrictions.
- Incident reporting.
- Marketing/client communication review.

Training completion must be documented and retained.

## Annual review

At least annually, the CCO or designee will review:

- Whether Advisor Prep Hero remains approved.
- Whether approved AI providers and terms have changed.
- Whether local-only, direct cloud, or Assured mode remains appropriate.
- Whether telemetry/diagnostics/support settings remain appropriate.
- Whether records are being archived correctly.
- Whether incidents, exceptions, or user mistakes occurred.
- Whether this policy needs updates.

This annual review supports Rule 206(4)-7.

## Approval record

| Item | Approval |
|---|---|
| CCO approval date | [date] |
| Compliance consultant review | [name/date] |
| Approved modes | [modes] |
| Approved providers | [providers] |
| Approved connectors | [connectors] |
| Required archive location | [archive location] |
| Next annual review date | [date] |

## Sources

- 17 CFR 248.30, Reg S-P safeguards, response programs, service providers, and disposal: https://www.ecfr.gov/current/title-17/chapter-II/part-248
- 17 CFR 275.204-2, books and records: https://www.ecfr.gov/current/title-17/chapter-II/part-275/section-275.204-2
- 17 CFR 275.206(4)-7, compliance policies and procedures: https://www.ecfr.gov/current/title-17/chapter-II/part-275/section-275.206%284%29-7
- 17 CFR 275.206(4)-1, investment adviser marketing: https://www.ecfr.gov/current/title-17/chapter-II/part-275/section-275.206%284%29-1
- SEC AI-washing enforcement release, 2024: https://www.sec.gov/newsroom/press-releases/2024-36
