// @draft — Tax Practice Pack v2.2
// Requires CPA/EA advisor review before shipping. Do not expose to users without review.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Client name for the file. Used in the memo header.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Brightfield Manufacturing, Inc.',
  },
  {
    id: 'taxIssue',
    question: 'Tax issue or question',
    description: 'State the specific tax question this memo addresses.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Whether amounts received from a client for a cancelled engagement are includible in gross income',
  },
  {
    id: 'relevantFacts',
    question: 'Relevant facts',
    description: 'The material facts that bear on the analysis. Be thorough — facts you omit may affect the conclusion.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Taxpayer is a cash-basis sole proprietor who received $15,000 as a kill fee when a client cancelled a consulting engagement in January 2025...',
  },
  {
    id: 'ircSections',
    question: 'IRC sections or Treasury Regulations at issue (optional)',
    description: 'Code sections or regulations you have already identified as relevant. Leave blank if you want the analysis to identify the applicable authority.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., IRC §61, Reg. §1.61-1',
  },
  {
    id: 'casesCited',
    question: 'Applicable cases or rulings known (optional)',
    description: 'Any cases, revenue rulings, PLRs, or CCA memos you have already found. The memo will incorporate them into the analysis.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Rev. Rul. 2004-34; Glenshaw Glass Co. v. Commissioner',
  },
  {
    id: 'proposedTreatment',
    question: 'Proposed treatment',
    description: 'The tax position you are considering taking or documenting.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Amounts are includible as ordinary income in the year received under the annual accounting principle',
  },
];

const taxResearchMemoPrompt = `You are assisting a licensed tax professional in drafting a research memo documenting a tax position for the client file. This is a practitioner work-product document. You are organizing the analysis, not providing independent tax advice.

Client name: {{clientName}}
Tax issue: {{taxIssue}}
Relevant facts: {{relevantFacts}}
IRC sections / regulations at issue: {{ircSections}}
Applicable cases or rulings: {{casesCited}}
Proposed treatment: {{proposedTreatment}}

Produce a formatted research memo in Markdown. At the top, include the draft notice.

> **Draft document** — Review and edit before delivery.

---

# Tax Research Memorandum
**PRACTITIONER WORK PRODUCT — PRIVILEGED AND CONFIDENTIAL**

**Client:** {{clientName}}
**Issue:** [Brief restatement of the tax question]
**Date:** [Date]
**Prepared by:** [Practitioner name]

---

## Issue

[Restate the tax question precisely, in the form: "Whether [taxpayer] must/may [treatment] under [applicable authority]." One to three sentences.]

---

## Facts

[Organize the relevant facts clearly and completely. Use the facts as provided, without editorializing. Flag any facts that are uncertain or that may need further development. Facts should be stated in the past tense and in third person.]

---

## Analysis

### Applicable Law

[Identify and explain the relevant IRC sections, Treasury Regulations, and other authorities. For each authority cited, state the rule it establishes. If the IRC sections were not specified, identify the most directly applicable provisions based on the issue presented. Cite regulations and rulings where they clarify the statute.]

### Application to Facts

[Apply the law to the specific facts. Walk through the analysis step by step. Where there is a clear answer, state it. Where there is ambiguity, explain why and what facts or authorities would resolve it. If cases or rulings were provided, apply them here.]

### Counterarguments Considered

[Identify the strongest arguments against the proposed treatment and explain why they do not control, or flag them as genuine risks if they are substantial. Be honest about the strength of the position — this memo protects the practitioner by documenting that the risks were considered.]

---

## Conclusion

[State the conclusion directly. Identify the confidence level — e.g., "more likely than not," "substantial authority," "reasonable basis" — using the relevant penalty standards where appropriate. Note any conditions or caveats that could change the conclusion.]

---

## Authorities Cited

[List all authorities cited in the memo, organized by type:
- Internal Revenue Code sections
- Treasury Regulations
- Revenue Rulings and Revenue Procedures
- Cases
- Private Letter Rulings / CCAs (note these are non-precedential)
- Other]

---

## Citations — Verify Before Relying

The following citations were generated by AI. Verify each against the actual IRC section, Treasury Regulation, or primary authority before relying on this memo in client advice.

| Status | Citation (IRC/Reg/Rev. Proc.) | AI description | Verified against primary source | As of date |
|--------|------------------------------|----------------|--------------------------------|-----------|
| ⬜ UNVERIFIED | [citation] | [AI description of what it says] | ____________ | [quarter] |

*Change ⬜ to ✅ after each verification. Note: quarterly interest rates and inflation-adjusted figures change each quarter — confirm the current values before issuing advice.*

---

*This memorandum is a practitioner work-product document prepared for internal file purposes. It reflects analysis as of the date prepared and is based on the facts as stated. Changes in the facts or applicable law may alter the conclusion. This memorandum is not a guarantee of any particular tax result.*`;

export const TaxResearchMemo: WorkflowTemplate = {
  id: 'tax-research-memo',
  name: 'Tax Research Memo',
  description: 'Drafts a research memo documenting a tax position for the file, with sections for Issue, Facts, Analysis (applicable law, application to facts, counterarguments), Conclusion, and Authorities Cited.',
  version: '1.0.0',
  category: 'tax',
  requiresVerification: true,
  verificationNote: 'Verify every citation in the table below against the actual IRC section, Treasury Reg, or primary authority. Change ⬜ to ✅ after each verification. Note the quarterly interest rate in Quarterly Estimate outputs changes with each quarter.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Research Issue Details',
      description: 'Describe the tax issue, facts, and known authorities',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-research-memo',
      type: 'generate',
      name: 'Generate Research Memo',
      description: 'Draft the research memo with issue, facts, analysis, conclusion, and authorities',
      config: {
        outputFile: 'TAX_RESEARCH_MEMO.md',
        promptTemplate: taxResearchMemoPrompt,
        systemPrompt: 'You are a tax research assistant helping a licensed CPA or EA draft a practitioner work-product research memo. You are precise about the difference between statutory rules, regulatory guidance, and case law. You identify the applicable penalty standards (substantial authority, reasonable basis, more likely than not) and frame the conclusion in those terms. You never overstate the strength of a position and always note genuine counterarguments. You cite authorities by their correct names and citation forms.\n\nCRITICAL CITATION DISCIPLINE: Every IRC section, Treasury Regulation, Revenue Ruling, Revenue Procedure, case citation, and IRS guidance you assert in this memo must be treated as unverified until the practitioner checks it against primary authority. When you cite a code section or ruling, append a note: "(verify against primary authority)". Clearly distinguish between two types of content: (1) analysis grounded in the documents and facts provided by the practitioner, which you should label as such, and (2) general tax law knowledge from your training data, which may contain errors in section numbers, ruling dates, or holdings and must be independently verified. End every memo with this exact footer block:\n\n---\n\n**VERIFICATION REQUIRED:** All IRC section references, Revenue Procedure citations, and regulatory framing in this memo must be verified against primary authority (IRS.gov, Checkpoint, Bloomberg Tax, or equivalent) before relying on them in client advice. AI can misstate citation details.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['TAX_RESEARCH_MEMO.md'],
  namedOutputs: [
    { id: 'research_memo', name: 'Tax research memo', schema: 'string' },
    { id: 'authorities_cited', name: 'Authorities cited', schema: 'array' },
    { id: 'conclusion', name: 'Research conclusion', schema: 'string' },
  ],
};

export default TaxResearchMemo;
