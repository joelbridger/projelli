// @draft — Tax Practice Pack v2.2
// Requires CPA/EA advisor review before shipping. Do not expose to users without review.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full name of the client whose return is being reviewed.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Marcus T. Edelman',
  },
  {
    id: 'filingStatus',
    question: 'Filing status',
    description: 'The client\'s filing status for this return.',
    type: 'select',
    required: true,
    options: ['Single', 'MFJ', 'MFS', 'HOH', 'QSS'],
    defaultValue: 'Single',
  },
  {
    id: 'taxYear',
    question: 'Tax year',
    description: 'The tax year being prepared.',
    type: 'text',
    required: true,
    placeholder: 'e.g., 2025',
  },
  {
    id: 'incomeSources',
    question: 'Income sources present',
    description: 'List the income types that apply to this client\'s situation. Include all that are relevant.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., W-2, 1099-NEC, 1099-B, rental income',
  },
  {
    id: 'lifeEvents',
    question: 'Notable life events this year',
    description: 'Any life changes that affect filing status, dependents, deductions, or credits.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., marriage, divorce, new dependent, home purchase, business started, large asset sale',
  },
  {
    id: 'priorYearCarryovers',
    question: 'Known prior-year carryovers (optional)',
    description: 'Capital loss carryovers, NOL carryforwards, charitable contribution limits, or other amounts carrying from prior years.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., $12,000 capital loss carryover from 2024',
  },
  {
    id: 'stateReturns',
    question: 'State returns required',
    description: 'States where the client must file. Note if the state has no income tax.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., TX (no income tax), CA',
  },
];

const preReviewChecklistPrompt = `You are assisting a licensed tax professional in generating a pre-filing checklist tailored to a specific client's situation. This checklist serves two purposes: a client-facing document request and an internal pre-filing verification list.

Client name: {{clientName}}
Filing status: {{filingStatus}}
Tax year: {{taxYear}}
Income sources: {{incomeSources}}
Life events this year: {{lifeEvents}}
Prior-year carryovers: {{priorYearCarryovers}}
State returns required: {{stateReturns}}

Produce a checklist in Markdown. At the top, include the draft notice.

> **Draft document** — Review and edit before delivery.

---

# Pre-Filing Checklist
**Client:** {{clientName}}
**Filing status:** {{filingStatus}}
**Tax year:** {{taxYear}}
**Prepared for practitioner review:** [date]

---

## Identity and Filing Information
[Items to verify: legal name matches SSN records, correct filing status supported by facts, dependent SSNs and dates of birth confirmed, IP PIN required/obtained if applicable]

## Income Documents
[Organize by the income sources specified. For each income type present, list the specific forms to obtain and key figures to verify — e.g., for W-2: box 1 wages, box 12 codes, box 14 items; for 1099-B: covered vs. uncovered securities, wash sale amounts; for K-1: ordinary income, guaranteed payments, basis tracking. Be specific to what was listed.]

## Deductions
[Based on filing status and income mix, list applicable deduction items to verify. Flag whether standard or itemized deduction is likely, and list supporting documents if itemized is possible. Include QBI deduction eligibility check if self-employment income is present.]

## Credits
[Based on the client's situation — filing status, dependents, income level, life events — list credits to evaluate: child tax credit, EITC eligibility, education credits, retirement savings credit, energy credits, etc. Note income phase-out thresholds relevant to this client.]

## Prior-Year Carryovers
[List any carryovers specified, with the forms and schedules where they will be applied. If none were specified, note that the prior return should be reviewed for any carryforward amounts before filing.]

## State-Specific Items
[For each state listed, note the specific filing requirements, any state-level additions or subtractions not on the federal return, payment due dates if different from federal, and any state-specific credits or deductions to consider.]

## Signature Requirements
[List who must sign, e-file authorization requirements (Form 8879 or equivalent), date requirements, and any Power of Attorney considerations.]

---

## Elevated Scrutiny Flags
[Based on the income mix and life events, flag specific areas that carry higher examination risk or require additional care:
- Self-employment income with home office or vehicle deductions
- Large asset sales relative to prior-year income
- Rental income and passive activity rules
- Any life events that create complexity — divorce asset transfers, new business, large charitable contributions
Keep this section direct and practitioner-facing.]

---

*This checklist is tailored to the information provided. Review for any items specific to this client\'s situation that were not captured above. Verify all figures against source documents before filing.*`;

export const PreReviewChecklist: WorkflowTemplate = {
  id: 'tax-pre-review-checklist',
  name: 'Pre-Review Checklist',
  description: 'Generates a pre-filing checklist organized by section — income, deductions, credits, carryovers, state items, signature requirements — with elevated-scrutiny flags based on the client\'s income mix and life events.',
  version: '1.0.0',
  category: 'tax',
  requiresVerification: true,
  verificationNote: 'Verify all checklist items against the client\'s actual documents before finalizing the return.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Client Tax Situation',
      description: 'Describe the client\'s filing situation, income sources, and life events',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-checklist',
      type: 'generate',
      name: 'Generate Pre-Filing Checklist',
      description: 'Build a section-by-section checklist tailored to this client\'s situation',
      config: {
        outputFile: 'PRE_REVIEW_CHECKLIST.md',
        promptTemplate: preReviewChecklistPrompt,
        systemPrompt: 'You are a tax practice assistant helping a licensed CPA or EA prepare a pre-filing checklist for a specific client. You tailor the checklist precisely to the income sources, filing status, life events, and states provided — you do not pad it with generic items that don\'t apply. You flag elevated scrutiny areas based on the income mix and any facts that historically attract IRS attention. You are precise about form numbers and box references.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['PRE_REVIEW_CHECKLIST.md'],
  namedOutputs: [
    { id: 'checklist', name: 'Pre-filing checklist', schema: 'string' },
    { id: 'scrutiny_flags', name: 'Elevated scrutiny flags', schema: 'array' },
  ],
};

export default PreReviewChecklist;
