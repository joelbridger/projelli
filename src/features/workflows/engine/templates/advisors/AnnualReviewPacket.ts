// Advisor Practice Pack v1.0 (shipped). Built with input from practicing advisors.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full name of the client this annual review packet covers.',
    type: 'text',
    required: true,
    placeholder: 'e.g., David and Erin Schuster',
  },
  {
    id: 'reviewYear',
    question: 'Review year',
    description: 'The calendar year being reviewed.',
    type: 'text',
    required: true,
    placeholder: 'e.g., 2025',
  },
  {
    id: 'keyLifeEvents',
    question: 'Key life events this year',
    description: 'Any significant life events that occurred during the review year, job changes, retirement, births, deaths, marriage, divorce, health events, home purchase, inheritance, etc. These anchor the cover letter.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., David turned 65 and enrolled in Medicare. Erin received an inheritance of approximately $200,000 from her mother\'s estate. Paid off primary mortgage in March.',
  },
  {
    id: 'planChangesThisYear',
    question: 'Plan changes made this year',
    description: 'What changes did you make to the client\'s financial plan or investment allocation during the year? Include any rebalancing, strategy shifts, new accounts opened, or changes to withdrawal plans.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Rebalanced to 60/40 from 70/30 in Q1. Opened inherited IRA for Erin, established 10-year withdrawal schedule. Reduced equity concentration in prior employer stock from 22% to 8%.',
  },
  {
    id: 'checklistItemsToHighlight',
    question: 'Checklist items to highlight',
    description: 'Which checklist items are most important to flag for this client this year? The packet will generate a full standard checklist, but note any that need special emphasis.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Beneficiary designations on the inherited IRA must be confirmed. Long-term care insurance renewal due in February. Will not updated since 2018, estate attorney referral recommended.',
  },
  {
    id: 'additionalContext',
    question: 'Additional context (optional)',
    description: 'Anything else relevant to this annual review, goals for the coming year, concerns raised by the client, items deferred from prior year.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Client expressed interest in charitable giving strategy for next year. Roth conversion analysis was deferred, revisit in Q1.',
  },
];

const annualReviewPacketPrompt = `You are assisting a financial advisor in generating an annual review document set for a client. You are not providing financial advice, you are helping the advisor produce professional draft documents they will review and use in the annual review meeting.

Client name: {{clientName}}
Review year: {{reviewYear}}
Key life events this year: {{keyLifeEvents}}
Plan changes made this year: {{planChangesThisYear}}
Checklist items to highlight: {{checklistItemsToHighlight}}
Additional context: {{additionalContext}}

Produce a complete annual review packet in Markdown. At the top, include the draft notice.

> **Draft document**, Review and edit before use with the client.

---

# {{reviewYear}} Annual Review Packet
**Client:** {{clientName}}
**Review Year:** {{reviewYear}}
**Prepared by:** [Advisor name]

---

## Section 1: Annual Review Cover Letter

[Advisor letterhead, name, firm, address, phone, email]

[Date]

Dear {{clientName}},

[Open with a warm, professional acknowledgment of the year. Reference 1–2 of the key life events as real anchors. Do not use generic filler. Keep this grounded in what actually happened for this client.]

### A Year in Review

[2–3 paragraphs recapping the year's key events and plan highlights. Write factually, do not assert specific portfolio performance percentages or returns unless the advisor has provided exact figures. Instead, reference the types of events and changes: "We adjusted your allocation," "You reached the milestone of paying off your mortgage," "Following the inheritance, we established an inherited IRA and a withdrawal schedule." Keep the tone matter-of-fact and professional, not promotional.]

### Changes to Your Plan This Year

[Present the plan changes made this year in plain language, what changed and why it was the right move given the client's situation. Frame each change as a deliberate decision, not as reaction to markets. 3–6 bullet points.]

### Looking Ahead

[2–3 sentences on the focus areas or goals for the coming year, if context was provided. If not, use general language about continuing to review the plan and responding to any changes in the client's situation.]

We look forward to our upcoming meeting to review this summary together and discuss your priorities for the year ahead.

Sincerely,

[Advisor signature block]

---

## Section 2: Annual Review Checklist

> Use this checklist as a meeting agenda item. Check each item against current records before the meeting and note the status. Items flagged for this client are marked.

| Area | Item | Status | Notes |
|---|---|---|---|
| **Beneficiary designations** | Confirm beneficiaries on all accounts (IRA, 401k, insurance, TOD) are current | Review | |
| **Beneficiary designations** | Confirm contingent beneficiaries are named | Review | |
| **Insurance** | Life insurance coverage adequate for current obligations | Review | |
| **Insurance** | Disability insurance in place (if employed) | Review | |
| **Insurance** | Long-term care coverage or plan | Review | |
| **Insurance** | Property and casualty coverage reviewed | Review | |
| **Estate documents** | Will current and reflects current wishes | Review | |
| **Estate documents** | Power of attorney current | Review | |
| **Estate documents** | Healthcare directive / living will current | Review | |
| **Estate documents** | Trusts funded and current (if applicable) | Review | |
| **Tax efficiency** | Tax-advantaged accounts maximized for the year | Review | |
| **Tax efficiency** | Roth conversion opportunity evaluated | Review | |
| **Tax efficiency** | Tax-loss harvesting opportunities considered | Review | |
| **Tax efficiency** | RMDs taken if applicable | Review | |
| **Asset allocation** | Portfolio aligned with current risk tolerance and time horizon | Review | |
| **Asset allocation** | Rebalancing completed if outside target ranges | Review | |
| **Cash flow** | Emergency fund adequate | Review | |
| **Cash flow** | Budget / spending plan aligned with goals | Review | |
| **Goals** | Retirement timeline and savings rate on track | Review | |
| **Goals** | College or major expenditure savings on track | Review | |

[If checklist items to highlight were provided, add a note below the table flagging those specific items with additional emphasis, e.g., "Note for this review: [item] requires particular attention because [reason from the inputs]."]

---

## Section 3: Plan Changes Summary, {{reviewYear}}

[Write a 1–2 page narrative summary of the plan changes made this year. This is the advisor's internal record of what changed and why, more detailed than the cover letter. Structure it chronologically or by category (allocation, accounts, income planning, estate, etc.). For each change: what it was, when it was made, what prompted it, and how it connects to the client's goals. Write in a professional, matter-of-fact tone suitable for a client file or audit trail.]

### Changes Made This Year

[Narrative covering each plan change, organized by category or chronologically. Be specific about what changed, why, and how it connects to the client's plan.]

### Items Reviewed but Unchanged

[List any areas that were reviewed this year and confirmed as appropriate, i.e., no change was made because the existing approach remained correct. This documents active review, not just inaction.]

### Deferred Items

[List any topics or changes that were identified but deferred to a future period, and the reason for deferral. This creates a clear agenda item for the next review.]

---

*This annual review packet is a draft for the advisor's review. It is not financial advice and does not substitute for your professional judgment or compliance review. Verify all facts against your records before using this document with the client or filing it.*`;

export const AnnualReviewPacket: WorkflowTemplate = {
  id: 'advisors-annual-review-packet',
  name: 'Annual Review Packet',
  description: 'Generates a complete annual review document set: a personalized cover letter recapping the year\'s events and plan changes, a comprehensive review checklist of items to cover, and a narrative plan changes summary for the client file.',
  version: '1.0.0',
  category: 'advisors',
  requiresVerification: true,
  verificationNote: 'Verify all performance figures and regulatory references against current account statements before the client meeting.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Annual Review Information',
      description: 'Provide the review year, key life events, plan changes made, and checklist priorities',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-annual-review',
      type: 'generate',
      name: 'Generate Annual Review Packet',
      description: 'Draft the cover letter, review checklist, and plan changes narrative',
      config: {
        outputFile: 'ANNUAL_REVIEW_PACKET.md',
        promptTemplate: annualReviewPacketPrompt,
        systemPrompt: 'You are a financial advisory practice management assistant helping a licensed financial advisor prepare an annual client review packet. You write the cover letter in a warm, professional, personal tone grounded in the client\'s actual events, not generic filler. You are careful never to state specific performance figures or returns unless the advisor has provided them. The checklist section is comprehensive and practical. The plan changes narrative is factual, organized, and suitable for a client file, it documents what changed and why, which is different from marketing the advisor\'s services. You always include a compliance note that all documents require advisor review before use with the client.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['ANNUAL_REVIEW_PACKET.md'],
  namedOutputs: [
    { id: 'cover_letter', name: 'Annual review cover letter', schema: 'string' },
    { id: 'review_checklist', name: 'Review checklist', schema: 'array' },
    { id: 'plan_changes_summary', name: 'Plan changes narrative', schema: 'string' },
  ],
};

export default AnnualReviewPacket;
