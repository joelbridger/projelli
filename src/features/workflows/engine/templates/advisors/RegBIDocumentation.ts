// Advisor Practice Pack v1.0 (shipped). Built with input from practicing advisors.
// Drafting aid: every generated output carries a banner requiring professional review before use.
// COMPLIANCE SENSITIVE: Reg BI (SEC Regulation Best Interest). Highest-sensitivity output in this pack.
// This template produces documentation structure ONLY. It does not provide investment advice, make suitability
// determinations, or satisfy Reg BI on its own. All determinations are advisor judgments. Compliance officer
// review required before ANY client use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientProfileSummary',
    question: 'Client profile summary (anonymized)',
    description: 'Describe the client using anonymized or de-identified information. Do not include the client\'s full name or account numbers in this field — use initials, a client code, or a description.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Client A: married couple, ages 58 and 55. Combined W-2 income ~$210K. Primary financial goal: retirement at 62 (4 years). Secondary goal: fund one child\'s college in 3 years (~$60K needed). Current net worth approximately $1.1M, primarily in 401(k) and home equity.',
  },
  {
    id: 'investmentObjectives',
    question: 'Investment objectives',
    description: 'State the client\'s investment objectives as documented in your records.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Growth with capital preservation for retirement assets. Short-term liquidity for college funding bucket. Income needs post-retirement estimated at $7,500/month.',
  },
  {
    id: 'riskTolerance',
    question: 'Risk tolerance',
    description: 'Describe the client\'s risk tolerance as documented, including both their stated preference and your assessment of their capacity for loss.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Stated tolerance: moderate. Capacity for loss: moderate-to-low given 4-year retirement timeline and near-term college funding need. Completed risk questionnaire on [date] — score indicated balanced profile.',
  },
  {
    id: 'timeHorizon',
    question: 'Time horizon',
    description: 'State the relevant time horizon(s) for this client and recommendation.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Retirement assets: 4 years to retirement, 25+ years post-retirement draw-down. College funding: 3 years.',
  },
  {
    id: 'recommendationUnderConsideration',
    question: 'Recommendation under consideration',
    description: 'Describe the specific recommendation or transaction this documentation covers. Be specific about the security, product, or action.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Recommend partial rollover of current 401(k) ($320K) to a traditional IRA at [Custodian]. Allocation: 60% diversified equity (broad index funds), 30% investment-grade bond funds, 10% short-duration bond fund for college funding bucket. This replaces the current employer plan with limited fund options and higher expense ratios.',
  },
  {
    id: 'alternativesConsidered',
    question: 'Alternatives considered',
    description: 'What alternatives to this recommendation did you consider and why were they not recommended? This is required under Reg BI.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 1. Keep assets in employer plan: rejected because plan expense ratios average 0.85% vs. 0.07% for proposed index funds; limited investment options do not allow target allocation. 2. Annuity product: considered for income certainty, rejected because client has other guaranteed income (Social Security) and liquidity needs in the near term. 3. Actively managed funds: rejected in favor of low-cost index funds given long time horizon and cost drag.',
  },
  {
    id: 'conflictsOfInterest',
    question: 'Conflicts of interest (firm-specific)',
    description: 'Identify any conflicts of interest relevant to this recommendation. If your firm receives any compensation that creates a conflict with this recommendation, state it here.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Fee-only RIA, no commission or 12b-1 fees received. AUM fee applies to the rolled-over assets — this creates an incentive to recommend the rollover. Disclosed to client in Form ADV and verbally at meeting on [date]. No revenue sharing or referral arrangements relevant to this recommendation.',
  },
];

const regBIDocumentationPrompt = `You are assisting a financial advisor in producing a documentation framework for a Reg BI (Regulation Best Interest) client interaction. This template produces a documentation structure for the advisor's file only. It does not provide investment advice, does not make suitability or best-interest determinations, and does not satisfy Reg BI on its own. All suitability and best-interest determinations are the advisor's professional judgments. Every section of the output is clearly labeled DRAFT — ADVISOR REVIEW REQUIRED.

IMPORTANT: This is documentation scaffolding. You do not advise on whether the recommendation is suitable or in the client's best interest — those are advisor determinations. You structure the documentation so the advisor can record their own analysis and judgment in a format that supports Reg BI compliance.

Client profile summary: {{clientProfileSummary}}
Investment objectives: {{investmentObjectives}}
Risk tolerance: {{riskTolerance}}
Time horizon: {{timeHorizon}}
Recommendation under consideration: {{recommendationUnderConsideration}}
Alternatives considered: {{alternativesConsidered}}
Conflicts of interest: {{conflictsOfInterest}}

Produce a Reg BI documentation framework in Markdown. At the top, include the compliance notice.

> **DRAFT — ADVISOR REVIEW REQUIRED.** This template produces a documentation framework only. Suitability and best-interest determinations are advisor judgments, not AI outputs. This document does not constitute investment advice and does not satisfy Reg BI on its own. Have your compliance officer review all Reg BI documentation before client use. Nothing in this document constitutes a recommendation, and no one should act on this document without qualified professional review.

---

# Reg BI Suitability and Best-Interest Documentation
**DRAFT — ADVISOR REVIEW REQUIRED BEFORE CLIENT USE OR FILING**

**Client:** [from inputs — use anonymized identifier]
**Recommendation:** [brief label from inputs]
**Prepared:** [date]
**Regulation reference:** SEC Regulation Best Interest (17 CFR Part 240, Rule 15l-1)

---

## Important Notice

This document is a documentation framework prepared by the advisor using ${BRAND.name}. It structures the advisor's analysis and judgment — it does not substitute for that judgment. All suitability and best-interest determinations in this document are the advisor's, not AI-generated conclusions. This document is not investment advice. Review and complete all sections marked [ADVISOR: complete] before filing or using this document.

---

## Section 1: Client Profile Summary

**DRAFT — Verify against current client records before filing.**

Summarize long inputs in this table to the first line or a brief phrase. The full notes appear in later sections where needed.

| Field | Documented value | Last updated |
|---|---|---|
| Client description | {{clientProfileSummary}} | [Date — complete] |
| Investment objectives | {{investmentObjectives}} | [Date — complete] |
| Risk tolerance | {{riskTolerance}} | [Date — complete] |
| Time horizon | {{timeHorizon}} | [Date — complete] |
| Financial situation (summary) | [ADVISOR: summarize key financial facts relevant to this recommendation] | [Date] |
| Tax status / considerations | [ADVISOR: complete] | [Date] |
| Liquidity needs | [ADVISOR: complete] | [Date] |

**[ADVISOR: Confirm each row against current client records. If any fact has changed since the last suitability review, update the records before proceeding with this recommendation.]**

---

## Section 2: Investment Objectives and Risk Documentation

**DRAFT — Advisor judgment required.**

### Documented Objectives

{{investmentObjectives}}

### Risk Tolerance

{{riskTolerance}}

### Time Horizon

{{timeHorizon}}

### Consistency Analysis

**[ADVISOR: Complete this section with your assessment of whether the recommendation under consideration is consistent with the client's documented objectives, risk tolerance, and time horizon. This is your professional judgment — not an AI determination.]**

The recommendation under consideration is: [ADVISOR: state whether consistent / not consistent / partially consistent with documented profile, and why]

Key factors considered:
- [ADVISOR: factor 1 — e.g., time horizon relative to product liquidity]
- [ADVISOR: factor 2]
- [ADVISOR: factor 3]

---

## Section 3: Alternatives Considered

**DRAFT — Verify against your analysis before filing.**

Reg BI requires that the advisor evaluate reasonably available alternatives before making a recommendation. The following alternatives were considered:

Use the advisor's alternatives notes below to complete the table. Restructure them into one row per alternative.

{{alternativesConsidered}}

| Alternative | Why considered | Reason not recommended |
|---|---|---|
| [Alternative 1 from inputs] | [Why it was relevant to consider] | [Reason not recommended — from inputs] |
| [Alternative 2 from inputs] | [Why it was relevant to consider] | [Reason not recommended — from inputs] |
| [Alternative 3 from inputs] | [Why it was relevant to consider] | [Reason not recommended — from inputs] |

**[ADVISOR: Confirm this table is complete and accurately reflects your analysis. Add any additional alternatives considered. The "reason not recommended" must reflect your professional judgment, not boilerplate.]**

---

## Section 4: Best-Interest Analysis

**DRAFT — ADVISOR JUDGMENT REQUIRED. Do not file without completing this section.**

This section structures the best-interest analysis required by Reg BI. The analysis and determination are the advisor's professional judgment.

### 4.1 Cost Analysis

| Factor | This recommendation | Best available alternative | Notes |
|---|---|---|---|
| Expense ratio / ongoing cost | [ADVISOR: complete] | [ADVISOR: complete] | |
| Transaction costs | [ADVISOR: complete] | [ADVISOR: complete] | |
| Advisor fee impact | [ADVISOR: complete] | [ADVISOR: complete] | |
| Tax implications | [ADVISOR: complete] | [ADVISOR: complete] | |

### 4.2 Risk / Return Profile

[ADVISOR: Describe how this recommendation's risk / return profile is appropriate for this client's objectives and time horizon. This is your assessment, not an AI determination.]

### 4.3 Complexity and Understanding

[ADVISOR: Note any complexity in this product or strategy and how you confirmed the client understands what they are investing in or agreeing to.]

### 4.4 Best-Interest Determination

**[ADVISOR: State your determination that this recommendation is in the client's best interest, and the basis for that determination. This must be your professional judgment. Example format:]**

I determine that the recommended [brief description] is in the best interest of [client identifier] based on: (1) consistency with documented investment objectives; (2) the cost analysis above showing [key cost advantage]; (3) the alternatives considered and rejected as set out in Section 3; (4) the client's risk tolerance and time horizon as documented.

[ADVISOR: Complete or rewrite this determination in your own words before filing.]

---

## Section 5: Conflicts of Interest

**DRAFT — Verify disclosure completeness with your compliance officer.**

{{conflictsOfInterest}}

### Disclosure Record

Use the conflicts text below to extract each distinct conflict as a row.

| Conflict | Disclosed to client | Date | Method | Mitigation |
|---|---|---|---|---|
| [Conflict from inputs: {{conflictsOfInterest}}] | [Yes / No] | [Date] | [Verbal / Written / Form ADV] | [How the conflict was addressed] |

**[ADVISOR: Confirm each conflict is accurately described and that the disclosure is documented. If any conflict is not adequately disclosed, consult your compliance officer before proceeding.]**

---

## Section 6: Documentation Sign-Off

**DRAFT — Complete and sign before filing.**

| Item | Completed | Date | Notes |
|---|---|---|---|
| Client profile verified against current records | | | |
| Alternatives considered and documented | | | |
| Best-interest determination completed (Section 4.4) | | | |
| Conflicts disclosed and documented | | | |
| Client acknowledged recommendation and conflicts | | | |
| Compliance officer review (if required by firm policy) | | | |

**Advisor certification:**

I certify that the recommendation documented above reflects my professional judgment that it is in the best interest of the client, that I have considered reasonably available alternatives, and that all material conflicts of interest have been disclosed.

Advisor signature: _________________________ Date: _____________

**[ADVISOR: Sign and date this section. Do not file this document without completing the sign-off block.]**

---

*This documentation framework is a DRAFT. Suitability and best-interest determinations are advisor judgments, not AI outputs. This document does not constitute investment advice and does not satisfy Reg BI on its own. Have your compliance officer review all Reg BI documentation before client use or filing.*`;

export const RegBIDocumentation: WorkflowTemplate = {
  id: 'advisors-reg-bi-documentation',
  name: 'Reg BI Suitability Documentation',
  description: 'Structures suitability and best-interest documentation for dual-registrant (broker-dealer / RIA) client interactions. Produces a documentation framework for your file — not investment advice.',
  version: '1.0.0',
  category: 'advisors',
  requiresVerification: true,
  verificationNote: 'This template produces a documentation framework only. Suitability and best-interest determinations are advisor judgments. Have your compliance officer review all Reg BI documentation before client use.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Client and Recommendation Information',
      description: 'Provide the anonymized client profile, investment objectives, risk tolerance, recommendation, alternatives considered, and conflicts of interest',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-reg-bi-documentation',
      type: 'generate',
      name: 'Generate Reg BI Documentation Framework',
      description: 'Produce a client profile summary, investment objective documentation, alternatives considered, best-interest analysis structure, conflict disclosures, and sign-off block',
      config: {
        outputFile: 'REG_BI_DOCUMENTATION.md',
        promptTemplate: regBIDocumentationPrompt,
        systemPrompt: `You are a financial advisory compliance assistant helping an advisor produce a Reg BI documentation framework. This is the most compliance-sensitive output in the ${BRAND.name} advisor pack. You are absolutely clear at every step: this template structures the advisor's own analysis and judgment — it does not provide investment advice, make suitability determinations, or satisfy Reg BI on its own. Every section that requires the advisor's professional judgment has explicit [ADVISOR: complete] placeholders. You never state that a recommendation is suitable or in the client's best interest — those are advisor determinations only. The best-interest analysis structure is comprehensive and practical, covering cost, risk/return, complexity, and alternatives, but every cell requires the advisor to fill in their own assessment. The sign-off block is explicit and requires advisor signature before filing.`,
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['REG_BI_DOCUMENTATION.md'],
  namedOutputs: [
    { id: 'client_profile_summary', name: 'Client profile summary', schema: 'string' },
    { id: 'alternatives_considered', name: 'Alternatives considered', schema: 'array' },
    { id: 'best_interest_framework', name: 'Best-interest analysis structure', schema: 'string' },
  ],
};

export default RegBIDocumentation;
