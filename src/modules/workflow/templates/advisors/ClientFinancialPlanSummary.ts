// @draft: Advisor Practice Pack v1.0
// Requires advisor review before shipping. Do not expose to users without review.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full name of the client this summary is for. Used in the document header and file name.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Margaret and Thomas Holt',
  },
  {
    id: 'meetingDate',
    question: 'Meeting date',
    description: 'Date of the meeting this summary covers.',
    type: 'text',
    required: true,
    placeholder: 'e.g., June 4, 2026',
  },
  {
    id: 'planningObjectives',
    question: 'Planning objectives discussed',
    description: 'What are the client\'s core financial planning goals? List them as you understand them, the summary will recap these in the client\'s frame of reference.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Retire by age 62, fund two college educations, reduce estate taxes, protect surviving spouse income',
  },
  {
    id: 'accountTypes',
    question: 'Key account types and rough balances',
    description: 'List the account types and approximate balances discussed (no account numbers). This gives the snapshot section its content. Round balances are fine.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 401(k) ~$480,000 / Roth IRA ~$95,000 / Taxable brokerage ~$210,000 / Cash / savings ~$45,000',
  },
  {
    id: 'recommendationsDiscussed',
    question: 'Recommendations discussed this meeting',
    description: 'List the specific recommendations you made or discussed with the client. Be as detailed as you\'d like, the summary will present them in plain language.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Shift 401k allocation from 80/20 to 70/30, maximize Roth IRA contributions this year, review beneficiary designations, consider term life increase to $1M',
  },
  {
    id: 'nextSteps',
    question: 'Next steps agreed',
    description: 'What did you and the client agree to do before the next meeting? Include who is responsible for each item and any target dates you discussed.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Client to update beneficiary forms by July 1 / Advisor to model Roth conversion scenario / Client to send most recent tax return',
  },
  {
    id: 'additionalNotes',
    question: 'Any additional context to include (optional)',
    description: 'Anything else that should appear in the summary, life events, concerns raised, topics deferred to the next meeting, etc.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Client mentioned possible job change in the next 6 months. Deferred Social Security timing discussion to next meeting.',
  },
];

const clientFinancialPlanSummaryPrompt = `You are assisting a financial advisor in producing a clear, professional client-facing meeting summary. You are not providing financial advice, you are helping the advisor draft a summary document they will review and send to the client.

Client name: {{clientName}}
Meeting date: {{meetingDate}}
Planning objectives: {{planningObjectives}}
Key account types and balances: {{accountTypes}}
Recommendations discussed: {{recommendationsDiscussed}}
Next steps agreed: {{nextSteps}}
Additional notes: {{additionalNotes}}

Produce a complete client-facing meeting summary in Markdown. At the top, include the draft notice.

> **Draft document**, Review and edit before sending to the client.

---

# Meeting Summary
**Client:** {{clientName}}
**Date:** {{meetingDate}}
**Prepared by:** [Advisor name]

---

## Your Planning Objectives

[Write a clear recap of the client's planning objectives in second-person language ("your goals," "you want to"). Use the objectives provided. This should read like the advisor is confirming their understanding of what matters most to the client, not a list of features, but a human recap of priorities.]

---

## Current Allocation Snapshot

[Present the account types and approximate balances in a clean table. Label it clearly as approximate/rounded. Do not include account numbers, SSNs, or any identifying account details beyond the type and approximate balance.]

| Account Type | Approximate Balance |
|---|---|
[Row for each account type provided]

*Balances are approximate and rounded for this summary. Your most recent account statements are the authoritative record.*

---

## Key Recommendations from This Meeting

[Present the recommendations discussed as a numbered list in plain language. Each item should state what was recommended and why, briefly connecting the recommendation to one of the client's stated objectives. Do not promise specific returns or guarantee outcomes. Frame as "we discussed" or "we recommend considering" rather than directives.]

---

## Next Steps

[Present the agreed next steps in a table with three columns: Action, Responsible Party (client or advisor), and Target Date. Use the information provided, if a target date was mentioned use it; otherwise leave the column as "TBD".]

| Action | Responsible | Target Date |
|---|---|---|
[Row for each next step]

---

## A Note on This Summary

This summary is prepared for your records and reflects the topics and recommendations discussed during our meeting. It is not a comprehensive financial plan and does not replace your written financial plan or investment policy statement. All recommendations are subject to your review and final decision. Past performance does not guarantee future results.

This output is a draft for the advisor's review. It is not financial advice and does not substitute for your professional judgment or compliance review.

---

[If additional notes were provided, include a brief final section titled "Other Topics Noted" that covers those points in 2–4 sentences.]`;

export const ClientFinancialPlanSummary: WorkflowTemplate = {
  id: 'advisors-client-financial-plan-summary',
  name: 'Client Financial Plan Summary',
  description: 'Produces a professional client-facing meeting summary covering objectives recap, current allocation snapshot, key recommendations, agreed next steps, and a compliance note, ready for the advisor to review and send.',
  version: '1.0.0',
  category: 'advisors',
  requiresVerification: true,
  verificationNote: 'This output is a draft summary. Verify all figures against source data and have a licensed advisor review before presenting to the client.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Meeting Details',
      description: 'Provide the meeting information, client objectives, recommendations, and next steps',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-plan-summary',
      type: 'generate',
      name: 'Generate Client Summary',
      description: 'Draft the client-facing meeting summary with all required sections',
      config: {
        outputFile: 'CLIENT_PLAN_SUMMARY.md',
        promptTemplate: clientFinancialPlanSummaryPrompt,
        systemPrompt: 'You are a financial advisory practice management assistant helping a licensed financial advisor draft a professional client-facing meeting summary. You write in warm, clear, plain language that a client can read without a finance background, no jargon, no abbreviations without explanation. You are careful never to promise specific returns, guarantee outcomes, or overstate the certainty of any recommendation. You always frame the document as a summary for the client\'s records rather than formal financial advice. You include a compliance note that this is a summary for review, not a comprehensive plan.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['CLIENT_PLAN_SUMMARY.md'],
  namedOutputs: [
    { id: 'objectives_recap', name: 'Client objectives recap', schema: 'string' },
    { id: 'recommendations', name: 'Recommendations list', schema: 'array' },
    { id: 'next_steps', name: 'Agreed next steps', schema: 'array' },
  ],
};

export default ClientFinancialPlanSummary;
