# Advisor Prep Hero Compliance & Security Pack

Draft date: 2026-07-09
Audience: Chief Compliance Officer, outside RIA compliance consultant, security reviewer
Status: Draft for review. This is not legal or compliance advice.

This pack is the "for your compliance officer" deliverable for Advisor Prep Hero. It is written so a firm can decide whether and how to approve the product, especially for client-data work under Regulation S-P, Rule 204-2, Rule 206(4)-7, and SEC scrutiny of AI claims.

## One-page CCO summary

Advisor Prep Hero is a local-first desktop application. The most important point for compliance review is simple:

**Client files stay on the advisor's computer. Advisor Prep Hero does not upload the firm's documents, notes, AI chats, client map, local search index, or audit log to Advisor Prep Hero servers.**

That architecture changes the review from "another cloud AI vendor holding client files" to "desktop software that can call an approved AI provider only in the mode the firm allows."

## What the product does

Advisor Prep Hero helps an advisor search client files, ask questions, prepare meeting briefs, draft follow-up work, and keep a cited client map. The product is a drafting and review workspace. It is not a discretionary trading system, portfolio management engine, robo-adviser, account custodian, or payment tool.

AI output is work product for a human advisor to review. The product should be approved only with a human-review rule: no client communication, recommendation memo, advertisement, CRM write-back, account-opening data, or other external action should be used without advisor review and firm-supervisory procedures.

## The three AI modes a firm can approve

| Mode | What happens | Compliance posture |
|---|---|---|
| Local-only | AI runs on the advisor's machine, using Advisor Prep Hero Local AI if available in the firm's build, or the advisor's own Ollama setup. Prompts and files do not go to a cloud AI provider. | Strongest confidentiality posture. No AI provider receives client information through this path. |
| Direct cloud | The advisor's machine sends the prompt directly to the firm's approved AI provider, using the firm's or advisor's own API key. Advisor Prep Hero is not in the request path. | The AI provider, not Advisor Prep Hero, is the vendor that receives prompt content and needs approval under the firm's policy. |
| Firm Assured | If enabled for a firm, AI requests route through Advisor Prep Hero's zero-retention relay using the firm's managed provider key. Advisor Prep Hero says it retains no prompt or completion content in this path. | Firm-tier option. Requires contract/DPA review and should not be approved until the firm has the signed agreement and current technical evidence. |

The web demo should not be approved for real client information.

## What Advisor Prep Hero servers normally see

In normal desktop use, Advisor Prep Hero servers see licensing and product-delivery data, not client files:

- License check: license key, machine identifier, app/license status.
- Update check: public update manifest and release download.
- Optional telemetry, if enabled: anonymous install ID, app version, platform, lifecycle events, license tier, and days since install. No client content, files, prompts, email, or search queries.
- Optional design-partner diagnostics, if enabled: structure-only counts and internal IDs, not content.
- Optional support/bug report: the message and attachments the user chooses to submit.
- Firm sync, if enabled: encrypted collaboration blobs/ciphertext, not plaintext content.

## What still needs the firm's approval

Local-first does not remove the firm's compliance job. It makes the review narrower.

The firm should approve:

- Which AI mode is allowed: local-only, direct cloud, firm Assured, or a mix by use case.
- Which AI providers are approved, under which firm-owned account and terms.
- Whether the firm requires zero-data-retention or no-training settings from the AI provider.
- Whether Advisor Prep Hero may connect to CRM, email, calendar, custodian, or other systems.
- How Advisor Prep Hero records are archived into the firm's books-and-records system.
- Whether optional telemetry, diagnostics, support uploads, or firm sync are allowed.
- Who is trained to use the product and who supervises the output.

## Contents

1. [01-data-flow.md](01-data-flow.md) - data-flow memo, described diagram, and Reg S-P mapping.
2. [02-security-controls.md](02-security-controls.md) - encryption, key storage, access controls, updates, logging, deletion, and safeguards mapping.
3. [03-ai-use.md](03-ai-use.md) - AI providers, prompt contents, no-training precision, citations, hallucination controls, human approval, and AI-washing guardrails.
4. [04-vendor-due-diligence.md](04-vendor-due-diligence.md) - filled vendor questionnaire, SOC 2 status, incident response, BCP/DR, subprocessors, retention, and contacts.
5. [05-incident-response-regs-p.md](05-incident-response-regs-p.md) - Reg S-P incident-response and notice support story.
6. [06-records-retention.md](06-records-retention.md) - AI chats, drafts, citations, approvals, audit logs, archiving, deletion, and Rule 204-2 mapping.
7. [07-wisp-wsp-language.md](07-wisp-wsp-language.md) - paste-ready WISP/WSP language for firm policies.

## Research checklist coverage

| Research checklist item | Covered in |
|---|---|
| 1. Data-flow memo and diagram | 01 |
| 2. Security controls packet | 02 |
| 3. AI-use packet | 03 |
| 4. Vendor due-diligence packet | 04 |
| 5. Incident response and notice packet | 05 |
| 6. Records and retention guide | 06 |
| 7. Marketing and client-content review guide | 03, 07 |
| 8. Contract/DPA package | 04, plus legal contract work still needed |
| 9. CCO implementation kit | 07 |
| 10. XYPN/trusted-list packet | This pack is the core security/compliance evidence. Partner proof still needs [member references], [support SLA], [pricing sheet], and [approved-list application owner]. |

## Compliance sources used

- Regulation S-P, 17 CFR Part 248, especially 17 CFR 248.30: https://www.ecfr.gov/current/title-17/chapter-II/part-248
- Investment Advisers Act Rule 204-2, books and records: https://www.ecfr.gov/current/title-17/chapter-II/part-275/section-275.204-2
- Investment Advisers Act Rule 206(4)-7, compliance policies and procedures: https://www.ecfr.gov/current/title-17/chapter-II/part-275/section-275.206%284%29-7
- Investment Advisers Act Rule 206(4)-1, marketing rule: https://www.ecfr.gov/current/title-17/chapter-II/part-275/section-275.206%284%29-1
- SEC Reg S-P 2024 final rule release: https://www.sec.gov/files/rules/final/2024/34-100155.pdf
- SEC 2026 Examination Priorities: https://www.sec.gov/files/2026-exam-priorities.pdf
- SEC AI-washing enforcement release, 2024: https://www.sec.gov/newsroom/press-releases/2024-36
