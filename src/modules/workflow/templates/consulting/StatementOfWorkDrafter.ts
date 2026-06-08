// Consulting Practice Pack v2.3 (shipped). Built with input from practicing consultants.
// Can ship without formal advisor review (no statutory claims).
// Recommend one experienced consultant read-through before production.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name and company',
    description: 'Full name of the client contact and their organization.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Sarah Chen, Merritt & Associates LLC',
  },
  {
    id: 'engagementTitle',
    question: 'Engagement title / project name',
    description: 'A short, clear name for this engagement as it will appear in the SOW header.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Strategic Pricing Assessment, Q3 2026',
  },
  {
    id: 'engagementObjective',
    question: 'Engagement objective',
    description: 'What problem is the client trying to solve? State it as specifically as possible.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., The client needs to determine whether their current service pricing leaves revenue on the table, and if so, what a revised pricing architecture should look like.',
  },
  {
    id: 'scopeOfWork',
    question: 'Scope of work',
    description: 'What will be done? Provide 3 to 5 bullet points describing the work you will perform.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g.,\n- Review current pricing model and compare to three direct competitors\n- Interview 5 existing clients to assess perceived value\n- Build a pricing options memo with three scenarios\n- Present findings in a working session with the leadership team',
  },
  {
    id: 'outOfScope',
    question: 'Out of scope',
    description: 'What will explicitly NOT be done? This section prevents scope creep.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g.,\n- Implementation of any pricing changes\n- Financial modeling beyond the scenarios memo\n- Recruiting or stakeholder interviews outside the agreed list',
  },
  {
    id: 'keyDeliverables',
    question: 'Key deliverables',
    description: 'What does the client receive, and in what format?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g.,\n- Pricing Options Memo (PDF, ~12 pages)\n- Competitor Pricing Summary (spreadsheet)\n- Working session presentation deck (PowerPoint or Keynote)',
  },
  {
    id: 'timeline',
    question: 'Timeline',
    description: 'Start date, major milestones, and end date.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g.,\nStart: July 7, 2026\nMilestone 1 (Competitor review complete): July 18, 2026\nMilestone 2 (Client interviews complete): July 25, 2026\nFinal deliverable: August 8, 2026',
  },
  {
    id: 'feeStructure',
    question: 'Fee structure',
    description: 'Fixed fee, retainer, or hourly? State the amount and payment terms clearly.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Fixed fee of $9,500. 50% due upon signing, 50% due upon delivery of the final memo. Payment by ACH or check within 15 days of invoice.',
  },
  {
    id: 'clientObligations',
    question: 'Client obligations',
    description: 'What must the client provide or do to enable this engagement?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g.,\n- Provide access to current pricing schedules and any existing competitive research\n- Make 5 current clients available for 30-minute interviews\n- Designate one internal point of contact for scheduling and document requests\n- Respond to requests within 2 business days to maintain timeline',
  },
  {
    id: 'confidentialityNote',
    question: 'Confidentiality note',
    description: 'Will this SOW be sent alongside a separate NDA, or is an NDA already in place?',
    type: 'text',
    required: true,
    placeholder: 'e.g., NDA already signed (March 2026) / NDA to be sent alongside this SOW / No NDA planned',
  },
];

const statementOfWorkDrafterPrompt = `You are assisting a consultant in drafting a Statement of Work for a new client engagement. Produce a complete, professional SOW document ready for the consultant's review before sending. Write in clear, direct language. No em dashes. No filler phrases.

Engagement details:
Client: {{clientName}}
Engagement title: {{engagementTitle}}
Objective: {{engagementObjective}}
Scope of work: {{scopeOfWork}}
Out of scope: {{outOfScope}}
Key deliverables: {{keyDeliverables}}
Timeline: {{timeline}}
Fee structure: {{feeStructure}}
Client obligations: {{clientObligations}}
Confidentiality: {{confidentialityNote}}

Produce the SOW as a Markdown document in the following structure. Begin with the draft notice.

> **Draft document**, Review and edit before sending to the client.

---

# Statement of Work

**Prepared for:** {{clientName}}
**Engagement:** {{engagementTitle}}
**Prepared by:** [Consultant name]
**Date:** [Date]

---

## 1. Engagement Overview

[Write 2 to 3 sentences describing the purpose and context of the engagement. State the problem the client is solving and why this work matters. Use the objective provided. Do not restate it word-for-word, synthesize it into a clear opening.]

---

## 2. Scope of Work

The consultant will perform the following:

[Convert the scope bullets into a clean numbered or bulleted list. Expand each item slightly if the input is sparse, make each item specific and unambiguous.]

---

## 3. Out of Scope

The following are explicitly excluded from this engagement:

[Convert the out-of-scope items into a clean list. If any item needs clarification to avoid ambiguity, add a brief parenthetical note.]

---

## 4. Deliverables

The client will receive the following upon completion of each phase:

| Deliverable | Format | Delivery Date |
|-------------|--------|---------------|
| [Deliverable name] | [Format] | [From timeline] |

[Build the table from the deliverables and timeline provided. If a specific date per deliverable was not given, use the final end date or write "Upon completion."]

---

## 5. Timeline

| Milestone | Target Date |
|-----------|-------------|
| [Milestone] | [Date] |

[Build the timeline table from the input. Include start, all milestones, and end date.]

---

## 6. Fees and Payment

[Write this section in clear prose, not a table. State the fee type (fixed / retainer / hourly), the total or rate, when invoices are issued, and payment terms. If a split payment schedule was provided, state each payment clearly: amount, trigger, and due date after invoice.]

---

## 7. Client Obligations

To enable this engagement to proceed on the agreed timeline, the client agrees to:

[Convert the client obligations into a numbered list. Each item should be specific and actionable. If the input is vague, make it concrete, e.g., "provide access to X" should specify what X is and by when if possible.]

---

## 8. Confidentiality

[Write 2 to 3 sentences covering confidentiality. Use the confidentiality note provided:
- If an NDA is already in place: "This engagement is governed by the Non-Disclosure Agreement signed on [date]. All work product and client information exchanged under this SOW is subject to that agreement."
- If an NDA accompanies this SOW: "A separate Non-Disclosure Agreement governs the confidentiality of information shared under this engagement. Both documents should be signed before work begins."
- If no NDA: "Both parties agree to treat the other's non-public business information as confidential and not to disclose it to third parties without prior written consent."]

---

## 9. Next Steps

To move forward:

1. Review this SOW and note any revisions needed.
2. [If NDA accompanies: Review and sign the attached Non-Disclosure Agreement.]
3. Sign and return this SOW.
4. Submit the initial payment of [amount] to initiate the engagement.
5. Schedule a kickoff call for [week of start date or TBD].

---

## Signatures

**Consultant**

Name: ___________________________

Signature: _______________________

Date: ___________________________

---

**Client**

Name: ___________________________

Signature: _______________________

Date: ___________________________

---

> **Compliance note:** This draft SOW is for the consultant's review before sending. Consult legal counsel if the engagement involves unusually complex IP, regulatory, or liability considerations.`;

export const StatementOfWorkDrafter: WorkflowTemplate = {
  id: 'consulting-sow-drafter',
  name: 'Statement of Work Drafter',
  description: 'Produces a complete engagement statement of work covering scope, deliverables, timeline, fees, and mutual obligations. Built for the first conversation of every engagement.',
  version: '1.0.0',
  category: 'consulting',
  requiresVerification: true,
  verificationNote: 'The legal clause placeholders are placeholders only. Replace with your lawyer-approved confidentiality, IP, and liability language before presenting to a client.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Engagement Details',
      description: 'Provide the key details of the engagement, scope, deliverables, fees, and timeline',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-sow',
      type: 'generate',
      name: 'Generate Statement of Work',
      description: 'Draft a complete, professional SOW ready for consultant review before sending',
      config: {
        outputFile: 'STATEMENT_OF_WORK.md',
        promptTemplate: statementOfWorkDrafterPrompt,
        systemPrompt: 'You are a consulting practice assistant helping an experienced consultant draft a Statement of Work. You write in clear, direct professional language. You do not use em dashes. You do not use filler phrases like "it is worth noting" or "please be advised." You turn vague inputs into specific, concrete language. Your job is to produce a document the consultant can review, adjust, and send, not a document that requires substantial rewriting. The out-of-scope section and client obligations section are as important as the scope section; treat them with equal care.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['STATEMENT_OF_WORK.md'],
  namedOutputs: [
    { id: 'scope_summary', name: 'Scope of work', schema: 'string' },
    { id: 'deliverables', name: 'Key deliverables', schema: 'array' },
    { id: 'fee_terms', name: 'Fee structure and payment terms', schema: 'string' },
  ],
};

export default StatementOfWorkDrafter;
