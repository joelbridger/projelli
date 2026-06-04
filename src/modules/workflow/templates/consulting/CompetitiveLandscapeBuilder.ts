// @draft — Consulting Practice Pack v2.3
// Can ship without formal advisor review (no statutory claims).
// Recommend one experienced consultant read-through before production.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientBusiness',
    question: "Client's business",
    description: "Brief description of the client's business, market, and current position.",
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Regional wealth management firm, ~$800M AUM, serving mass-affluent clients in the mid-Atlantic. Currently competing on personal service and local relationships.',
  },
  {
    id: 'competitorsToAnalyze',
    question: 'Competitors to analyze',
    description: 'List the specific competitors you want included in the analysis, one per line or comma-separated. Include enough context to distinguish them.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Fidelity (national platform, self-directed + advisory), Merrill Lynch (wirehouse, full-service), Betterment (robo-advisor, digital), Local firm XYZ (direct regional competitor)',
  },
  {
    id: 'comparisonDimensions',
    question: 'Key dimensions to compare',
    description: 'What factors matter most for this competitive analysis? List the dimensions you want the matrix to cover.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Pricing / fee model, Service model (digital vs. human), Minimum account size, Product breadth, Technology platform, Target client segment',
  },
  {
    id: 'availableData',
    question: 'Available data and sources',
    description: 'Paste or describe the competitive data you have: pricing pages, client reviews, sales collateral, ADVs, industry reports, your own observations. Be specific about what you actually know vs. what you are inferring.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Fidelity: published fee schedule from fidelity.com (retrieved May 2026). Merrill: fee estimates from advisor disclosure, $1,000+ minimum documented. Betterment: 0.25% / 0.40% tiers from website. XYZ: met with their advisor at a conference, they quoted ~1% all-in.',
  },
  {
    id: 'clientStrengths',
    question: "Client's known strengths and weaknesses",
    description: "What does the client do well, and where are they genuinely weaker? This anchors the strategic implications.",
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Strengths: high retention, 95% referral-driven growth, deep family relationships. Weaknesses: no digital portal, limited estate planning capability, single-person dependency risk.',
  },
  {
    id: 'strategicQuestion',
    question: 'Strategic question this analysis should answer (optional)',
    description: 'What decision or question is this competitive analysis meant to inform?',
    type: 'text',
    required: false,
    placeholder: 'e.g., Should we invest in a digital portal, or double down on the personal-service differentiator?',
  },
];

const competitiveLandscapeBuilderPrompt = `You are assisting a consultant in building a competitive landscape analysis for a client engagement. This is an internal working document — write it for the consultant's use and for structured client discussion, not as a polished final deliverable.

Client's business: {{clientBusiness}}
Competitors to analyze: {{competitorsToAnalyze}}
Key dimensions to compare: {{comparisonDimensions}}
Available data and sources: {{availableData}}
Client's known strengths and weaknesses: {{clientStrengths}}
Strategic question to answer: {{strategicQuestion}}

Produce a competitive landscape analysis in Markdown. At the top, include the draft notice.

> **Draft document** — Verify all competitive claims and market-size figures against current primary sources before presenting to a client. Competitor information changes rapidly.

---

# Competitive Landscape Analysis
**INTERNAL — DRAFT FOR CONSULTANT REVIEW**

**Client:** [from context]
**Prepared:** [date]
**Strategic question:** {{strategicQuestion}}

---

## How to Read This Document

[2–3 sentences explaining what this analysis does and does not do: it structures available data, flags gaps, and surfaces implications, but every claim carries a data confidence flag that must be verified before use with the client.]

---

## Competitive Matrix

[Produce a Markdown table with the client in the first row, then each named competitor. Columns = the comparison dimensions provided. For each cell: fill in what the available data supports. Where data is inferred or uncertain, mark the cell with (estimated) or (unconfirmed). Do not fabricate specific numbers not present in the inputs.]

| Competitor | [Dimension 1] | [Dimension 2] | [Dimension 3] | [Dimension 4] | [Dimension 5] | [Dimension 6] |
|---|---|---|---|---|---|---|
| **[Client name]** | | | | | | |
| [Competitor 1] | | | | | | |
| [Competitor 2] | | | | | | |
| [Competitor 3] | | | | | | |
| [Competitor 4] | | | | | | |

**Key:** (estimated) = inferred from public signals, not confirmed. (unconfirmed) = mentioned in notes but not independently verified.

---

## Competitor Narratives

[For each competitor, write a brief narrative (3–6 sentences) covering: who they are, what their apparent strategy is, where they compete most aggressively, and what their most relevant strength or threat is relative to the client. Do not editorialize beyond what the data supports. Flag claims with data confidence notes inline.]

### [Competitor 1 Name]

[Narrative. Data confidence: HIGH / MEDIUM / LOW — [brief reason, e.g., "fee schedule from public ADV"]]

### [Competitor 2 Name]

[Narrative. Data confidence: HIGH / MEDIUM / LOW]

### [Competitor 3 Name]

[Narrative. Data confidence: HIGH / MEDIUM / LOW]

### [Competitor 4 Name]

[Narrative. Data confidence: HIGH / MEDIUM / LOW]

---

## Strategic Implications

[Synthesize what the competitive picture means for the client. Structure this as a series of labeled implications, each with a data confidence flag:]

### Implication 1: [Short label]

[What the competitive data suggests for the client's strategy.]

**Data confidence:** HIGH / MEDIUM / LOW — [brief reason]

### Implication 2: [Short label]

[Second implication.]

**Data confidence:** HIGH / MEDIUM / LOW

### Implication 3: [Short label]

[Third implication, if supported by the data.]

**Data confidence:** HIGH / MEDIUM / LOW

---

## Answer to the Strategic Question

[If a strategic question was provided, answer it directly here, referencing the specific competitive evidence that supports the answer. If the data is insufficient to answer definitively, say so and identify what additional information would be needed.]

---

## Data Gaps and Verification Priorities

[List the most important claims in this analysis that have LOW or MEDIUM confidence and require verification before presenting to the client. For each:]

| Claim | Current source | What is needed to verify |
|---|---|---|
| [e.g., Competitor X charges 0.75%] | [Conference conversation, unconfirmed] | [ADV Part 2A or direct inquiry] |

---

*All competitive claims in this document carry data confidence flags. Verify LOW and MEDIUM confidence claims against current primary sources (competitor websites, ADVs, industry reports, direct inquiry) before presenting to the client. Competitor positioning, pricing, and strategy change frequently.*`;

export const CompetitiveLandscapeBuilder: WorkflowTemplate = {
  id: 'consulting-competitive-landscape-builder',
  name: 'Competitive Landscape Builder',
  description: 'Structures a competitive analysis from discovery notes and client-provided data — market position, competitor strengths and weaknesses, and strategic implications. Produces a framework for client discussion.',
  version: '1.0.0',
  category: 'consulting',
  requiresVerification: true,
  verificationNote: 'Verify all competitive claims and market-size figures against current primary sources before presenting to a client. Competitor information changes rapidly.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Competitive Analysis Information',
      description: "Provide the client's business context, competitors, comparison dimensions, and available data",
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-competitive-landscape',
      type: 'generate',
      name: 'Generate Competitive Landscape Analysis',
      description: 'Produce a competitive matrix, per-competitor narratives, and strategic implications with data confidence flags',
      config: {
        outputFile: 'COMPETITIVE_LANDSCAPE.md',
        promptTemplate: competitiveLandscapeBuilderPrompt,
        systemPrompt: "You are a consulting practice assistant helping an experienced consultant structure a competitive landscape analysis. You are rigorous about data confidence — you never present inferred or estimated information as if it were confirmed fact, and you flag every claim with a confidence level. You produce a competitive matrix that is genuinely useful for a client discussion, not a generic template. The strategic implications section identifies what the competitive picture actually means for this specific client's situation, not boilerplate strategy advice. You always surface data gaps explicitly so the consultant knows what to verify before the client meeting.",
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['COMPETITIVE_LANDSCAPE.md'],
  namedOutputs: [
    { id: 'competitive_matrix', name: 'Competitive matrix', schema: 'string' },
    { id: 'competitor_narratives', name: 'Per-competitor narratives', schema: 'array' },
    { id: 'strategic_implications', name: 'Strategic implications', schema: 'array' },
  ],
};

export default CompetitiveLandscapeBuilder;
