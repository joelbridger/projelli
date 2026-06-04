// @draft — Tax Practice Pack v2.2
// Requires CPA/EA advisor review before shipping. Do not expose to users without review.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full legal name of the taxpayer or entity being represented.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Hartwell Consulting Group LLC',
  },
  {
    id: 'tinMasked',
    question: 'TIN (last 4 digits only)',
    description: 'Enter the last 4 digits of the taxpayer identification number for reference. Do not enter the full TIN.',
    type: 'text',
    required: true,
    placeholder: 'e.g., XXXX-XXXX-1234',
  },
  {
    id: 'taxYearsPeriods',
    question: 'Tax years and periods at issue',
    description: 'List the specific tax years or periods covered by this representation.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Form 1040 for tax years 2022, 2023, and 2024; Form 941 for Q1-Q4 2023',
  },
  {
    id: 'matterType',
    question: 'Matter type',
    description: 'Describe the nature of the tax matter requiring representation.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Audit of Schedule C deductions; Balance due installment agreement negotiation; Collection alternative (OIC)',
  },
  {
    id: 'representativeInfo',
    question: 'Representative information',
    description: 'Name, credential (CPA, EA, attorney), address, phone, and PTIN of the authorized representative.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Jane Doe, CPA, 123 Main St, Anytown, TX 75001, (214) 555-0100, P00123456',
  },
  {
    id: 'cafStatus',
    question: 'CAF number status',
    description: 'Enter the representative\'s existing CAF number, or indicate if a new CAF registration is needed.',
    type: 'text',
    required: true,
    placeholder: 'e.g., CAF: 1234567890A — or — New registration required',
  },
  {
    id: 'form8821Needed',
    question: 'Is a Form 8821 Tax Information Authorization also needed?',
    description: 'Form 8821 authorizes the IRS to disclose information to a designee (without granting representation rights). Select yes if a third party such as a lender or co-representative needs IRS information access.',
    type: 'text',
    required: true,
    placeholder: 'Yes — designee is [name/role] or No',
  },
  {
    id: 'additionalScope',
    question: 'Any restrictions or additions to the standard scope? (optional)',
    description: 'Note any acts the client is specifically authorizing or restricting — e.g., signing consents, extending statutes, receiving refund checks.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Client authorizes signing of extensions; client does NOT authorize receipt of refund checks',
  },
];

const representationKitPrompt = `You are assisting a licensed tax professional in preparing a representation kit for an IRS matter. You are organizing and drafting documents the practitioner will review before sending to the client or IRS — you are not providing independent legal or tax advice.

Client name: {{clientName}}
TIN (last 4 digits): {{tinMasked}}
Tax years / periods: {{taxYearsPeriods}}
Matter type: {{matterType}}
Representative information: {{representativeInfo}}
CAF number status: {{cafStatus}}
Form 8821 needed: {{form8821Needed}}
Scope restrictions or additions: {{additionalScope}}

Produce a representation kit in Markdown. Begin with the draft notice.

> **Draft document** — Review and edit all sections before sending to the client or submitting to the IRS.

---

# IRS Representation Kit
**Client:** {{clientName}} | **TIN:** {{tinMasked}} | **Matter:** {{matterType}}

---

## Document 1 — Form 2848 Cover Letter

Draft a professional cover letter to accompany a signed Form 2848 Power of Attorney when submitted to the IRS. The letter should:
- Identify the taxpayer and the representative
- State the tax years and type of tax at issue
- Reference the attached signed Form 2848
- Note where to direct correspondence (representative's address)
- Be addressed to the appropriate IRS office (leave as "[IRS Office / Fax Number — confirm before submitting]")

---

## Document 2 — Form 8821 Cover Letter (if applicable)

[If Form 8821 is needed per the inputs above, draft a cover letter for the Form 8821 Tax Information Authorization. The letter should identify the designee, the scope of information being authorized, and the tax periods. If Form 8821 is not needed, state: "Form 8821 not required for this matter."]

---

## Document 3 — CAF Number Checklist

Produce a checklist for the representative to confirm CAF registration status and processing. Include:

- [ ] Confirm CAF number is current and associated with the representative's current address and contact information
- [ ] If new CAF registration is required: note that Forms 2848 or 8821 submitted without an existing CAF number will generate a new CAF number upon processing (allow 2-4 weeks)
- [ ] Verify the CAF number appears correctly on the submitted Form 2848 line 2
- [ ] Confirm IRS receipt of the Form 2848 by calling the Practitioner Priority Service (PPS): 866-860-4259
- [ ] Note the date submitted and expected CAF processing date
- [ ] Retain a copy of the signed Form 2848 in the client file

**CAF Status for this matter:** {{cafStatus}}

---

## Document 4 — Representation Engagement Letter Template

Draft a representation engagement letter for the client to sign. The letter should cover:

1. **Scope of representation** — Identify the specific tax years, tax type, and IRS matter for which the practitioner is being engaged. Reference that a Form 2848 Power of Attorney will be prepared for the client's signature.

2. **What the representative will do** — Communicate with the IRS on the client's behalf, review notices and correspondence, prepare and submit responses, and advise the client on resolution options.

3. **What the representative will NOT do** — Guarantee a specific outcome; make representations to the IRS beyond the facts and law; act outside the scope of the signed Form 2848.

4. **Client responsibilities** — Provide complete and accurate information promptly; notify the practitioner of any direct IRS contact; sign and return the Form 2848 promptly.

5. **Fees** — [Describe fee arrangement — leave as placeholder: "Fees for this representation are [hourly / flat fee of $_____ / to be confirmed], payable [terms]. A retainer of $_____ is required before work commences."]

6. **Confidentiality** — Client information will be held in confidence consistent with applicable professional standards and IRC §7216.

7. **Termination** — Either party may terminate the engagement with written notice. Termination does not relieve the client of fees owed for services rendered.

Include signature blocks for the practitioner and client, and a line for the date.

---

## Practitioner Checklist — Before Submitting

- [ ] Client has signed Form 2848 (original or copy per IRS e-signature rules)
- [ ] All tax years and periods are listed correctly on the Form 2848
- [ ] Representative's PTIN is current and listed correctly
- [ ] CAF number confirmed or new registration noted
- [ ] Cover letter reviewed and IRS office/fax confirmed
- [ ] Signed engagement letter on file
- [ ] Copy of complete kit retained in client file
- [ ] Submission method confirmed (fax, mail, or IRS e-POA)

---

*This kit is a practitioner work-product document. Verify all form-specific instructions against current IRS Publication 947 and the current Form 2848 instructions before submitting. CAF processing timelines and submission requirements may change.*`;

export const RepresentationKit: WorkflowTemplate = {
  id: 'representation-kit',
  name: 'Representation Kit (Form 2848 / 8821)',
  description: 'Drafts a Form 2848 Power of Attorney cover letter, Form 8821 Tax Information Authorization cover letter, CAF number checklist, and a representation engagement letter. You review before sending to the client or IRS.',
  version: '1.0.0',
  category: 'tax',
  requiresVerification: true,
  verificationNote: 'Verify that the authorization scope, tax periods, and representative information match the signed forms before submitting. CAF registration and IRS processing timelines must be confirmed independently.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Representation Details',
      description: 'Provide client, representative, and matter information',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-representation-kit',
      type: 'generate',
      name: 'Generate Representation Kit',
      description: 'Draft the Form 2848 cover letter, Form 8821 cover letter (if needed), CAF checklist, and engagement letter',
      config: {
        outputFile: 'REPRESENTATION_KIT.md',
        promptTemplate: representationKitPrompt,
        systemPrompt: 'You are a tax practice assistant helping a licensed CPA or EA prepare an IRS representation kit. You draft clear, professional documents the practitioner will review and customize before use. You are precise about the distinction between Form 2848 (full representation) and Form 8821 (information authorization only). You do not guarantee outcomes or make legal representations. You always leave specific IRS office addresses, fax numbers, and fee amounts as placeholders for the practitioner to complete.\n\nCRITICAL: Representation procedures, CAF processing timelines, and IRS submission requirements change. Every procedural instruction in this kit must be verified against current IRS Publication 947 and the current Form 2848 and 8821 instructions before relying on them.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['REPRESENTATION_KIT.md'],
  namedOutputs: [
    { id: 'form_2848_cover', name: 'Form 2848 cover letter', schema: 'string' },
    { id: 'form_8821_cover', name: 'Form 8821 cover letter', schema: 'string' },
    { id: 'caf_checklist', name: 'CAF number checklist', schema: 'string' },
    { id: 'engagement_letter', name: 'Representation engagement letter', schema: 'string' },
  ],
};

export default RepresentationKit;
