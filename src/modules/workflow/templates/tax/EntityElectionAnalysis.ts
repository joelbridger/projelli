// @draft — Tax Practice Pack v2.2
// Requires CPA/EA advisor review before shipping. Do not expose to users without review.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Name of the business owner or entity this analysis covers.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Renata M. Osei',
  },
  {
    id: 'currentEntityType',
    question: 'Current entity type',
    description: 'How the business is currently organized and taxed.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Single-member LLC taxed as Schedule C sole proprietor',
  },
  {
    id: 'netProfitRange',
    question: 'Net profit range (annual)',
    description: 'Estimated or actual annual net business profit. This is the primary driver of the SE tax impact calculation.',
    type: 'text',
    required: true,
    placeholder: 'e.g., $120,000 to $140,000',
  },
  {
    id: 'ownerOtherIncome',
    question: 'Owner\'s other income',
    description: 'Describe any W-2 wages, investment income, or other income the owner earns outside this business. Relevant to SE tax ceiling, QBI deduction phase-outs, and C-corp dividend taxation.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., No W-2 income; spouse has $85,000 W-2 income; MFJ filing; no significant investment income',
  },
  {
    id: 'stateOfOperation',
    question: 'State of operation',
    description: 'Primary state where the business operates. State income tax, franchise tax, and S-corp eligibility rules vary significantly.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Texas (no individual income tax; Texas franchise tax applies)',
  },
  {
    id: 'planningHorizon',
    question: 'Planning horizon and exit plans',
    description: 'How long does the owner plan to operate this business? Is an eventual sale, transfer, or wind-down anticipated? Relevant to basis planning, retained earnings, and exit taxation.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., 5-10 year horizon; may sell to a strategic buyer; no current succession plan',
  },
  {
    id: 'businessType',
    question: 'Type of business / industry',
    description: 'Brief description of what the business does. Relevant to SSTB status for QBI deduction and personal holding company rules for C-corp.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Independent graphic design and branding services (personal service business)',
  },
  {
    id: 'currentPayrollOrSalary',
    question: 'Current salary paid to owner (if any)',
    description: 'If the business already pays the owner a salary (e.g., is already an S-corp or C-corp), note the amount. Leave blank if sole proprietor / Schedule C.',
    type: 'text',
    required: false,
    placeholder: 'e.g., None (Schedule C) — or — $60,000/year W-2',
  },
  {
    id: 'additionalContext',
    question: 'Any other relevant context? (optional)',
    description: 'Health insurance deduction, retirement plan contributions, business use of home, planned expansion, partners or co-owners, etc.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Owner pays $18,000/year in health insurance premiums; contributes $20,000/year to SEP-IRA; no co-owners',
  },
];

const entityElectionAnalysisPrompt = `You are assisting a licensed tax professional in structuring an entity election analysis for a small-business client. This is a practitioner work-product document to support a client discussion. You are organizing the comparison, not providing a legal or tax opinion. The practitioner will review this memo before presenting it to the client.

Client name: {{clientName}}
Current entity type: {{currentEntityType}}
Net profit range: {{netProfitRange}}
Owner's other income: {{ownerOtherIncome}}
State of operation: {{stateOfOperation}}
Planning horizon and exit plans: {{planningHorizon}}
Type of business: {{businessType}}
Current salary paid to owner: {{currentPayrollOrSalary}}
Additional context: {{additionalContext}}

Produce a formatted entity election analysis memo in Markdown. Begin with the draft notice.

> **Draft document** — Review and verify all tax rate and threshold figures against current IRS guidance before presenting to a client. Recommend the client consult with a CPA or tax attorney before making any election.

---

# Entity Election Analysis Memo
**PRACTITIONER WORK PRODUCT — FOR CLIENT DISCUSSION**

**Client:** {{clientName}}
**Business:** {{businessType}}
**Current structure:** {{currentEntityType}}
**Prepared by:** [Practitioner name]
**Date:** [Date]

---

## Purpose

This memo structures a comparison of entity election options for {{clientName}} to support a planning discussion. It covers self-employment tax impact, payroll obligations, the qualified business income (QBI) deduction, and exit/basis considerations. This is a discussion starting point, not a final recommendation — the right election depends on facts and projections that the practitioner and client must confirm together.

---

## Section 1 — Self-Employment Tax Impact

**Baseline: Schedule C / Disregarded Entity**

Under the current structure ({{currentEntityType}}), net profit of approximately {{netProfitRange}} is subject to self-employment tax. SE tax applies at 15.3% on the first $[SE wage base — verify for current year] and 2.9% on amounts above that. The SE tax deduction reduces adjusted gross income by one-half of SE tax paid.

[Calculate approximate SE tax burden for the midpoint of the profit range. Show the calculation. Note the SE wage base and verify it against the current-year IRS announcement before presenting.]

**S-Corp Election Scenario**

If the business elected S-corp status and the owner paid themselves a reasonable salary of approximately [estimate a reasonable salary based on the duties and market context provided — note this is an estimate, not an appraisal], employment taxes (FICA + Medicare) would apply only to the salary. Distributions above the salary would not be subject to employment taxes.

[Calculate the approximate SE/FICA tax savings. Show the calculation. Note that this is an estimate based on assumed reasonable compensation — actual savings depend on the salary determined.]

**Note on Reasonable Compensation Requirement**

An S-corp shareholder-employee who provides services must receive a salary that is reasonable compensation for those services before taking distributions. An artificially low salary to minimize FICA is a known IRS audit trigger. A separate reasonable compensation memo should document the basis for the salary selected.

---

## Section 2 — Payroll Obligations

**Schedule C / Sole Proprietor**

No payroll required. Owner pays SE tax via Schedule SE and quarterly estimated payments.

**S-Corp**

Owner-employee must be on payroll. Requires: employer EIN, payroll setup (or payroll service), quarterly Form 941 filings, annual W-2/W-3, state payroll registrations (varies by state — {{stateOfOperation}}). Annual cost of payroll service: typically $[estimate range, varies by provider].

[Note any state-specific payroll requirements for {{stateOfOperation}}.]

**C-Corp**

Same payroll requirements as S-corp for owner-employees. Dividends paid to shareholders are a second layer of tax (C-corp pays corporate rate on income; shareholder pays qualified dividend rate on distributions). Generally not efficient for small businesses where the owner is the primary worker — but may be appropriate in specific scenarios (retained earnings buildup, employee benefits, QSBS exclusion planning).

---

## Section 3 — QBI Deduction Impact (Section 199A)

The qualified business income (QBI) deduction under IRC §199A allows eligible taxpayers to deduct up to 20% of qualified business income. Key considerations for {{clientName}}:

- **SSTB status:** [Assess whether {{businessType}} is a specified service trade or business (SSTB). SSTBs include health, law, accounting, consulting, financial services, and performing arts. If SSTB, the QBI deduction phases out above the taxable income threshold — verify current thresholds against IRS guidance.]

- **W-2 wage limitation:** At higher income levels, the QBI deduction for non-SSTB businesses may be limited by W-2 wages paid or unadjusted basis of qualified property. An S-corp paying a salary creates a W-2 wage amount that may expand the available QBI deduction — analyze in context.

- **Sole proprietor vs. S-corp QBI:** A sole proprietor's net profit (less SE deduction) is qualified business income. An S-corp's QBI is the ordinary income passed through to the shareholder (not the W-2 salary). These interact differently with the wage limitation — model both scenarios.

[Apply the above factors to {{clientName}}'s approximate income and filing status based on the information provided. Note any limitations or phase-outs that apply. Flag if an SSTB determination is needed.]

---

## Section 4 — Exit and Basis Considerations

**Schedule C / Sole Proprietor**

Business assets sold on Schedule C generate ordinary income or capital gain depending on asset type. No corporate structure to complicate the exit.

**S-Corp**

Shareholder's basis in S-corp stock is increased by income and decreased by distributions. Built-in gains tax may apply if converting from C-corp. Asset sale vs. stock sale taxation differs. QSBS exclusion (IRC §1202) does not apply to S-corps.

**C-Corp**

Retained earnings accumulate at the corporate level. Exit via stock sale may qualify for capital gain treatment. QSBS exclusion (IRC §1202) may apply for qualifying small business stock — potentially up to 100% gain exclusion if held 5+ years (verify current requirements and thresholds). Accumulated earnings tax risk if profits are retained without business purpose.

**Planning horizon:** {{planningHorizon}}

[Assess which structure best fits the stated planning horizon and exit scenario.]

---

## Section 5 — Recommendation (Discussion Starting Point)

[Based on the above analysis, frame a recommendation for discussion. Use one of the following framings:]

- If S-corp election appears clearly advantageous at the stated profit level: recommend discussing S-corp election, note the payroll setup requirement, and quantify the approximate annual tax savings vs. payroll/compliance cost.
- If the profit level is close to the breakeven point where S-corp savings are offset by compliance costs: note this and recommend the practitioner model the specific numbers before recommending.
- If the current structure appears appropriate: explain why and note what profit level or change in circumstances would make a different election worth revisiting.

**This recommendation is a discussion starting point.** Final election decisions should be made after reviewing the client's complete financial picture, state tax considerations, and with the client's CPA or tax attorney.

---

## State Tax Considerations: {{stateOfOperation}}

[Note any state-specific considerations relevant to entity election in {{stateOfOperation}}: state income tax rate, franchise tax, S-corp recognition, annual LLC fees, or payroll registration requirements. Flag if state-specific research is needed.]

---

## Key Thresholds and Rates — Verify Before Presenting

The following figures are used in this memo. Verify each against current-year IRS guidance before presenting to a client.

| Figure | Approximate Value Used | Current-Year Value (Verify) | Source |
|--------|----------------------|----------------------------|--------|
| SE tax wage base | $[used] | ____________ | IRS.gov / Pub 15 |
| SE tax rate (below wage base) | 15.3% | ____________ | IRC §1401 |
| SE tax rate (above wage base) | 2.9% | ____________ | IRC §1401 |
| QBI deduction rate | 20% | ____________ | IRC §199A |
| QBI SSTB phase-out threshold (single) | $[used] | ____________ | IRS Rev. Proc. [verify] |
| QBI SSTB phase-out threshold (MFJ) | $[used] | ____________ | IRS Rev. Proc. [verify] |

---

*This memorandum is a practitioner work-product document for client discussion purposes. It reflects a framework analysis based on the facts provided. Tax rates and thresholds change annually. The analysis should be re-run with current-year figures before presenting. Recommend the client consult with a CPA or tax attorney before making any entity election.*`;

export const EntityElectionAnalysis: WorkflowTemplate = {
  id: 'entity-election-analysis',
  name: 'Entity Election Analysis Memo',
  description: 'Structures a Schedule C / S-corp / C-corp election analysis for a small-business client — compares self-employment tax, payroll obligations, and exit planning. Produces a memo for client discussion.',
  version: '1.0.0',
  category: 'tax',
  requiresVerification: true,
  verificationNote: 'Verify all tax rate and threshold figures against current IRS guidance before presenting to a client. Recommend the client consult with a CPA or tax attorney before making any election.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Business and Owner Details',
      description: 'Provide business type, profit range, state, and planning context',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-entity-election-analysis',
      type: 'generate',
      name: 'Generate Entity Election Analysis Memo',
      description: 'Draft the SE tax, payroll, QBI, and exit comparison memo for client discussion',
      config: {
        outputFile: 'ENTITY_ELECTION_ANALYSIS.md',
        promptTemplate: entityElectionAnalysisPrompt,
        systemPrompt: 'You are a tax practice assistant helping a licensed CPA or EA structure an entity election analysis memo for a small-business client discussion. You understand SE tax mechanics, S-corp reasonable compensation requirements, QBI deduction rules (including SSTB classifications), and the basics of C-corp vs. pass-through exit taxation. You frame conclusions as discussion starting points and always note that elections are irreversible for a period and should be made with professional guidance.\n\nCRITICAL: SE tax wage bases, QBI thresholds, and SSTB definitions change through annual IRS announcements and legislation. Every rate and threshold figure used in this memo must be flagged for verification against current-year IRS guidance before presenting to a client. Never present approximate figures as confirmed current values.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['ENTITY_ELECTION_ANALYSIS.md'],
  namedOutputs: [
    { id: 'se_tax_comparison', name: 'SE tax impact comparison', schema: 'string' },
    { id: 'payroll_obligations', name: 'Payroll obligations summary', schema: 'string' },
    { id: 'qbi_analysis', name: 'QBI deduction impact', schema: 'string' },
    { id: 'exit_considerations', name: 'Exit and basis considerations', schema: 'string' },
    { id: 'recommendation', name: 'Discussion recommendation', schema: 'string' },
  ],
};

export default EntityElectionAnalysis;
