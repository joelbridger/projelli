// @draft — Tax Practice Pack v2.2
// Requires CPA/EA advisor review before shipping. Do not expose to users without review.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full legal name of the taxpayer receiving the notice.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Marcus J. Holloway',
  },
  {
    id: 'noticeType',
    question: 'Notice type',
    description: 'Select or type the notice type. Common types: CP14 (first balance due), CP501 (second notice), CP503 (third notice), CP504 (final notice before levy), LT11 or Letter 1058 (Final Notice of Intent to Levy — CDP rights triggered), CP2000 (proposed changes), state notice (describe).',
    type: 'text',
    required: true,
    placeholder: 'e.g., CP504 — Final Notice Before Levy',
  },
  {
    id: 'noticeDate',
    question: 'Notice date',
    description: 'The date printed on the notice. This is the date used to calculate response deadlines.',
    type: 'text',
    required: true,
    placeholder: 'e.g., May 15, 2025',
  },
  {
    id: 'amountsAtIssue',
    question: 'Amounts at issue',
    description: 'Tax, penalties, and interest amounts shown on the notice.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Tax: $8,240; Failure-to-pay penalty: $1,236; Interest: $412; Total: $9,888',
  },
  {
    id: 'taxYearPeriod',
    question: 'Tax year or period at issue',
    description: 'The specific tax year or period the notice covers.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Form 1040 for tax year 2023',
  },
  {
    id: 'clientPosition',
    question: 'Client\'s position and proposed resolution',
    description: 'Describe the client\'s situation: does the client agree with the amount, dispute it, or need a payment arrangement? What resolution is being proposed?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Client agrees the balance is owed. Requesting 36-month installment agreement at $275/month. Client is current on current-year estimated taxes.',
  },
  {
    id: 'availableDocumentation',
    question: 'Available supporting documentation',
    description: 'List documents available to support the response (payment records, prior correspondence, hardship documentation, amended return, etc.).',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Bank statements showing prior payments; proof of estimated tax payments for 2024; prior correspondence from IRS re: same liability',
  },
  {
    id: 'cdpConsideration',
    question: 'Is CDP (Collection Due Process) hearing rights preservation needed?',
    description: 'Required if this is an LT11 or Letter 1058 (Final Notice of Intent to Levy). CDP requests must be filed within 30 days of the LT11/Letter 1058 date. Enter Yes if this is an LT11/Letter 1058, or No/Not applicable.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Yes — LT11 dated May 15, 2025; 30-day deadline June 14, 2025 — or — No',
  },
];

const collectionNoticeResponsePrompt = `You are assisting a licensed tax professional in drafting a response to an IRS collection notice. You are organizing the response, not providing independent tax or legal advice.

Client name: {{clientName}}
Notice type: {{noticeType}}
Notice date: {{noticeDate}}
Amounts at issue: {{amountsAtIssue}}
Tax year / period: {{taxYearPeriod}}
Client's position and proposed resolution: {{clientPosition}}
Available documentation: {{availableDocumentation}}
CDP consideration: {{cdpConsideration}}

Produce a formatted response document in Markdown. Begin with the draft notice.

> **Draft document** — Review and edit before sending. Verify all deadlines against the original notice before responding.

---

# IRS Collection Notice Response
**Client:** {{clientName}} | **Notice:** {{noticeType}} | **Notice Date:** {{noticeDate}}

---

> ### WARNING — DEADLINE SENSITIVITY
>
> **If this notice is an LT11 or Letter 1058 (Final Notice of Intent to Levy):**
> The taxpayer has **30 days from the notice date** to request a Collection Due Process (CDP) hearing by filing Form 12153. Missing this deadline permanently forfeits the right to a CDP hearing before the IRS Independent Office of Appeals, and with it the right to Tax Court review. This is an absolute, non-extendable deadline.
>
> **Notice date:** {{noticeDate}}
> **CDP deadline (LT11/Letter 1058 only):** [Calculate: notice date + 30 days — VERIFY BEFORE RELYING]
>
> If CDP rights are at issue, file Form 12153 immediately, even if a concurrent response or payment arrangement request is also being prepared. CDP and a collection alternative can be pursued simultaneously.

---

## Section 1 — Facts

[State the relevant facts concisely and in third person. Include: taxpayer identity, tax year and type, notice type and date, amounts at issue, and any relevant prior history (prior correspondence, prior arrangements, payments made). Use only facts as provided — do not embellish or assume.]

**Taxpayer:** {{clientName}}
**Tax year / period:** {{taxYearPeriod}}
**Notice type and date:** {{noticeType}}, dated {{noticeDate}}
**Amounts per notice:** {{amountsAtIssue}}

[Summarize any relevant history based on the documentation and position provided.]

---

## Section 2 — Taxpayer's Position and Proposed Resolution

[Draft a clear, professional statement of the taxpayer's position. If the balance is not disputed, say so plainly. If it is disputed, state the basis for the dispute. State the proposed resolution specifically — installment agreement terms, offer in compromise, currently not collectible, penalty abatement, etc.]

[Where a payment arrangement is proposed, include the specific terms: monthly amount, start date, and basis for the proposal (income, expenses, ability to pay).]

[Where penalty abatement is proposed, identify the basis: first-time abatement, reasonable cause, or IRS error.]

---

## Section 3 — CDP Rights Preservation Language (if applicable)

[If the notice is an LT11 or Letter 1058, include the following language. Otherwise, omit this section.]

Pursuant to IRC §6330, the taxpayer respectfully requests a Collection Due Process hearing. This request is timely filed within 30 days of the date of the Final Notice of Intent to Levy ({{noticeType}}, dated {{noticeDate}}). Form 12153 is enclosed. The taxpayer requests consideration of the following collection alternative: [state alternative].

The taxpayer is not waiving any rights by simultaneously requesting a collection alternative. This CDP request is intended to preserve all appeal rights under IRC §6330 and §6331.

---

## Section 4 — Supporting Documents Checklist

The following documents support this response. Items marked [ENCLOSED] are attached; items marked [AVAILABLE] can be provided on request.

{{availableDocumentation}}

Additional standard items to consider enclosing:
- [ ] Copy of the original notice
- [ ] Form 2848 or Form 8821 (if representative is responding on behalf of the taxpayer)
- [ ] Form 9465 (Installment Agreement Request), if applicable
- [ ] Form 12153 (CDP Hearing Request), if LT11/Letter 1058
- [ ] Financial information (Form 433-A or 433-F) if requesting hardship consideration

---

## Practitioner Checklist — Before Sending

- [ ] Verified notice date against the original IRS notice (not a copy)
- [ ] Calculated and confirmed all response deadlines
- [ ] If LT11 or Letter 1058: Form 12153 CDP request is prepared and will be sent via certified mail, return receipt — deadline confirmed as [DATE]
- [ ] Response letter reviewed for accuracy and completeness
- [ ] Client has reviewed and approved the proposed resolution position
- [ ] Supporting documents assembled and labeled
- [ ] Sending via certified mail, return receipt requested, or fax with confirmation — retain proof of delivery
- [ ] Copy retained in client file

---

*This response is a practitioner work-product document. Verify all deadlines, notice types, and procedural requirements against IRS guidance and the original notice before sending. Collection procedures and deadlines are strictly enforced by the IRS.*`;

export const CollectionNoticeResponse: WorkflowTemplate = {
  id: 'collection-notice-response',
  name: 'IRS Collection Notice Response',
  description: 'Drafts responses to IRS collection notices — CP14, CP501/503/504, LT11/Letter 1058 CDP rights, and state equivalents. Structures the response with client facts, proposed resolution, and supporting document checklist.',
  version: '1.0.0',
  category: 'tax',
  requiresVerification: true,
  verificationNote: 'Verify every deadline — especially CDP hearing rights (30 days from LT11/Letter 1058) — against the original notice before responding. Missing a CDP deadline forfeits important appeal rights.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Notice and Client Details',
      description: 'Provide notice type, dates, amounts, and proposed resolution',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-notice-response',
      type: 'generate',
      name: 'Generate Collection Notice Response',
      description: 'Draft the structured response with facts, position, CDP language (if applicable), and document checklist',
      config: {
        outputFile: 'COLLECTION_NOTICE_RESPONSE.md',
        promptTemplate: collectionNoticeResponsePrompt,
        systemPrompt: 'You are a tax practice assistant helping a licensed CPA or EA draft a response to an IRS collection notice. You are precise about collection procedures, notice types, and taxpayer rights. You treat CDP deadlines (30 days from LT11/Letter 1058) as absolute and non-waivable, and you always prominently flag them when the notice type triggers CDP rights.\n\nCRITICAL DEADLINE DISCIPLINE: Never understate the urgency of CDP deadlines. A missed CDP deadline permanently forfeits the taxpayer\'s right to a pre-levy hearing and Tax Court review. If the notice is an LT11 or Letter 1058, the CDP warning must appear prominently at the top of the document and the deadline must be calculated and displayed. Collection procedures, notice types, and IRS programs change — verify all procedural requirements against current IRS guidance (IRS.gov, Publication 594, Internal Revenue Manual) before sending.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['COLLECTION_NOTICE_RESPONSE.md'],
  namedOutputs: [
    { id: 'facts_section', name: 'Facts section', schema: 'string' },
    { id: 'position_resolution', name: 'Taxpayer position and proposed resolution', schema: 'string' },
    { id: 'cdp_language', name: 'CDP rights preservation language', schema: 'string' },
    { id: 'document_checklist', name: 'Supporting document checklist', schema: 'string' },
  ],
};

export default CollectionNoticeResponse;
