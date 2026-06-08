// Tax Practice Pack v2.2 (shipped). Built with input from practicing CPAs and EAs.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full name of the client for this engagement.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Donna L. Hargrove',
  },
  {
    id: 'taxYear',
    question: 'Tax year',
    description: 'The tax year this document request covers.',
    type: 'text',
    required: true,
    placeholder: 'e.g., 2025',
  },
  {
    id: 'engagementType',
    question: 'Engagement type',
    description: 'The type of return or returns being prepared.',
    type: 'select',
    required: true,
    options: ['Individual return', 'Business return', 'Both'],
    defaultValue: 'Individual return',
  },
  {
    id: 'incomeComplexity',
    question: 'Income situation complexity',
    description: 'The overall complexity of the client\'s income picture. This calibrates the scope of the document request.',
    type: 'select',
    required: true,
    options: [
      'Simple - W-2 only',
      'Moderate - some 1099s',
      'Complex - self-employment/investments/rental',
    ],
    defaultValue: 'Moderate - some 1099s',
  },
  {
    id: 'knownIssues',
    question: 'Known issues or special situations (optional)',
    description: 'Anything specific to this client\'s situation that should be reflected in the document request.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., sold rental property in 2025, first year with S-Corp K-1, possible amended prior year return',
  },
];

const clientDocumentInventoryPrompt = `You are assisting a licensed tax professional in generating a document request and inventory tracker for a client engagement. The output serves two purposes: a client-facing document request and an internal tracking tool.

Client name: {{clientName}}
Tax year: {{taxYear}}
Engagement type: {{engagementType}}
Income complexity: {{incomeComplexity}}
Known issues or special situations: {{knownIssues}}

Produce a two-part Markdown document. At the top, include the draft notice.

> **Draft document** — Review and edit before delivery.

---

# Document Request and Inventory
**Client:** {{clientName}}
**Tax year:** {{taxYear}}
**Engagement:** {{engagementType}}
**Prepared:** [date]

---

## Part 1: Client Document Request

*This section is formatted for sharing with the client directly.*

---

Dear {{clientName}},

To prepare your {{taxYear}} tax return(s), please provide the following documents. You can deliver them via [practitioner's preferred method]. If you are unsure whether a document applies to you, please include it — it is easier to review and return something that doesn't apply than to miss something important.

[Organize into sections based on the engagement type and complexity level. For each section, list the specific documents needed as a simple numbered or bulleted list the client can follow. Adjust the sections and items based on the engagement type and income complexity level:]

### Identity and Filing Information
[Tailor to the situation — e.g., if MFJ, request both spouses' SSN documents; if new client, driver's license / SSN card]

### Income Documents
[List all income documents relevant to the stated complexity level. For Simple: W-2(s). For Moderate: W-2(s), all 1099 forms received, any other income statements. For Complex: all of the above plus brokerage statements, K-1s, rental income and expense records, self-employment income documentation. If special situations were noted, include those specific items.]

### Deduction and Credit Documents
[Mortgage interest statement (Form 1098), charitable contribution receipts, medical expense records if itemizing, education expense records, childcare provider information, retirement contribution statements, any other deduction items relevant to this client's complexity level.]

[If business return is included: business income and expense records, mileage logs, asset purchase receipts, payroll records, etc.]

### Prior Year Information
[Prior year return (especially for new clients), any IRS or state correspondence received, carryover amounts if known]

### Other
[Any special situation items based on the known issues field]

Please return all documents by: [practitioner to fill in deadline]

Questions? Contact: [practitioner contact information]

---

## Part 2: Internal Document Tracker

*This section is for internal use — do not send to client.*

| Document | Date Requested | Date Received | Notes |
|----------|---------------|--------------|-------|
| [Each document listed in the client request gets its own row] | | | |

[Populate the tracker with a row for every document listed in Part 1. Leave the date columns blank for the practitioner to fill in. Add a notes column entry for any items flagged as likely to require follow-up based on the special situations noted.]

---

*Adjust the client-facing request for your firm's voice and any additional items specific to this client before sending.*`;

export const ClientDocumentInventory: WorkflowTemplate = {
  id: 'tax-client-document-inventory',
  name: 'Client Document Inventory',
  description: 'Creates a two-part document: a client-facing document request list organized by category (formatted for easy sharing) and an internal tracker table with columns for document, date requested, date received, and notes.',
  version: '1.0.0',
  category: 'tax',
  requiresVerification: true,
  verificationNote: 'Confirm all document items against the client\'s actual records before filing deadlines.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Engagement Information',
      description: 'Provide client details and engagement type to calibrate the document request',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-document-inventory',
      type: 'generate',
      name: 'Generate Document Request and Tracker',
      description: 'Build the client-facing document request and internal tracking table',
      config: {
        outputFile: 'CLIENT_DOCUMENT_INVENTORY.md',
        promptTemplate: clientDocumentInventoryPrompt,
        systemPrompt: 'You are a tax practice assistant helping a licensed CPA or EA generate a document request and tracking tool for a client engagement. You calibrate the document list precisely to the stated engagement type and income complexity — you do not include items that clearly do not apply. The client-facing section is written in plain, friendly language a non-accountant can follow. The internal tracker is formatted as a clean Markdown table the practitioner can update as documents come in.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['CLIENT_DOCUMENT_INVENTORY.md'],
  namedOutputs: [
    { id: 'client_request', name: 'Client document request', schema: 'string' },
    { id: 'internal_tracker', name: 'Internal document tracker', schema: 'string' },
  ],
};

export default ClientDocumentInventory;
