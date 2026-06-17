// Consulting Practice Pack v2.3 (shipped). Built with input from practicing consultants.
// Can ship without formal advisor review (no statutory claims).
// Recommend one experienced consultant read-through before production.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientAndEngagement',
    question: 'Client and engagement',
    description: 'Brief description of the client and what this engagement set out to answer.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Meridian Financial Group, $800M AUM wealth management firm. Engagement: evaluate whether to build or buy a digital client portal over the next 18 months.',
  },
  {
    id: 'rawNotes',
    question: 'Raw research notes and interview findings',
    description: 'Paste your raw notes, interview summaries, and research findings. Include verbatim quotes where they are important. Messy is fine.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., CFO (Rachel Torres): "our clients keep asking why they have to call us for a balance." Operations director: "we spend 40 hrs/wk on manual reporting that a portal would automate." Three advisors interviewed — two skeptical of digital, one enthusiastic. Market research: competitor A launched portal Q3 2024, retention unchanged per industry report...',
  },
  {
    id: 'keyDataPoints',
    question: 'Key data points',
    description: 'Specific numbers, figures, or statistics that must appear in the output. List each with its source.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., 40 hrs/wk manual reporting (Operations director estimate). 3 of 12 advisors surveyed said clients asked about portal access in past 6 months. Build cost estimate: $180K–$240K internal estimate. Buy (Orion): $18K/yr.',
  },
  {
    id: 'keyQuestion',
    question: 'The key question this work answers',
    description: 'The central question the client commissioned this engagement to answer.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Should Meridian build or buy a digital client portal, and on what timeline?',
  },
  {
    id: 'recommendation',
    question: 'Your recommendation (the answer)',
    description: 'What is your recommendation? State it directly. The pyramid principle leads with the answer, then the support.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Buy a third-party portal (Orion or equivalent) within 12 months. Building is 10x more expensive and the capabilities are now commoditized. The real investment should be in the change management and advisor adoption, not the technology.',
  },
  {
    id: 'supportingArguments',
    question: 'Supporting arguments',
    description: 'List your main supporting arguments, strongest first. Each should be a distinct reason the recommendation is correct.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 1. Cost: buy is $18K/yr vs. $200K+ to build. 2. Speed: buy deploys in 90 days vs. 12-18 months to build. 3. Risk: operational risk of building and maintaining bespoke software is high for a firm this size. 4. Differentiation: the portal itself is not a differentiator; advisor relationships are.',
  },
  {
    id: 'situation',
    question: 'Situation (context)',
    description: "The background context: what is true about the client's world right now that makes this question relevant.",
    type: 'textarea',
    required: false,
    placeholder: "e.g., Meridian has grown 40% in 3 years and their manual reporting processes haven't scaled. Clients are increasingly digital-native. Competitors have deployed portals.",
  },
  {
    id: 'complication',
    question: 'Complication',
    description: 'What changed or what tension exists that makes the situation no longer acceptable? This is what forced the question.',
    type: 'textarea',
    required: false,
    placeholder: "e.g., Three clients in Q1 2026 asked why they couldn't see their accounts online. Advisor time spent on manual reporting is crowding out client-facing work.",
  },
];

const findingsSynthesizerPrompt = `You are assisting a consultant in applying pyramid-principle structure to synthesize research and interview findings into an executive summary. This document leads with the answer, then provides the structure. Write it for presentation to an executive audience.

Client and engagement: {{clientAndEngagement}}
The key question: {{keyQuestion}}
The recommendation (the answer): {{recommendation}}
Supporting arguments: {{supportingArguments}}
Situation (context): {{situation}}
Complication: {{complication}}
Key data points: {{keyDataPoints}}

Raw research notes and interview findings:
{{rawNotes}}

Produce a pyramid-structure executive summary in Markdown. At the top, include the draft notice.

> **Draft document** — Verify all supporting data points and confirm factual claims against source materials before presenting to a client.

---

# Executive Summary
**DRAFT — Verify data points before client delivery.**

**Client:** [from context]
**Engagement:** [from context]
**Prepared:** [date]

---

## The Answer

> **[State the recommendation directly, in 1–2 sentences. Do not hedge. This is the answer to the key question.]**

---

## Situation

[2–3 sentences describing the context as it stands: what is true about the client's world that makes this question relevant. Draw from the situation input and the notes. This should be factual and grounded, not hypothetical.]

---

## Complication

[2–3 sentences describing what changed or what tension exists that makes the current situation no longer acceptable. This is what forced the question onto the agenda. Be specific — reference actual events or data points where available.]

---

## The Key Question

**[State the key question as a single, precise question. This should be the question the recommendation directly answers.]**

---

## Recommendation

**[Restate the recommendation in 2–4 sentences with enough specificity that an executive can act on it. Include what, by when, and any critical conditions or caveats.]**

---

## Supporting Arguments

[Present supporting arguments from strongest to secondary. Each argument should be a distinct reason the recommendation is correct. Reference data points where provided.]

### 1. [Strongest argument — short label]

[3–5 sentences making the argument. Cite specific data points or evidence where available. Flag any figure with its source in parentheses.]

### 2. [Second argument]

[3–5 sentences.]

### 3. [Third argument, if applicable]

[3–5 sentences.]

### 4. [Fourth argument, if applicable]

[3–5 sentences. Use only as many arguments as the evidence actually supports — do not pad.]

---

## What This Analysis Does Not Resolve

[Be honest about what the research did not answer, where evidence was thin, or what would change the recommendation. A credible executive summary acknowledges its own limits.]

- [Unresolved question or thin evidence area 1]
- [Unresolved question or thin evidence area 2]

---

## Suggested Next Steps

[2–4 concrete, specific next steps that follow from the recommendation. Each step should have a clear owner and a rough timeline signal where possible.]

1. [Step 1]
2. [Step 2]
3. [Step 3]

---

*This executive summary is a draft based on the research notes and interviews provided. Verify all data points against source materials and confirm factual claims before presenting to the client.*`;

export const FindingsSynthesizer: WorkflowTemplate = {
  id: 'consulting-findings-synthesizer',
  name: 'Findings and Recommendations Synthesizer',
  description: 'Applies pyramid-principle structure to synthesize research and interviews into an executive summary — situation, complication, key question, answer-first recommendation, and supporting arguments.',
  version: '1.0.0',
  category: 'consulting',
  requiresVerification: true,
  verificationNote: 'Verify all supporting data points and confirm factual claims against source materials before presenting to a client.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Findings and Recommendation Information',
      description: 'Provide your raw research notes, the key question, your recommendation, and supporting arguments',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-findings-summary',
      type: 'generate',
      name: 'Generate Findings and Recommendations Executive Summary',
      description: 'Produce an answer-first executive summary with situation, complication, recommendation, and supporting arguments',
      config: {
        outputFile: 'FINDINGS_EXECUTIVE_SUMMARY.md',
        promptTemplate: findingsSynthesizerPrompt,
        systemPrompt: 'You are a consulting practice assistant helping an experienced consultant structure a pyramid-principle executive summary. You apply the pyramid principle faithfully: the answer comes first, every supporting argument is a distinct reason the answer is correct, and the structure flows from situation to complication to question to answer. You write in a direct, professional tone suitable for an executive audience — no filler, no hedging that is not warranted by the evidence. You are honest about what the research does not resolve. You always flag data points with their sources and note where claims require verification before client delivery.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['FINDINGS_EXECUTIVE_SUMMARY.md'],
  namedOutputs: [
    { id: 'recommendation', name: 'Answer-first recommendation', schema: 'string' },
    { id: 'supporting_arguments', name: 'Supporting arguments', schema: 'array' },
    { id: 'situation_complication', name: 'Situation and complication', schema: 'string' },
  ],
};

export default FindingsSynthesizer;
