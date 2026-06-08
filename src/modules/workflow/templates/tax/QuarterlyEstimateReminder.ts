// Tax Practice Pack v2.2 (shipped). Built with input from practicing CPAs and EAs.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full name of the client. Used in the letter salutation and header.',
    type: 'text',
    required: true,
    placeholder: 'e.g., James R. Novak',
  },
  {
    id: 'taxYear',
    question: 'Tax year',
    description: 'The current tax year for which estimated payments are being made.',
    type: 'text',
    required: true,
    placeholder: 'e.g., 2026',
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
    question: 'Prior year total tax liability',
    description: 'The client\'s total tax liability from the prior year return (Form 1040, line 24). This is the basis for the safe harbor calculation.',
    type: 'text',
    required: true,
    placeholder: 'e.g., $18,400 (from 2025 Form 1040, line 24)',
  },
  {
    id: 'priorYearAGI',
    question: 'Prior year adjusted gross income (AGI)',
    description: 'The client\'s AGI from the prior year return. Used to determine whether the 100% or 110% safe harbor applies (110% applies if prior year AGI exceeded $150,000).',
    type: 'text',
    required: true,
    placeholder: 'e.g., $145,000 or $210,000',
  },
  {
    id: 'safeHarborMethod',
    question: 'Which safe harbor method applies?',
    description: 'Select the method to use for this client\'s recommended payment. "Prior year liability" uses 100% or 110% of last year\'s tax. "Current year 90%" estimates this year\'s liability and targets 90% of that. "Lower of both" presents both options so the client can choose the smaller payment.',
    type: 'select',
    required: true,
    options: [
      'Prior year liability (100% or 110%)',
      'Current year estimate — 90% method',
      'Lower of both — present both options',
    ],
    defaultValue: 'Prior year liability (100% or 110%)',
  },
  {
    id: 'currentYearEstimate',
    question: 'Current year estimated tax liability (if using 90% method)',
    description: 'If you selected the 90% method or "lower of both," provide your estimate of the client\'s total tax liability for the current year. Leave blank if using only the prior year safe harbor.',
    type: 'text',
    required: false,
    placeholder: 'e.g., $22,000 estimated for 2026',
  },
  {
    id: 'priorPaymentsThisYear',
    question: 'Estimated payments already made this year (optional)',
    description: 'Total of any Q1, Q2, or Q3 payments already made. Used to calculate how much remains to pay through year-end. Leave blank if this is Q1 or if no prior payments have been made.',
    type: 'text',
    required: false,
    placeholder: 'e.g., $9,000 paid through Q2',
  },
  {
    id: 'unusualIncomeEvents',
    question: 'Unusual income events this year (optional)',
    description: 'Large capital gains, business income changes, a Roth conversion, rental property sale, or other one-time events that affect this year\'s tax picture. Include in as much detail as is relevant.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Client sold rental property in Q2 with estimated $60,000 capital gain. Also received a one-time bonus of $25,000 in Q1.',
  },
  {
    id: 'paymentMethod',
    question: 'Payment method the client uses',
    description: 'How the client typically makes estimated tax payments. Determines which payment instructions appear in the letter.',
    type: 'select',
    required: true,
    options: ['IRS Direct Pay', 'EFTPS', 'Check', 'Varies / unsure'],
    defaultValue: 'IRS Direct Pay',
  },
];

const quarterlyEstimateReminderPrompt = `You are assisting a licensed tax professional in drafting a personalized quarterly estimated tax letter for a specific client. This is not a generic reminder — it explains the client's actual numbers, how the estimate was calculated, and what the consequences of underpayment would be, in plain language the client can understand without a tax background.

Client name: {{clientName}}
Tax year: {{taxYear}}
Quarter and due date: {{quarterAndDueDate}}
Prior year total tax liability: {{priorYearTaxLiability}}
Prior year AGI: {{priorYearAGI}}
Safe harbor method: {{safeHarborMethod}}
Current year estimated tax liability: {{currentYearEstimate}}
Estimated payments already made this year: {{priorPaymentsThisYear}}
Unusual income events this year: {{unusualIncomeEvents}}
Payment method: {{paymentMethod}}

Produce a complete, client-ready letter in Markdown. At the top, include the draft notice.

> **Draft document** — Review all figures and edit before delivery to client.

---

# Quarterly Estimated Tax Letter
**For:** {{clientName}}
**Period:** {{quarterAndDueDate}}, {{taxYear}}
**From:** [Practitioner name and firm]
**Date:** [Date]

---

Dear {{clientName}},

This letter covers your {{taxYear}} estimated tax payment due {{quarterAndDueDate}}. Below I explain the recommended payment amount, how I arrived at it, and what happens if the payment falls short. Please read the whole letter before paying — the amount is specific to your situation this quarter.

## Your Recommended Payment This Quarter

**Recommended payment: [Calculate and state the dollar amount clearly. Show your work in plain terms — do the math from the inputs provided and state the result.]**

[Follow with 1-2 sentences explaining in plain language what this number represents: which safe harbor method it uses, what percentage of the annual total it covers, and how prior payments (if any) were factored in.]

## How I Calculated This

[Based on the safe harbor method selected, write a clear explanation for a non-accountant.]

**If using "Prior year liability" method:**
Walk through the calculation step by step:
1. Your {{taxYear minus 1}} total tax was {{priorYearTaxLiability}}.
2. Because your prior year AGI [was / was not] above $150,000, the safe harbor is [100% / 110%] of that amount — meaning your total estimated payments for {{taxYear}} need to equal at least [calculate: 100% or 110% × prior year liability].
3. That annual safe harbor target divided across four equal installments is [annual ÷ 4] per quarter.
4. [If prior payments were provided: You have already paid [priorPaymentsThisYear] toward {{taxYear}}. The remaining amount to reach the safe harbor is [annual target minus payments made], spread across [remaining quarters]. This quarter's share is [calculated amount].]
5. **Your recommended payment this quarter: [amount].**

**If using "Current year 90%" method:**
Walk through:
1. Based on [current year estimate basis], your estimated {{taxYear}} total tax is approximately {{currentYearEstimate}}.
2. The 90% threshold — the amount you need to pay in by year-end to avoid a penalty under this method — is [0.90 × currentYearEstimate].
3. [Factor in prior payments if provided.]
4. **Your recommended payment this quarter: [amount].**

**If presenting "lower of both":**
Present both calculations clearly and tell the client which produces the smaller payment. Explain that they can pay the smaller of the two and avoid the underpayment penalty either way.

[If unusual income events were described: Add a paragraph addressing the impact on this quarter's calculation. Be specific — explain how the capital gain, bonus, or other event affects the estimate. If the income event means the current-year estimate is significantly higher than the prior-year safe harbor, flag this and explain what it means for the client's total payment obligation.]

## What Happens If You Underpay

The IRS charges an underpayment penalty when your estimated payments fall short of both the safe harbor threshold and 90% of your actual tax. As of {{taxYear}}, the underpayment interest rate is the federal short-term rate plus 3 percentage points, applied daily to the underpaid amount. This is not a punitive penalty — it is calculated like interest on a short-term loan — but it does add up over a full tax year, especially for large shortfalls.

Paying the recommended amount above eliminates the underpayment penalty for this quarter regardless of where your final {{taxYear}} tax lands. Even if you owe a balance at filing, you will not owe the quarterly penalty.

[If unusual income events were described and they are large: Flag specifically whether the unusual income pushes the client toward a situation where the prior-year safe harbor is not enough to cover the actual liability, and whether paying more than the safe harbor minimum may be advisable to avoid a large balance due at filing.]

## How to Pay

[Provide specific instructions for the selected payment method:]

**If IRS Direct Pay:** Go to [irs.gov/directpay](https://www.irs.gov/payments/direct-pay) and click "Make a Payment." Select "Estimated Tax" as the reason for payment, then "1040-ES" as the form. Enter your Social Security number, the tax year ({{taxYear}}), and the payment amount. You will receive a confirmation number — save it. You can schedule payments up to 30 days in advance.

**If EFTPS:** Log in to [eftps.gov](https://www.eftps.gov). Select "Make a Tax Payment." Choose "1040ES" as the tax form and {{taxYear}} as the tax period. Schedule the payment at least one business day before the due date. Save your EFT acknowledgment number.

**If Check:** Make your check payable to "United States Treasury." On the memo line, write your Social Security number, "{{taxYear}} Form 1040-ES," and the quarter. Mail to the address in the Form 1040-ES instructions for your state. Mail early enough to be postmarked by the due date — not just mailed by it.

## If Your Income Changes Before Year-End

If your income changes materially between now and year-end — a larger-than-expected bonus, a property sale, a business income shift — contact me before Q3 or Q4. We can recalculate your remaining estimated payments so you do not face a surprise balance or miss a safe harbor. A mid-year recalculation takes about 15 minutes and can save you real money in penalties and interest.

Questions? Contact [practitioner name] at [contact information].

---

*This letter is based on information available as of the date prepared. Your actual {{taxYear}} tax liability will be determined when your return is filed. Save your payment confirmation number for your records.*

---

> **Practitioner notes (remove before sending):**
> - Verify all calculated figures above against your tax software before delivering this letter
> - Confirm the safe harbor percentage (100% vs 110%) using the client's actual prior year AGI
> - If the client has withholding from wages or other sources, factor that in — it reduces the estimated payment needed
> - File a copy of this letter in the client's engagement file`;

export const QuarterlyEstimateReminder: WorkflowTemplate = {
  id: 'tax-quarterly-estimate-reminder',
  name: 'Quarterly Estimate Reminder',
  description: 'Generates a personalized client letter explaining the recommended estimated tax payment, how it was calculated (safe-harbor vs actual method), which safe harbor applies based on prior year AGI, and the consequences of underpayment. Goes beyond a generic reminder by walking the client through the actual numbers and their specific situation.',
  version: '2.0.0',
  category: 'tax',
  requiresVerification: true,
  verificationNote: 'This output includes a Section 6621 interest rate that changes quarterly. Verify the current rate and confirm safe-harbor math against the client\'s prior-year liability before sending.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Client & Tax Details',
      description: 'Provide the client name, prior year liability, AGI, safe harbor method, and any unusual income events',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-quarterly-reminder',
      type: 'generate',
      name: 'Generate Personalized Estimate Letter',
      description: 'Draft the complete client letter with calculation walkthrough, safe harbor explanation, underpayment consequences, and payment instructions',
      config: {
        outputFile: 'QUARTERLY_ESTIMATE_LETTER.md',
        promptTemplate: quarterlyEstimateReminderPrompt,
        systemPrompt: 'You are a tax practice assistant helping a licensed CPA or EA draft a personalized quarterly estimated tax letter for a specific client. You do the math: calculate the safe harbor amount from prior year liability, determine whether the 100% or 110% threshold applies based on the AGI provided, factor in any prior payments already made, and state a specific recommended payment amount. You explain the calculation step by step in plain language a non-accountant can follow. You explain the underpayment penalty clearly without overstating it. You address unusual income events directly and specifically rather than generically. You include a practitioner notes section at the end with checklist items the CPA/EA should verify before delivering the letter.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['QUARTERLY_ESTIMATE_LETTER.md'],
  namedOutputs: [
    { id: 'estimate_letter', name: 'Personalized client estimate letter', schema: 'string' },
    { id: 'safe_harbor_amount', name: 'Safe harbor payment amount', schema: 'string' },
    { id: 'calculation_summary', name: 'Calculation walkthrough', schema: 'string' },
  ],
};

export default QuarterlyEstimateReminder;
