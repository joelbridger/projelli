// Advisor Practice Pack v1.0 (shipped). Built with input from practicing advisors.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'advisorName',
    question: 'Advisor / firm name',
    description: 'Your name and firm name for the document header. This appears as the owner of the inventory.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Patricia Nguyen, CFP, Clearwater Financial Advisors',
  },
  {
    id: 'primaryCustodians',
    question: 'Primary custodian(s)',
    description: 'Which custodian(s) hold your clients\' assets? List all platforms where client assets are custodied.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Fidelity Institutional, Schwab Advisor Services, TD Ameritrade (now Schwab)',
  },
  {
    id: 'maintainLocalStatements',
    question: 'Do you maintain local copies of client statements?',
    description: 'Whether you download and store copies of client account statements on your own computer or office systems.',
    type: 'select',
    required: true,
    options: [
      'Yes, on local hard drive',
      'Yes, on encrypted external drive',
      'Yes, on office server',
      'Yes, in cloud storage (e.g., Dropbox, Google Drive)',
      'No, statements live only at the custodian portal',
    ],
    defaultValue: 'Yes, on local hard drive',
  },
  {
    id: 'hasPaperFiles',
    question: 'Do you maintain paper files for clients?',
    description: 'Whether you keep physical paper files, intake forms, signed documents, correspondence, etc.',
    type: 'select',
    required: true,
    options: [
      'Yes, locked file cabinet in office',
      'Yes, not locked / general office storage',
      'Minimal, some paper, mostly digital',
      'No, fully digital',
    ],
    defaultValue: 'Yes, locked file cabinet in office',
  },
  {
    id: 'crmOrPracticeManagement',
    question: 'CRM or practice management software (optional)',
    description: 'If you use a CRM or practice management platform that stores client data (Redtail, Wealthbox, Salesforce Financial Services, etc.), list it here.',
    type: 'text',
    required: false,
    placeholder: 'e.g., Redtail CRM, Orion Advisor Suite',
  },
  {
    id: 'additionalDataSystems',
    question: 'Other data systems or storage locations (optional)',
    description: 'Any other places where client data lives, financial planning software, tax prep tools, email, video call recordings, etc.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., eMoney Advisor for financial plans, DocuSign for signed agreements, Zoom recordings (cloud), email on Microsoft 365',
  },
];

const confidentialClientDataInventoryPrompt = `You are assisting a financial advisor in creating a structured inventory of the client data types they hold and where each type is stored. This document supports the advisor's information security planning, including their Written Information Security Program (WISP) and their understanding of data subject to Regulation S-P. You are not drafting a WISP or providing legal or compliance advice, you are helping the advisor organize their own knowledge of what data they hold and where.

Advisor / firm name: {{advisorName}}
Primary custodian(s): {{primaryCustodians}}
Local statement copies: {{maintainLocalStatements}}
Paper files: {{hasPaperFiles}}
CRM or practice management software: {{crmOrPracticeManagement}}
Other data systems: {{additionalDataSystems}}

Produce a structured client data inventory in Markdown. At the top, include the draft notice.

> **Advisor working document**, Review for completeness and accuracy before filing or using in compliance work.

---

# Client Data Inventory
**Firm / Advisor:** {{advisorName}}
**Prepared:** [date]
**Custodian(s):** {{primaryCustodians}}

---

## Purpose of This Document

This inventory documents the types of client data held by {{advisorName}} and the primary storage location for each type. It is intended to support information security planning, including Written Information Security Program (WISP) development, and to help the advisor understand their data footprint.

> **Important:** This document does not constitute a WISP or a compliance filing. Regulation S-P (the SEC's privacy rule for broker-dealers and investment advisers) and applicable state privacy laws impose specific obligations regarding the safeguarding and disposal of customer records and information. For full Regulation S-P compliance, consult your compliance consultant about your complete information-security program. This document is a starting point for that conversation, not a substitute for it.
>
> ${BRAND.possessive} local-first architecture keeps your client data on your machine. For full Regulation S-P compliance, consult your compliance consultant about your complete information-security program.

---

## Client Data Inventory Table

| Data Type | Description | Primary Storage Location | Secondary / Backup Location | Risk Note |
|---|---|---|---|---|
| **Account statements** | Periodic statements from custodian(s) showing holdings and transactions | [Custodian portal / local copies per inputs] | [From inputs] | Statements contain account numbers, balances, and transaction history, high sensitivity. Local copies extend the attack surface beyond the custodian's systems. |
| **Account numbers** | Client account numbers at custodian(s) | Custodian portal; may appear in statements, emails, or CRM | [CRM if applicable] | Account numbers are a primary target for fraud. Minimize local storage; avoid sending by unencrypted email. |
| **Social Security numbers** | Client SSNs used for tax reporting, account opening, and identity verification | Custodian portal; may appear in paper intake forms | [Paper files per inputs] | SSNs are the highest-sensitivity identifier. Confirm where these live and whether paper copies are necessary. |
| **Tax returns and tax documents** | Client-provided 1040s, W-2s, 1099s, K-1s used in financial planning | [From inputs, local, CRM, or planning software] | | Tax documents contain SSNs, income, and asset details. Retention period and disposal method should be defined in your WISP. |
| **Financial plans and projections** | Written financial plans, Monte Carlo outputs, retirement projections | [Financial planning software per inputs; local if downloaded] | | Plans contain comprehensive financial data. Access should be limited to the advisor and authorized staff. |
| **Investment policy statements** | Client-signed IPS documents stating risk tolerance, objectives, and guidelines | [CRM, local files, or paper per inputs] | | Signed documents establish the advice relationship and must be retained per regulatory requirements. |
| **Insurance policies** | Client insurance documents (life, disability, LTC, property) reviewed or referenced in planning | [Local or paper per inputs] | | Insurance policy documents may contain beneficiary names, coverage amounts, and health information. |
| **Estate documents** | Client-provided wills, trusts, powers of attorney, and healthcare directives reviewed in planning | [Local or paper per inputs] | | Estate documents are highly sensitive and may include information about family members who are not clients. |
| **KYC / intake forms** | Know Your Customer documents, new account applications, client questionnaires | [Paper or CRM per inputs] | | Intake forms often contain the broadest set of client personal information including household income, net worth, and employment. |
| **Signed agreements** | Client engagement agreements, fee disclosures, advisory agreements | [DocuSign or similar; paper per inputs] | | Signed agreements should be retained for the full regulatory retention period (typically 5 years for RIAs). |
| **Email correspondence** | Email with clients and about client matters | [Email platform per inputs] | Email provider's servers | Email is often the least-secured data store. Avoid transmitting sensitive client data by unencrypted email. |
| **Meeting notes and call logs** | Advisor notes from client meetings and phone calls | [CRM or local per inputs] | | Meeting notes document advice given and should be retained as part of the client file. |
| **Call or video recordings** | Recordings of client meetings or calls (if made) | [Cloud or local per inputs] | | Recordings may require client consent under state wiretapping laws. Confirm your state's requirements. |

---

## Data at Custodian Portals

The following custodian(s) hold the majority of primary account data:

{{primaryCustodians}}

**Note:** Data held at the custodian portal is primarily the custodian's security responsibility. However, advisors with view access bear responsibility for how that access is secured (strong passwords, MFA, access limited to authorized staff only).

---

## Paper File Inventory

[Based on the paper files input, describe what paper files exist and where they are stored. If the advisor has locked file cabinets, note that. If paper is not locked, flag that as a risk item to address.]

**Current paper file status:** {{hasPaperFiles}}

**Risk note:** Paper files containing client personal or financial information should be stored in a locked location when unattended, with access limited to authorized staff. A document destruction policy (cross-cut shredding at minimum) should cover all paper client data when retention periods expire.

---

## Local and Digital Storage Summary

| Storage Location | Data Types Stored There | Access Controls |
|---|---|---|
[Based on all inputs, generate a row for each distinct storage location: local hard drive, encrypted external drive, office server, CRM, financial planning software, email, custodian portal, cloud storage, paper files. For each, note the types of data stored there and what access controls are in place (or "unknown, review needed" if not clear from the inputs).]

---

## Recommended Next Steps

Based on the information provided, here are areas to review with your compliance consultant or IT security advisor:

[Generate 4–7 specific, actionable items based on what the advisor has shared. For example: if they have local copies of statements, flag data encryption. If paper files are not locked, flag physical security. If email is used for client data, flag encryption. If no formal data destruction policy was mentioned, flag that. Be specific to what was described, don't generate generic boilerplate that doesn't apply to this advisor's actual situation.]

1. [Item 1]
2. [Item 2]
3. [Item 3]
4. [Item 4]
5. [Item 5, if warranted]

---

*This inventory is a starting point for information security planning. It is not a legal document, a WISP, or a compliance filing. Consult your compliance consultant about your specific obligations under Regulation S-P and applicable state privacy laws. This output is a draft for the advisor's review, verify all locations and data types against your actual systems before using this document in compliance planning.*`;

export const ConfidentialClientDataInventory: WorkflowTemplate = {
  id: 'advisors-confidential-client-data-inventory',
  name: 'Confidential Client Data Inventory',
  description: 'Produces a structured inventory of client data types the advisor holds (financial statements, account numbers, tax returns, insurance policies, estate documents, etc.), where each type is stored, and a plain-language risk note per item, useful for WISP development and Regulation S-P awareness.',
  version: '1.0.0',
  category: 'advisors',
  requiresVerification: true,
  verificationNote: 'This inventory is a documentation aid, not a WISP or Reg S-P compliance plan. Have your compliance consultant review it.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Practice Data Locations',
      description: 'Describe your custodians, local data storage, paper files, and practice management systems',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-data-inventory',
      type: 'generate',
      name: 'Generate Client Data Inventory',
      description: 'Draft the structured inventory with storage locations, risk notes, and recommended next steps',
      config: {
        outputFile: 'CLIENT_DATA_INVENTORY.md',
        promptTemplate: confidentialClientDataInventoryPrompt,
        systemPrompt: `You are a financial advisory practice management assistant helping a licensed financial advisor create an inventory of the client data they hold. You are thorough and specific, you generate a complete inventory of realistic data types for an independent or small-firm financial advisor, not a generic checklist. You are careful to frame this as a starting point for compliance planning, not as a substitute for formal compliance work. You always include the Regulation S-P disclaimer and the recommendation to consult a compliance consultant. You flag concrete, specific security gaps based on what the advisor actually described, not generic boilerplate. You note that ${BRAND.possessive} local-first architecture keeps data on the advisor's machine, and you remind them to consult their compliance consultant for full Regulation S-P compliance.`,
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['CLIENT_DATA_INVENTORY.md'],
  namedOutputs: [
    { id: 'data_inventory_table', name: 'Client data inventory table', schema: 'array' },
    { id: 'storage_summary', name: 'Storage locations summary', schema: 'array' },
    { id: 'recommended_next_steps', name: 'Recommended security next steps', schema: 'array' },
  ],
};

export default ConfidentialClientDataInventory;
