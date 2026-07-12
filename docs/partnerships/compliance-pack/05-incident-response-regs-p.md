# 05 - Incident Response and Regulation S-P Notice Support

Draft date: 2026-07-09
Audience: CCO, RIA compliance consultant, security reviewer
Status: Draft for review. This is not legal or compliance advice.

## Executive summary

The 2024 Regulation S-P amendments require covered institutions to maintain an incident-response program for unauthorized access to or use of customer information, including customer-notice procedures. The rule also requires service-provider oversight. If a service provider has a breach involving a customer information system it maintains, the covered institution must be able to receive notice quickly enough to start its own response program.

Advisor Prep Hero's normal desktop architecture lowers the chance that an Advisor Prep Hero infrastructure breach exposes client workspace data, because the workspace is local. But the firm still needs a plan for:

- Device compromise.
- Local workspace loss or theft.
- AI provider incidents.
- Connector incidents.
- Support uploads containing client data.
- Firm sync or Assured relay incidents, if those paths are enabled.
- License/payment/support/telemetry incidents.

## Incident categories

| Category | Example | Does Advisor Prep Hero likely hold customer information? | Notice approach |
|---|---|---:|---|
| Local device incident | Lost laptop, malware, stolen device, compromised OS account | No server-side Advisor Prep Hero copy, but local client data may be affected | Firm handles under its incident-response program. Vendor can help explain product data locations. |
| Direct cloud AI provider incident | Approved AI provider reports exposure of API prompts | AI provider holds the prompt, not Advisor Prep Hero | Firm works with AI provider and uses Advisor Prep Hero audit logs to identify affected sends. |
| Connector provider incident | CRM/email/custodian breach | Connector provider holds data under firm's relationship | Firm handles under vendor incident process. |
| Advisor Prep Hero license service incident | License records exposed | Usually no client workspace content | Notify affected users as security/business incident; Reg S-P customer notice may not be triggered unless customer information is involved. |
| Optional telemetry/diagnostics incident | Anonymous lifecycle or structure-only events exposed | No content expected | Notify based on data involved; likely not client customer information if controls worked. |
| Support incident | Support ticket with client file attached is exposed | Yes, if user submitted client data | Reg S-P service-provider analysis may apply. Notify firm quickly with exact facts. |
| Firm encrypted sync incident | Ciphertext blobs or sync metadata exposed | Ciphertext may be customer information system data, depending on facts | Treat as potentially relevant; assess key exposure and metadata. |
| Firm Assured relay incident | Prompt content exposed during transit or logging failure | Yes, if enabled | Treat as customer-information impact until ruled out. 72-hour firm notice target applies. |

## Vendor notice commitment

Where Advisor Prep Hero acts as a service provider and becomes aware of a breach in security resulting in unauthorized access to a customer information system maintained by Advisor Prep Hero, Advisor Prep Hero should notify the covered institution as soon as possible and no later than 72 hours after becoming aware.

This commitment should be placed in the DPA or security exhibit. Current contract status: [DPA/security exhibit status].

The 72-hour notice is not the same thing as the firm's customer notice. It is the vendor-to-firm notice so the firm can begin its own Regulation S-P response program.

## Firm customer-notice support

Reg S-P requires the covered institution to notify affected individuals as soon as practicable, but not later than 30 days after becoming aware that unauthorized access to or use of customer information has occurred or is reasonably likely to have occurred, unless an allowed law-enforcement delay applies and unless the firm reasonably determines notice is not required after investigation.

Advisor Prep Hero should support the firm's 30-day analysis by providing:

- Date/time discovered.
- Date/time incident began and ended, if known.
- Systems affected.
- Whether Advisor Prep Hero customer information systems were involved.
- Whether prompt content, files, support attachments, ciphertext, metadata, license records, or telemetry records were involved.
- Whether sensitive customer information was accessed or reasonably likely accessed.
- Affected firm accounts, users, workspaces, clients, or systems, if known.
- Types of information involved.
- Whether data was encrypted and whether keys were affected.
- Containment steps taken.
- Investigation status.
- Recommended customer-protection steps, if any.
- Contact for follow-up.

## Response process

### 1. Intake and triage

Record:

- Reporter.
- Time received.
- Affected service.
- Suspected data types.
- Whether customer information may be involved.
- Whether the affected path is local-only, direct cloud, firm sync, Assured, support, license, or telemetry.

### 2. Contain

Depending on incident:

- Disable affected endpoint or key.
- Rotate secrets.
- Disable optional telemetry or diagnostics endpoint.
- Suspend firm relay or Assured route.
- Block compromised release/update artifact.
- Preserve evidence.

### 3. Assess customer-information impact

Ask:

- Did the incident involve customer information?
- Did it involve sensitive customer information?
- Was the information encrypted?
- Were encryption keys exposed?
- Which firms, users, clients, or workspaces may be affected?
- Did any prompt, file, email, support ticket, or attachment leave an approved path?
- Is substantial harm or inconvenience reasonably likely?

### 4. Notify the firm

If the incident is within Advisor Prep Hero's service-provider role and involves a customer information system, send the firm notice as soon as possible and no later than 72 hours after awareness.

Include facts known so far. Do not wait for perfect certainty if delay would prevent the firm from starting its required response program.

### 5. Support the firm's customer notice

The firm, not Advisor Prep Hero, is normally responsible for customer notice unless the contract says otherwise. Advisor Prep Hero should provide the facts the firm needs and cooperate with counsel/compliance.

### 6. Remediate and review

Document:

- Root cause.
- Systems affected.
- Data affected.
- Timeline.
- Customer/firms notified.
- Corrective actions.
- Control changes.
- Evidence retained.

## Notice fact sheet template

| Field | Response |
|---|---|
| Incident name | [incident name] |
| Advisor Prep Hero incident owner | [name/contact] |
| Firm incident owner | [name/contact] |
| Date/time discovered | [timestamp/time zone] |
| Date/time firm notified | [timestamp/time zone] |
| Affected service | [service] |
| Affected mode | [local-only/direct cloud/Assured/support/license/telemetry/firm sync/connector] |
| Customer information involved? | [yes/no/unknown] |
| Sensitive customer information involved? | [yes/no/unknown] |
| Data types | [files/prompts/email/support attachments/license records/metadata/ciphertext/etc.] |
| Encryption status | [encrypted/plaintext/unknown] |
| Key exposure? | [yes/no/unknown] |
| Number of firms affected | [number] |
| Number of users affected | [number] |
| Number of customers affected | [number/unknown] |
| Containment status | [status] |
| Customer protection steps | [steps] |
| Law enforcement contacted? | [yes/no/details] |
| Next update time | [timestamp/time zone] |

## Firm policy implications

The firm's WISP/WSP should say:

- Users must report lost devices, suspected unauthorized access, accidental client-data submission to support, and accidental cloud AI sends immediately.
- The CCO or designee reviews Advisor Prep Hero audit logs during an incident to identify AI sends, providers, prompts/chats, and affected client matters.
- Local-only mode should be used for the most sensitive matters unless the CCO approves a provider path.
- Client content may not be sent to support unless the CCO approves it and the firm logs it.
- Any vendor notice from Advisor Prep Hero starts the firm's Reg S-P incident-response analysis.

## Sources

- 17 CFR 248.30, safeguards, response programs, service providers, and customer notice: https://www.ecfr.gov/current/title-17/chapter-II/part-248
- SEC Reg S-P 2024 final rule release: https://www.sec.gov/files/rules/final/2024/34-100155.pdf
