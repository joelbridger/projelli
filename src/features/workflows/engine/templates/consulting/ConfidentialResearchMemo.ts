// Consulting Practice Pack v2.3 (shipped). Built with input from practicing consultants.
// Can ship without formal advisor review (no statutory claims).
// Recommend one experienced consultant read-through before production.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Name of the client this research was conducted for.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Cascadia Health Partners',
  },
  {
    id: 'researchQuestion',
    question: 'Research question',
    description: 'The specific question this research addresses.',
    type: 'text',
    required: true,
    placeholder: 'e.g., What are the primary operational drivers of patient readmission rates at rural critical access hospitals?',
  },
  {
    id: 'confidentialityLevel',
    question: 'Confidentiality level',
    description: 'How this document may be used and shared.',
    type: 'select',
    required: true,
    options: ['Internal use only', 'Client-shareable', 'Publishable with redactions'],
    defaultValue: 'Client-shareable',
  },
  {
    id: 'researchConducted',
    question: 'Research conducted and sources consulted',
    description: 'Describe the research you did and what sources you drew on.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Reviewed 12 peer-reviewed studies from 2018–2025, analyzed CMS data, interviewed 3 hospital administrators, reviewed HRSA reports',
  },
  {
    id: 'keyFindings',
    question: 'Key findings',
    description: 'The most important things you learned from the research.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Staffing continuity was the strongest predictor of readmission rates in 8 of 12 studies reviewed...',
  },
  {
    id: 'supportingData',
    question: 'Data or evidence supporting findings',
    description: 'Specific data points, statistics, quotes, or examples that substantiate the findings.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., CMS data shows rural CAHs with high agency staff turnover had 23% higher 30-day readmission rates vs. those with stable staffing (2022 data)',
  },
  {
    id: 'contradictoryEvidence',
    question: 'Contradictory evidence or limitations (optional)',
    description: 'Findings that complicate the picture, studies that found different results, or limitations of the research.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Two studies found no significant correlation between staffing stability and readmissions in facilities under 25 beds — the relationship may not hold at very small facilities',
  },
  {
    id: 'recommendedActions',
    question: 'Recommended actions',
    description: 'What you think the client should do based on this research.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 1. Prioritize reducing agency staff reliance in the two highest-readmission facilities. 2. Implement the AHRQ discharge follow-up protocol...',
  },
];

const confidentialResearchMemoPrompt = `You are assisting a consultant in structuring research output for client delivery. The confidentiality level determines the header treatment and how the document is framed.

Client name: {{clientName}}
Research question: {{researchQuestion}}
Confidentiality level: {{confidentialityLevel}}
Research conducted and sources: {{researchConducted}}
Key findings: {{keyFindings}}
Supporting data and evidence: {{supportingData}}
Contradictory evidence or limitations: {{contradictoryEvidence}}
Recommended actions: {{recommendedActions}}

Produce a formatted research memo in Markdown. At the top, include the draft notice.

> **Draft document** — Review and edit before delivery.

---

[Apply the appropriate confidentiality header based on the selected level:
- "Internal use only": Include a prominent CONFIDENTIAL — INTERNAL USE ONLY header; note this document is not for client distribution
- "Client-shareable": Include a CONFIDENTIAL header; frame as prepared for client review
- "Publishable with redactions": Include a note that sensitive identifiers should be reviewed and redacted before any publication]

# Research Memorandum

**Client:** {{clientName}}
**Research question:** {{researchQuestion}}
**Confidentiality:** {{confidentialityLevel}}
**Date:** [Date]
**Prepared by:** [Consultant name]

---

## Research Question

[Restate the research question clearly and precisely. If the question implies a decision the client is trying to make, state what that decision is.]

---

## Methodology and Sources

[Describe what research was done and what sources were consulted. Be specific about the nature and vintage of sources. Note the scope and any boundaries — e.g., geographic, time period, industry segment. This section establishes the credibility and limitations of the findings.]

---

## Key Findings

[Present findings as numbered or bulleted statements, each supported by evidence. Each finding should stand alone as a clear, declarative statement — not a hedged observation. Lead with the most important finding.]

### Finding 1: [Title]
[Statement of finding]
**Evidence:** [The specific data, quotes, or examples that support this finding]

### Finding 2: [Title]
[Statement of finding]
**Evidence:** [Supporting evidence]

[Continue for all key findings]

---

## Limitations and Caveats

[Address the contradictory evidence or limitations provided. Be direct — a well-written limitations section builds credibility, not doubt. If contradictory evidence suggests the findings may not hold in specific circumstances, say so.]

---

## Recommended Actions

[Present recommendations in priority order. Each recommendation should be specific and actionable — not a general direction but a concrete next step.]

1. **[Recommendation 1]:** [Specific action, rationale, and expected outcome]
2. **[Recommendation 2]:** [Specific action, rationale, and expected outcome]
[Continue as needed]

---

## Sources

[List all sources referenced in the memo, organized by type:
- Academic and peer-reviewed
- Government and regulatory
- Industry reports
- Primary research (interviews, surveys)
- Other]

---

*This memorandum reflects research and analysis as of the date prepared. Conclusions are based on the sources listed and are subject to revision as new information becomes available.*`;

export const ConfidentialResearchMemo: WorkflowTemplate = {
  id: 'consulting-confidential-research-memo',
  name: 'Confidential Research Memo',
  description: 'Structures research output for client delivery with a confidentiality header matching the selected level, Research Question, Methodology, Key Findings with evidence, Limitations, Recommended Actions, and Sources.',
  version: '1.0.0',
  category: 'consulting',
  requiresVerification: true,
  verificationNote: 'Verify all cited sources, statistics, and market-size figures against primary sources before presenting to a client.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Research Details',
      description: 'Provide the research question, findings, evidence, and recommendations',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-research-memo',
      type: 'generate',
      name: 'Generate Research Memo',
      description: 'Structure research output as a formatted deliverable with appropriate confidentiality treatment',
      config: {
        outputFile: 'RESEARCH_MEMO.md',
        promptTemplate: confidentialResearchMemoPrompt,
        systemPrompt: 'You are a consulting practice assistant helping an experienced consultant structure research output for client delivery. You write findings as clear, declarative statements supported by specific evidence — not hedged generalities. You take limitations seriously and present them honestly. You apply the correct confidentiality treatment based on the selected level. Recommendations are specific and actionable, not directional platitudes.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['RESEARCH_MEMO.md'],
  namedOutputs: [
    { id: 'key_findings', name: 'Key findings', schema: 'array' },
    { id: 'recommendations', name: 'Recommended actions', schema: 'array' },
  ],
};

export default ConfidentialResearchMemo;
