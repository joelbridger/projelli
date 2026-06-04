// @draft — Legal Practice Pack v2.1
// Requires attorney review before shipping. Do not expose to users without review.

// NOTE: `category: 'legal'` requires adding 'legal' to the WorkflowTemplate category
// union in src/types/workflow.ts before this template is registered.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'matterName',
    question: 'Matter name',
    description: 'The case or matter name as you track it in your files.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Smith v. Acme Corp.',
  },
  {
    id: 'witnessName',
    question: 'Witness name',
    description: 'Full name of the deponent whose transcript you are analyzing.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Jane Doe',
  },
  {
    id: 'depositionDate',
    question: 'Deposition date',
    description: 'Date the deposition was taken. Used for citation purposes in the output.',
    type: 'text',
    required: true,
    placeholder: 'e.g., May 15, 2026',
  },
  {
    id: 'keyClaimsToScrutinize',
    question: 'Key claims to scrutinize',
    description: 'The specific factual assertions or storyline elements you want to test for consistency. Be specific — the more targeted this list, the more useful the output.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Witness claims she never received the email. Witness claims the meeting on March 3 never happened. Witness claims she had no supervisory role over the plaintiff.',
  },
  {
    id: 'depositionExcerpts',
    question: 'Deposition transcript excerpts',
    description: 'Paste the relevant portions of the deposition transcript. Include page and line numbers (e.g., "P. 42:3-18") for each excerpt — the analysis will reference them. You can paste multiple excerpts; separate them with a blank line.',
    type: 'textarea',
    required: true,
    placeholder: 'P. 42:3-18\nQ: Did you receive the email?\nA: No, I never received anything from him.\n\nP. 87:9-21\nQ: How often did you communicate with the plaintiff?\nA: Rarely. Maybe once or twice a quarter.',
  },
  {
    id: 'priorStatements',
    question: 'Prior statements to compare against (optional)',
    description: 'Paste excerpts from earlier sworn statements, affidavits, interrogatory answers, or prior deposition testimony. If none, leave blank. Including these allows the analysis to flag contradictions between this deposition and earlier statements.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Affidavit dated January 10, 2026: "I received the email from Mr. Johnson and forwarded it to my supervisor immediately."',
  },
];

const contradictionFinderPrompt = `You are assisting a licensed attorney in analyzing a deposition transcript for internal inconsistencies and contradictions. You are not providing legal advice — you are helping the attorney organize the record for their own review and judgment.

Matter: {{matterName}}
Witness: {{witnessName}}
Deposition date: {{depositionDate}}

Key claims to scrutinize:
{{keyClaimsToScrutinize}}

Deposition transcript excerpts:
{{depositionExcerpts}}

Prior statements to compare against:
{{priorStatements}}

Produce a Markdown analysis document structured as follows. At the top, include the draft notice. Then:

1. For each contradiction or inconsistency found, create a numbered entry under the relevant topic heading.
2. Each entry must include:
   - The specific quote(s) from the transcript (with page/line reference if provided)
   - The conflicting statement (from another part of the transcript or from the prior statements)
   - A brief plain-language description of why these are inconsistent
   - Suggested follow-up deposition questions the attorney might consider
3. Organize findings by topic, not by page order.
4. If no meaningful inconsistencies are found for a topic, say so explicitly — do not invent contradictions.
5. End with a "Themes to Watch" section: 2–4 observations about credibility patterns or areas where additional record development may be warranted.

Format:

> **Draft document** — Review and edit before use in any matter.

# Deposition Contradiction Analysis
**Matter:** {{matterName}}
**Witness:** {{witnessName}}
**Deposition date:** {{depositionDate}}
**Prepared for attorney review:** [date]

---

## Summary
[2–3 sentence overview of what was found]

---

## Findings by Topic

### [Topic 1]
**Contradiction 1:**
- Transcript statement: "[quote]" (p. __:__)
- Conflicting statement: "[quote]" (source)
- Why this is inconsistent: [explanation]
- Suggested follow-up questions:
  - [Question 1]
  - [Question 2]

[Continue for each finding]

---

## Themes to Watch
- [Observation 1]
- [Observation 2]

---

*This analysis is a starting point for your review. Verify all page/line references against the actual transcript. Do not use this document in any filing without independent verification.*`;

export const DepositionContradictionFinder: WorkflowTemplate = {
  id: 'legal-deposition-contradiction-finder',
  name: 'Deposition Contradiction Finder',
  description: 'Analyze deposition transcript excerpts for internal inconsistencies, contradictions with prior testimony, and flagged line/page references. Produces a topic-organized analysis with suggested follow-up questions.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Verify every flagged contradiction against the original transcript before use. AI can misread nuance, context, or page breaks.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Deposition Details',
      description: 'Provide the transcript excerpts and the key claims you want scrutinized',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-analysis',
      type: 'generate',
      name: 'Generate Contradiction Analysis',
      description: 'Analyze the transcript for inconsistencies and contradictions',
      config: {
        outputFile: 'DEPOSITION_CONTRADICTION_ANALYSIS.md',
        promptTemplate: contradictionFinderPrompt,
        systemPrompt: 'You are a legal research assistant helping a licensed attorney organize and analyze deposition testimony. You are methodical, precise, and citation-focused. You never provide legal advice and always frame your output as a starting point for the attorney\'s review. You do not speculate beyond what the record supports. If the transcript is ambiguous, you note the ambiguity rather than resolve it.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['DEPOSITION_CONTRADICTION_ANALYSIS.md'],
  namedOutputs: [
    { id: 'contradictions', name: 'Contradiction findings', schema: 'array' },
    { id: 'followup_questions', name: 'Suggested follow-up questions', schema: 'array' },
  ],
};

export default DepositionContradictionFinder;
