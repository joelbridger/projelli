// Consulting Practice Pack v2.3 (shipped). Built with input from practicing consultants.
// Can ship without formal advisor review (no statutory claims).
// Recommend one experienced consultant read-through before production.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientOrganizationName',
    question: 'Client organization name',
    description: 'Name of the client organization.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Meridian Financial Group',
  },
  {
    id: 'engagementType',
    question: 'Engagement type',
    description: 'The broad category of work this engagement covers.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Strategy, Org design, M&A diligence, Marketing',
  },
  {
    id: 'primaryDecisionMaker',
    question: 'Primary decision-maker / sponsor',
    description: 'The person who commissioned or will approve the work.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Rachel Torres, CFO',
  },
  {
    id: 'discoveryCallDates',
    question: 'Discovery call date(s)',
    description: 'When the discovery call or calls took place.',
    type: 'text',
    required: true,
    placeholder: 'e.g., May 14 and May 21, 2026',
  },
  {
    id: 'rawNotes',
    question: 'Raw notes from discovery call',
    description: 'Paste your notes directly. Messy is fine — bullet points, shorthand, half-sentences. The more detail you provide, the more useful the output.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Rachel opened by saying their last strategic planning cycle produced a plan nobody could remember six months later. Their team has grown from 40 to 110 people in 18 months...',
  },
  {
    id: 'openQuestions',
    question: 'Open questions not yet answered (optional)',
    description: 'Things you still need to learn about the client or situation.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Who else needs to be in the room for approval? What happened with their last strategic initiative?',
  },
  {
    id: 'initialHypothesis',
    question: 'Initial hypothesis about the core problem (optional)',
    description: 'Your gut read after the call about what is really going on.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., The stated problem is strategy, but this sounds like an alignment and communications problem — the strategy may be fine',
  },
];

const clientDiscoverySynthesizerPrompt = `You are assisting a consultant in turning discovery call notes into a structured client brief. This is an internal working document — write it for the consultant's use, not for client delivery.

Client organization: {{clientOrganizationName}}
Engagement type: {{engagementType}}
Primary decision-maker / sponsor: {{primaryDecisionMaker}}
Discovery call date(s): {{discoveryCallDates}}
Open questions: {{openQuestions}}
Initial hypothesis: {{initialHypothesis}}

Raw discovery notes:
{{rawNotes}}

Produce a structured client brief in Markdown. At the top, include the draft notice.

> **Draft document** — Review and edit before delivery.

---

# Client Discovery Brief
**INTERNAL — NOT FOR CLIENT DISTRIBUTION**

**Client:** {{clientOrganizationName}}
**Engagement type:** {{engagementType}}
**Sponsor:** {{primaryDecisionMaker}}
**Discovery call(s):** {{discoveryCallDates}}
**Prepared:** [date]

---

## Executive Summary

[2–3 sentences capturing the essence of the client's situation, what they want, and the apparent core problem. This should be sharp enough that someone who hasn't read the notes can orient quickly.]

---

## Situation as Understood

[A clear narrative of the client's current situation — context, history, what prompted this engagement, what has already been tried. Write this as a coherent account, not a transcript. Flag anything that seems uncertain or that the notes contradict themselves on.]

---

## Key Stakeholders and Stated Priorities

| Stakeholder | Role | Stated Priority | Notes |
|-------------|------|----------------|-------|
| [Name] | [Role] | [What they said they want] | [Any subtext or qualification] |

[Include the sponsor and any others mentioned. Note where stakeholder priorities appear to diverge.]

---

## Core Problem Statement

[Synthesize the raw notes into a single, precise problem statement. Use the consultant's initial hypothesis if provided — test it against the notes. Format: "The core problem appears to be [X], manifesting as [observable symptoms]. The underlying cause may be [Y]."]

[If the stated problem and the apparent real problem differ, say so explicitly here.]

---

## Constraints and Boundaries

[Things the client said they cannot or will not do, budget signals, timeline constraints, political limits, what is off the table. Be direct — these are real boundaries the engagement must work within.]

---

## Open Questions

[Organize by who needs to answer them:]

### Questions for the Client
- [Question — e.g., "What happened to the last strategic initiative?"]

### Questions to Research Independently
- [Question — e.g., "What is the competitive dynamic driving their pricing pressure?"]

### Questions to Clarify Before Scoping
- [Question — e.g., "Who else has approval authority beyond Rachel?"]

---

## Suggested Scope Options

[Present 2–3 framing options, from narrow to broad:]

### Option 1: [Narrow — e.g., "Diagnostic only"]
[What this covers, what it produces, what it does not include, rough timeline signal]

### Option 2: [Mid-range — e.g., "Diagnostic + Recommendations"]
[What this covers, what it produces, what it does not include, rough timeline signal]

### Option 3: [Full — e.g., "Full engagement through implementation support"]
[What this covers, what it produces, what it does not include, rough timeline signal]

---

*This brief is based on discovery call notes and may not reflect the full client situation. Verify key facts before committing to a scope.*`;

export const ClientDiscoverySynthesizer: WorkflowTemplate = {
  id: 'consulting-client-discovery-synthesizer',
  name: 'Client Discovery Synthesizer',
  description: 'Turns raw discovery call notes into a structured client brief with Executive Summary, Situation as Understood, Stakeholder Map, Core Problem Statement, Constraints, Open Questions organized by who answers them, and 2–3 suggested scope options.',
  version: '1.0.0',
  category: 'consulting',
  requiresVerification: true,
  verificationNote: 'Verify all themes and quotes against the original interview notes before presenting to a client.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Discovery Call Information',
      description: 'Paste your raw discovery notes and provide basic engagement context',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-discovery-brief',
      type: 'generate',
      name: 'Generate Client Discovery Brief',
      description: 'Synthesize raw notes into a structured brief with problem statement and scope options',
      config: {
        outputFile: 'CLIENT_DISCOVERY_BRIEF.md',
        promptTemplate: clientDiscoverySynthesizerPrompt,
        systemPrompt: 'You are a consulting practice assistant helping an experienced consultant synthesize discovery call notes into a structured brief. You distinguish between what the client said and what you infer from what they said. You are honest when the stated problem and the apparent real problem diverge. You write for a consultant who knows the client better than you do — your job is to organize the thinking, not to resolve it. You produce scope options that are genuinely different in ambition and commitment, not just word counts.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['CLIENT_DISCOVERY_BRIEF.md'],
  namedOutputs: [
    { id: 'problem_statement', name: 'Core problem statement', schema: 'string' },
    { id: 'scope_options', name: 'Suggested scope options', schema: 'array' },
    { id: 'open_questions', name: 'Open questions', schema: 'array' },
  ],
};

export default ClientDiscoverySynthesizer;
