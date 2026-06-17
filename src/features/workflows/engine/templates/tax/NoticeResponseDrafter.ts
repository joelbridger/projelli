// Tax Practice Pack v2.2 (shipped). Built with input from practicing CPAs and EAs.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full legal name of the taxpayer receiving the notice. Used in the response letter heading.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Margaret T. Okonkwo',
  },
  {
    id: 'taxpayerIdLastFour',
    question: 'Last four digits of taxpayer SSN or EIN',
    description: 'Used in the response letter subject line for IRS identification purposes. Do not enter the full SSN.',
    type: 'text',
    required: true,
    placeholder: 'e.g., 7842',
  },
  {
    id: 'noticeType',
    question: 'Notice type',
    description: 'Select the type of notice received. Each type has a different scope and response posture.',
    type: 'select',
    required: true,
    options: [
      'CP2000, Underreporter inquiry (automated mismatch)',
      'CP2501, Income discrepancy (pre-CP2000 contact)',
      'Letter 525, General 30-day letter (proposed adjustments after audit)',
      'Letter 531, 90-day letter (statutory notice of deficiency)',
      'Letter 2205, Audit appointment letter',
      'State notice, Income discrepancy or adjustment',
      'State notice, Audit or examination',
      'Other / unknown notice type',
    ],
    defaultValue: 'CP2000, Underreporter inquiry (automated mismatch)',
  },
  {
    id: 'noticeNumber',
    question: 'Notice number and date',
    description: 'The full notice or letter number as printed on the notice, and the date the notice is dated. Both appear in the response subject line.',
    type: 'text',
    required: true,
    placeholder: 'e.g., CP2000, dated March 12, 2026',
  },
  {
    id: 'taxYearAtIssue',
    question: 'Tax year at issue',
    description: 'The tax year the notice covers.',
    type: 'text',
    required: true,
    placeholder: 'e.g., 2023',
  },
  {
    id: 'coreAllegation',
    question: 'Core allegation or proposed adjustment',
    description: 'What is the IRS or state agency claiming? Describe the proposed change in as much detail as you have, income not reported, deduction disallowed, credit adjusted, etc. Include dollar amounts where available.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., The CP2000 proposes $14,200 of additional income based on a 1099-NEC from Acme Corp that does not appear on the filed return. The IRS is asserting $2,984 in additional tax plus $149 in failure-to-pay penalty.',
  },
  {
    id: 'clientExplanation',
    question: 'Client\'s explanation',
    description: 'The client\'s account of why the proposed adjustment is incorrect, or the facts that support a partial or full concession. Be specific, include amounts, dates, and how income was actually reported if at all.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., The $14,200 from Acme Corp was reported, but under a different EIN, the client operates through an LLC (EIN 45-6789012) and the income appeared on the LLC\'s Schedule C, which flows through to the 1040. The income was not omitted, it was reported differently than the 1099 matched. Client has the LLC operating agreement and 2023 Schedule C to show.',
  },
  {
    id: 'documentsAvailable',
    question: 'Supporting documents available',
    description: 'List all documents the client has that support the response. These will become the exhibit list in the letter.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 1. 2023 Form 1040 with all schedules (filed return)\n2. Schedule C showing $14,200 of income from Acme Corp\n3. LLC operating agreement (Exhibit C)\n4. 1099-NEC from Acme Corp (Exhibit D)\n5. Bank statements showing deposit of $14,200 in March 2023',
  },
  {
    id: 'responseDeadline',
    question: 'Response deadline',
    description: 'The deadline for responding to this notice, as stated in the notice itself. Include whether an extension has been or will be requested.',
    type: 'text',
    required: true,
    placeholder: 'e.g., April 28, 2026 (60-day response window). Extension not yet requested.',
  },
  {
    id: 'stateAgencyName',
    question: 'State agency name (if state notice)',
    description: 'If this is a state notice, the name of the state tax authority sending it.',
    type: 'text',
    required: false,
    placeholder: 'e.g., California Franchise Tax Board or New York State Department of Taxation and Finance',
  },
];

const noticeResponseDrafterPrompt = `You are assisting a licensed tax professional in drafting a structured response letter to an IRS or state tax notice. This letter must be professional, precise, and organized so the examiner can follow the response without ambiguity. Do not give legal advice, produce a draft the practitioner will review and sign.

Client name: {{clientName}}
Last four digits of SSN/EIN: {{taxpayerIdLastFour}}
Notice type: {{noticeType}}
Notice number and date: {{noticeNumber}}
Tax year at issue: {{taxYearAtIssue}}
Core allegation / proposed adjustment: {{coreAllegation}}
Client's explanation: {{clientExplanation}}
Documents available: {{documentsAvailable}}
Response deadline: {{responseDeadline}}
State agency name (if applicable): {{stateAgencyName}}

Produce a complete draft response letter in Markdown. At the top, include the draft notice.

> **Draft document**, This draft must be reviewed by the practitioner before sending. Verify all amounts, dates, and regulatory references before submission.

---

**[PRACTITIONER: Print on firm letterhead. Remove all bracketed notes before sending. Retain a copy with the response deadline notation in the client file.]**

---

[Date]

Internal Revenue Service
[Or: {{stateAgencyName}}]
[Address from notice, practitioner: use the exact address printed on the notice for this type]

---

**Re:** Response to {{noticeNumber}}
**Taxpayer:** {{clientName}}
**Taxpayer ID (last 4):** XXX-XX-{{taxpayerIdLastFour}}
**Tax year:** {{taxYearAtIssue}}
**Response deadline:** {{responseDeadline}}

---

Dear Sir or Madam:

We are writing on behalf of our client, {{clientName}} (SSN/EIN ending in {{taxpayerIdLastFour}}), in response to {{noticeNumber}} dated [date from notice], regarding the {{taxYearAtIssue}} tax year.

[If CP2000 or CP2501: Add one sentence acknowledging receipt of the automated notice and that this letter constitutes the taxpayer's timely response.]

[If Letter 525 or 531: Add one sentence noting the proposed adjustments as stated in the 30-day/90-day letter and that this letter addresses each item.]

---

## Response to Proposed Adjustments

[For each distinct allegation or proposed adjustment in the notice, address it in a numbered section. If there is only one allegation, one section is sufficient. Structure each section as follows:]

### Item 1: [Brief description of the allegation, e.g., "Proposed additional income: $14,200 from Acme Corp"]

**The IRS/agency position:** [Restate the allegation in one sentence, including dollar amount if applicable.]

**Our response:** [State clearly whether the client agrees, disagrees, or partially agrees.]

**Facts:** [Provide the factual explanation of why the proposed adjustment is incorrect or should be modified. Write in the third person, "The taxpayer..." or "Our client...". Be specific: amounts, dates, forms, line numbers. Do not use hedging language where the facts are clear.]

**Supporting documents:** [List the specific exhibits enclosed that support this item, by exhibit number. E.g., "See Exhibit A (2023 Schedule C) and Exhibit B (LLC operating agreement)."]

[If the client is conceding part of a proposed adjustment, state exactly what is being conceded and what the revised tax liability would be. Be precise.]

---

[Repeat for each additional allegation in the notice.]

---

## Enclosed Exhibits

[List all documents being submitted with this letter, numbered in the order referenced above:]

[Number each document from the documentsAvailable list provided. Assign exhibit letters or numbers. Example:]
- **Exhibit A:** [First document name and brief description]
- **Exhibit B:** [Second document name and brief description]
- [Continue for all documents listed]

---

## Request for Confirmation

We request written confirmation that this response has been received and is being processed. Please direct any questions or requests for additional information to the undersigned at the contact information below.

If additional time is needed to respond to any aspect of this notice, please contact us before [response deadline] so we may request an extension if necessary.

---

Respectfully submitted,

[Practitioner name]
[Credentials, e.g., CPA, EA]
[Firm name]
[Address]
[Phone]
[Email]

Enclosures: [List exhibit names, comma-separated]

---

> **Compliance note:** This draft must be reviewed by the practitioner before sending. Verify all amounts, dates, and regulatory references. Confirm the response deadline on the notice itself, deadlines for Letter 531 (90-day statutory notice of deficiency) are firm; missing them forfeits Tax Court rights. For Letter 531 responses, consult with tax counsel before deciding whether to petition the Tax Court.

---

> **Practitioner checklist before sending:**
> - [ ] All dollar amounts in the letter match the notice and supporting documents
> - [ ] Response deadline confirmed from the notice itself
> - [ ] All listed exhibits are physically included in the mailing
> - [ ] Letter is signed
> - [ ] Sent via certified mail, return receipt requested (keep the USPS Form 3800 tracking number)
> - [ ] Copy retained in client file with mailing date noted
> - [ ] If CP2000 and client agrees: include payment or installment agreement request if applicable
> - [ ] If Letter 531: confirm whether client intends to petition Tax Court before the 90-day deadline, this letter alone does not preserve that right`;

export const NoticeResponseDrafter: WorkflowTemplate = {
  id: 'tax-notice-response-drafter',
  name: 'IRS / State Notice Response Drafter',
  description: 'Drafts a structured response letter to an IRS or state tax notice (CP2000, CP2501, Letter 525, audit letters, state equivalents). Produces a letter organized point-by-point around the notice\'s allegations, with a numbered exhibit list and a request for confirmation of receipt. Includes a practitioner checklist and compliance note. The draft must be reviewed by the practitioner before sending.',
  version: '1.0.0',
  category: 'tax',
  requiresVerification: true,
  verificationNote: 'Verify every factual assertion and deadline posture against the actual notice and primary IRC authority before sending to the IRS or sharing with your client.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Notice & Response Details',
      description: 'Provide the notice type, client explanation, supporting documents, and response deadline',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-notice-response',
      type: 'generate',
      name: 'Generate Notice Response Letter',
      description: 'Draft the structured response letter with point-by-point response, exhibit list, and practitioner checklist',
      config: {
        outputFile: 'NOTICE_RESPONSE_LETTER.md',
        promptTemplate: noticeResponseDrafterPrompt,
        systemPrompt: 'You are a tax practice assistant helping a licensed CPA or EA draft a professional response to an IRS or state tax notice. You organize the response so the examiner can follow it without ambiguity: each allegation gets its own numbered section with the agency position restated, the taxpayer\'s response, the supporting facts, and the exhibits that back it up. You are precise with dollar amounts, form numbers, and exhibit references. You flag critical procedural points like CP2000 deadlines and the Tax Court rights implications of Letter 531 in the compliance note. You write in a professional but not legalistic tone. You always include the practitioner checklist and compliance note and never omit the instruction that the draft must be reviewed before sending.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['NOTICE_RESPONSE_LETTER.md'],
  namedOutputs: [
    { id: 'response_letter', name: 'Draft notice response letter', schema: 'string' },
    { id: 'exhibit_list', name: 'Enclosed exhibits list', schema: 'array' },
    { id: 'practitioner_checklist', name: 'Pre-send checklist', schema: 'array' },
  ],
};

export default NoticeResponseDrafter;
