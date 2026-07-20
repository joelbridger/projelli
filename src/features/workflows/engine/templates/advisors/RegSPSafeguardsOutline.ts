// Advisor Practice Pack v1.0 (shipped). Built with input from practicing advisors.
// Drafting aid: every generated output carries a banner requiring professional review before use.
// COMPLIANCE SENSITIVE: Reg S-P / 2024 amendments. Must be reviewed by qualified compliance professional before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'firmStructure',
    question: 'Firm structure',
    description: 'Describe your firm type, registration, and size.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., RIA, SEC-registered, 4 employees, 1 principal. No broker-dealer affiliation. $210M AUM.',
  },
  {
    id: 'numberOfClients',
    question: 'Number of clients',
    description: 'Approximate number of active client relationships.',
    type: 'text',
    required: true,
    placeholder: 'e.g., 85 households',
  },
  {
    id: 'systemTypes',
    question: 'System types used',
    description: 'What systems does your firm use to store, process, or transmit client data? Include CRM, portfolio management, financial planning software, email, cloud storage, and anything else that handles client information.',
    type: 'textarea',
    required: true,
    placeholder: `e.g., Orion (portfolio management), Salesforce (CRM), MoneyGuide Pro (financial planning), Microsoft 365 (email + SharePoint), ${BRAND.name} (AI-assisted client workflows), Dropbox (file sharing)`,
  },
  {
    id: 'dataCategories',
    question: 'Categories of client data handled',
    description: 'What categories of client data does your firm collect, store, or transmit? Check all that apply.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., SSNs, account numbers, tax returns, health information (for LTC planning), beneficiary data, estate documents, bank account / routing numbers',
  },
  {
    id: 'currentSafeguards',
    question: 'Current safeguards in place (if any)',
    description: 'Describe any information security safeguards you currently have: passwords, MFA, encryption, access controls, vendor agreements, employee training, etc. If you have a written policy, describe its scope.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., MFA on all Microsoft 365 accounts. Orion and Salesforce have their own security controls (vendor). No written firmwide safeguards policy. Employee security training not formalized. Vendor agreements in place for main custodian but not for all software vendors.',
  },
  {
    id: 'priorIncidents',
    question: 'Prior security incidents or near-misses (optional)',
    description: 'Any prior data security incidents, phishing attempts, or near-misses that should inform the risk assessment framework.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Phishing email targeting advisor in Q3 2024, caught before any credentials were compromised. No formal incident response was followed.',
  },
];

const regSPSafeguardsPrompt = `You are assisting a financial advisor in drafting a written safeguards outline and incident-response program framework keyed to the 2024 Reg S-P amendments. This is a starting framework only — it requires review and completion by a qualified compliance professional before it constitutes a compliant written program.

Firm structure: {{firmStructure}}
Number of clients: {{numberOfClients}}
System types: {{systemTypes}}
Data categories handled: {{dataCategories}}
Current safeguards: {{currentSafeguards}}
Prior incidents: {{priorIncidents}}

Produce a Reg S-P safeguards outline in Markdown. At the top, include the compliance notice.

> **This outline must be reviewed and completed by a qualified compliance professional before use. It is not a completed Reg S-P written safeguards program. The 2024 Reg S-P amendments require a written incident-response program — this template provides the starting framework only. Nothing in this document constitutes legal or compliance advice.**

---

# Written Safeguards and Incident Response Program Outline
**COMPLIANCE DRAFT — Requires qualified compliance review before finalization.**

**Firm:** [Firm name — complete before use]
**Prepared:** [date]
**Reg S-P reference:** 17 CFR Part 248, Subpart A, as amended by the 2024 amendments

---

## About This Document

[2–3 sentences explaining what this document is: a starting framework for the firm's written safeguards program under Reg S-P. State clearly that it is not a completed program, it requires a compliance professional to review and complete it, and the firm must adapt it to its specific facts and systems.]

---

## Part 1: Data Inventory

[Produce a data inventory table based on the inputs provided. Expand the system types into one row per system. For each system or data category, include:]

| System / Location | Data categories held | Access controls | Encryption at rest | Encryption in transit | Notes / gaps |
|---|---|---|---|---|---|
| {{systemTypes}} | | | | | |
| [Additional rows as appropriate] | | | | | |

**[COMPLIANCE NOTE]** This inventory is a draft based on the information provided. The firm must verify each row against its actual systems, access logs, and vendor agreements before finalizing. The inventory must be updated annually and when systems change.

---

## Part 2: Risk Assessment Framework

[Produce a risk assessment framework covering the firm's specific systems and data categories. Structure it as:]

### 2.1 Threat Categories

[List the relevant threat categories for a firm of this type and size:]
- Unauthorized access (external): phishing, credential theft, brute force
- Unauthorized access (internal): employee misuse, accidental disclosure
- Vendor / third-party breach
- Physical security: paper records, unlocked devices
- Business continuity: ransomware, data loss

### 2.2 Risk Assessment Table

| Threat | Likelihood (H/M/L) | Impact (H/M/L) | Current controls | Gap / residual risk |
|---|---|---|---|---|
| Phishing / credential theft | | | | |
| Vendor breach affecting one of the listed systems ({{systemTypes}}) | | | | |
| Unauthorized employee access | | | | |
| Physical records / device loss | | | | |
| Ransomware / data loss | | | | |

**[COMPLIANCE NOTE]** Likelihood and impact ratings must be completed by the firm based on its actual environment. This framework is a starting structure — the risk assessment must be conducted by someone with knowledge of the firm's actual operations.

---

## Part 3: Safeguard Categories

[Produce a safeguard framework organized by technical, physical, and administrative controls. For each control area, include the standard and a firm-specific placeholder:]

### 3.1 Technical Safeguards

| Control area | Standard requirement | Firm status | Action required |
|---|---|---|---|
| Multi-factor authentication | Required for all systems accessing covered data | [Complete based on inputs] | [Complete] |
| Encryption at rest | Required for covered data | [Complete] | [Complete] |
| Encryption in transit | Required for covered data | [Complete] | [Complete] |
| Access controls / least privilege | Users have only the access required for their role | [Complete] | [Complete] |
| Patch management | Systems patched on a defined schedule | [Complete] | [Complete] |
| Endpoint protection | Anti-malware on firm devices | [Complete] | [Complete] |

### 3.2 Physical Safeguards

| Control area | Standard requirement | Firm status | Action required |
|---|---|---|---|
| Physical access to systems | Workstations and servers in secured areas | [Complete] | [Complete] |
| Clear-desk / clean-screen policy | Physical documents secured when unattended | [Complete] | [Complete] |
| Paper record disposal | Shredding policy for physical records | [Complete] | [Complete] |
| Device management | Inventory and controls for firm-owned devices | [Complete] | [Complete] |

### 3.3 Administrative Safeguards

| Control area | Standard requirement | Firm status | Action required |
|---|---|---|---|
| Written safeguards program | Required (this document) | In progress | Complete and have reviewed by compliance |
| Employee training | Annual security awareness training | [Complete] | [Complete] |
| Vendor oversight | Written agreements with service providers | [Complete] | [Complete] |
| Due diligence on new vendors | Security review before engaging new service providers | [Complete] | [Complete] |

**[COMPLIANCE NOTE]** All [Complete] placeholders must be filled in with the firm's actual status before this table is used. The firm's compliance professional must assess whether the current controls satisfy the 2024 amendment requirements.

---

## Part 4: Incident Response Program Outline

[The 2024 Reg S-P amendments specifically require a written incident-response program. Produce the outline structure:]

### 4.1 Scope

This incident-response program covers any incident involving unauthorized access to, or use of, covered data held by [Firm name] or its service providers.

### 4.2 Detection and Assessment

**Detection procedures:**
- [How the firm will detect potential incidents: monitoring, employee reporting, vendor notification]
- [Contact for employee incident reports: [Name / role — complete before use]]
- [Vendor notification procedures: written agreements require vendors to notify the firm of incidents within [X days — complete before use]]

**Assessment criteria:**
[The firm must assess each potential incident to determine whether it constitutes a breach triggering notification requirements. Key questions:]
1. Was covered data accessed without authorization?
2. What categories of data were involved?
3. How many clients are affected?
4. Is there evidence of actual misuse or harm?

**[COMPLIANCE NOTE]** Assessment criteria and thresholds must be reviewed by your compliance professional against the 2024 amendment's specific notification triggers.

### 4.3 Notification Procedures

[The 2024 Reg S-P amendments require notification to affected individuals and, in certain cases, to regulators. This section is a framework — the specific triggers, timelines, and content requirements must be confirmed by your compliance professional:]

| Notification type | Trigger | Timeline | Content | Owner |
|---|---|---|---|---|
| Client notification | [Trigger — confirm with compliance] | [Timeline — confirm with compliance] | [Required content — confirm with compliance] | [Name / role] |
| Regulatory notification | [Trigger — confirm with compliance] | [Timeline — confirm with compliance] | [Required content — confirm with compliance] | [Name / role] |

**[COMPLIANCE NOTE]** The specific notification requirements under the 2024 amendments, including timelines and content, must be confirmed by your compliance professional before this table is used. Do not rely on this framework for actual notification decisions.

### 4.4 Containment and Remediation

[Steps to take once an incident is confirmed:]
1. Isolate affected systems
2. Preserve evidence (do not delete logs or data)
3. Assess scope — identify all affected data and clients
4. Remediate the cause
5. Restore systems from clean backups
6. Document all steps taken

### 4.5 Post-Incident Review

After each incident (or after any exercise), the firm should conduct a post-incident review covering: what happened, what controls failed, what was done well, and what changes are required to prevent recurrence. Document the review and retain it in the incident log.

---

## Part 5: Testing and Review Schedule

| Activity | Frequency | Owner | Last completed | Next due |
|---|---|---|---|---|
| Annual safeguards program review | Annual | [Principal / CCO] | [Date] | [Date] |
| Employee security training | Annual | [Principal / CCO] | [Date] | [Date] |
| Vendor security review | Annual or on material change | [Principal / CCO] | [Date] | [Date] |
| Incident response tabletop exercise | Annual (recommended) | [Principal / CCO] | [Date] | [Date] |
| Data inventory update | Annual or on system change | [Principal / CCO] | [Date] | [Date] |

---

*This outline is a starting framework for a written Reg S-P safeguards program. It is not a completed program, does not constitute legal or compliance advice, and does not substitute for review by a qualified compliance professional familiar with your firm's specific facts and the 2024 Reg S-P amendments. Finalize and implement this program only after compliance review.*`;

export const RegSPSafeguardsOutline: WorkflowTemplate = {
  id: 'advisors-reg-sp-safeguards-outline',
  name: 'Reg S-P Safeguards and Incident Response Outline',
  description: 'Structures a written safeguards outline and incident-response program framework keyed to the 2024 Reg S-P amendments. Produces a starting outline your compliance consultant reviews and completes.',
  version: '1.0.0',
  category: 'advisors',
  requiresVerification: true,
  verificationNote: 'This outline must be reviewed and completed by a qualified compliance professional. It is not a completed Reg S-P program. The 2024 amendments require a written incident-response program — this template provides the framework only.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Firm and Systems Information',
      description: 'Provide your firm structure, system types, data categories, and current safeguards',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-reg-sp-outline',
      type: 'generate',
      name: 'Generate Reg S-P Safeguards Outline',
      description: 'Produce a data inventory, risk assessment framework, safeguard categories, and incident-response outline',
      config: {
        outputFile: 'REG_SP_SAFEGUARDS_OUTLINE.md',
        promptTemplate: regSPSafeguardsPrompt,
        systemPrompt: 'You are a financial advisory compliance assistant helping an RIA or financial advisor produce a starting framework for a written Reg S-P safeguards program under the 2024 amendments. You are rigorous about what this document is and is not: it is a starting framework, not a completed program, and it requires qualified compliance review. Every section that requires firm-specific completion has explicit [COMPLIANCE NOTE] placeholders. You never state specific notification timelines, thresholds, or regulatory requirements without flagging that they must be confirmed by a compliance professional — the 2024 Reg S-P amendments are complex and firm-specific. The incident-response section is structured per the 2024 amendment requirements but clearly marked as a framework requiring compliance review before implementation.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['REG_SP_SAFEGUARDS_OUTLINE.md'],
  namedOutputs: [
    { id: 'data_inventory', name: 'Data inventory', schema: 'string' },
    { id: 'risk_assessment_framework', name: 'Risk assessment framework', schema: 'string' },
    { id: 'incident_response_outline', name: 'Incident response outline', schema: 'string' },
  ],
};

export default RegSPSafeguardsOutline;
