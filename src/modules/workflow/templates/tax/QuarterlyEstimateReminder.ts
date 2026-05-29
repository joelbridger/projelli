// @draft — Tax Practice Pack v2.2
// Requires CPA/EA advisor review before shipping. Do not expose to users without review.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Name of the client receiving the quarterly reminder.',
    type: 'text',
    required: true,
    placeholder: 'e.g., James R. Novak',
  },
  {
    id: 'quarterAndDueDate',
    question: 'Quarter and due date',
    description: 'The estimated tax installment period and payment due date.',
    type: 'select',
    required: true,
    options: [
      'Q1 — April 15',
      'Q2 — June 16',
      'Q3 — September 15',
      'Q4 — January 15',
    ],
    defaultValue: 'Q1 — April 15',
  },
  {
    id: 'priorYearTaxLiability',
    question: 'Prior year tax liability',
    description: 'The client\'s total tax liability from the prior year return, used for the safe harbor calculation.',
    type: 'text',
    required: true,
    placeholder: 'e.g., $18,400 (from 2024 Form 1040, line 24)',
  },
  {
    id: 'currentYearEstimatedIncome',
    question: 'Current year estimated income (optional)',
    description: 'If known, the client\'s estimated total income for the current year. Used for an annualized estimate alongside the safe harbor figure.',
    type: 'text',
    required: false,
    placeholder: 'e.g., approximately $120,000',
  },
  {
    id: 'paymentMethod',
    question: 'Payment method the client uses',
    description: 'How the client typically makes estimated tax payments. Determines which payment instructions to include.',
    type: 'select',
    required: true,
    options: ['IRS Direct Pay', 'EFTPS', 'Check', 'Varies'],
    defaultValue: 'IRS Direct Pay',
  },
  {
    id: 'changesSinceLastQuarter',
    question: 'Any changes since last quarter (optional)',
    description: 'Income changes, large transactions, or other developments the client should factor into this payment.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., client sold a rental property in Q2 — expected capital gain of $45,000',
  },
];

const quarterlyEstimateReminderPrompt = `You are assisting a licensed tax professional in drafting a quarterly estimated tax reminder for a client. This is a client-ready communication — write in plain language.

Client name: {{clientName}}
Quarter and due date: {{quarterAndDueDate}}
Prior year tax liability: {{priorYearTaxLiability}}
Current year estimated income: {{currentYearEstimatedIncome}}
Payment method: {{paymentMethod}}
Changes since last quarter: {{changesSinceLastQuarter}}

Produce a client-ready reminder in Markdown. At the top, include the draft notice.

> **Draft document** — Review and edit before delivery.

---

# Quarterly Estimated Tax Reminder
**For:** {{clientName}}
**Period:** {{quarterAndDueDate}}
**From:** [Practitioner name and firm]
**Date:** [Date]

---

Dear {{clientName}},

Your next estimated tax payment is due **[date from quarter selection]**. Here is what you need to know.

## Payment Due Date

**[Date]** — payments postmarked or submitted after this date may result in an underpayment penalty.

## Safe Harbor Calculation

To avoid an underpayment penalty, your total estimated payments for the year should equal at least one of the following:

- **100% of your {{taxYear prior year}} tax liability:** {{priorYearTaxLiability}}
  - This means four equal payments of approximately **[prior year liability ÷ 4]** each quarter.
  - If your AGI in the prior year exceeded $150,000, the safe harbor is 110% of prior year liability.

[If current year income was provided:]
- **90% of your estimated {{current year}} tax liability:** If your income this year is approximately {{currentYearEstimatedIncome}}, 90% of the estimated tax on that income is approximately [calculation or note to practitioner to calculate].

**Recommended payment this quarter:** [State the safe harbor installment amount, adjusted for any prior payments made. Note if the practitioner should verify this figure against prior quarterly payments already made.]

[If changes were noted: add a paragraph addressing the specific change and its estimated impact on the payment amount.]

## How to Pay

[Provide specific instructions for the selected payment method:]

**[IRS Direct Pay]:** Go to irs.gov/payments and select "Make a Payment." Choose "Estimated Tax" as the payment type and "1040-ES" as the form. Enter your Social Security number and the tax year when prompted. You will receive a confirmation number — save it.

**[EFTPS]:** Log in to eftps.gov at least one business day before the due date. Select the 1040-ES payment type for the correct tax year. Save your confirmation number.

**[Check]:** Make your check payable to "United States Treasury." Write your Social Security number, "2025 Form 1040-ES," and the tax year on the memo line. Mail to the address listed in the Form 1040-ES instructions for your state. Mail early enough to ensure it is postmarked by the due date.

## If Your Income Has Changed Significantly

If your income this year is materially higher or lower than last year, your actual tax may differ significantly from the safe harbor amount. Contact [practitioner name] before the due date if you have had major income changes this quarter — we can recalculate your estimated payment to avoid a large balance due or overpayment at filing.

[If changes were noted: "We have already factored [summary of change] into the recommendation above. Please confirm the transaction details with us so we can finalize the calculation."]

Questions? Contact [practitioner name] at [contact information].

---

*This reminder is based on the information available to us as of the date prepared. Estimated tax calculations involve projections — your actual liability will be determined when your return is filed. Always save your payment confirmation number.*`;

export const QuarterlyEstimateReminder: WorkflowTemplate = {
  id: 'tax-quarterly-estimate-reminder',
  name: 'Quarterly Estimate Reminder',
  description: 'Generates a client-ready quarterly estimated tax reminder with the due date, safe harbor calculation, recommended payment amount, and payment instructions for the client\'s chosen method.',
  version: '1.0.0',
  category: 'tax',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Quarterly Payment Details',
      description: 'Provide the client, quarter, prior year liability, and payment method',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-quarterly-reminder',
      type: 'generate',
      name: 'Generate Quarterly Reminder',
      description: 'Draft the client-ready payment reminder with safe harbor calculation and instructions',
      config: {
        outputFile: 'QUARTERLY_ESTIMATE_REMINDER.md',
        promptTemplate: quarterlyEstimateReminderPrompt,
        systemPrompt: 'You are a tax practice assistant helping a licensed CPA or EA draft a quarterly estimated tax reminder for a client. You write in plain language the client can understand without a tax background. You calculate the safe harbor installment amount from the prior year liability provided and present it clearly. You provide specific, accurate payment instructions for the client\'s chosen method. You flag when income changes may warrant a recalculated estimate.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['QUARTERLY_ESTIMATE_REMINDER.md'],
  namedOutputs: [
    { id: 'reminder_letter', name: 'Client reminder letter', schema: 'string' },
    { id: 'safe_harbor_amount', name: 'Safe harbor payment amount', schema: 'string' },
  ],
};

export default QuarterlyEstimateReminder;
