// Advisor Practice Pack v1.0 (shipped). Built with input from practicing advisors.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full name of the client you are meeting with.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Sandra Kovacs',
  },
  {
    id: 'meetingType',
    question: 'Meeting type',
    description: 'What kind of meeting is this? Sets the tone and focus of the prep document.',
    type: 'select',
    required: true,
    options: [
      'Annual review',
      'New financial plan',
      'Ad hoc / as-needed',
      'Portfolio rebalancing review',
      'Estate / beneficiary review',
      'Tax planning review',
    ],
    defaultValue: 'Annual review',
  },
  {
    id: 'meetingDate',
    question: 'Meeting date',
    description: 'Date of the upcoming meeting.',
    type: 'text',
    required: true,
    placeholder: 'e.g., June 10, 2026',
  },
  {
    id: 'keyClientFacts',
    question: 'Key client facts',
    description: 'Paste your notes on the client\'s situation, age, family, employment, major assets, key obligations, any known health or life events. Rough notes are fine.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Age 54, married, two adult children. CFO at a mid-size company, high income. Primary residence paid off. Has a company NQSO grant vesting over next 3 years. Significant concentration in employer stock. Husband age 57, recently retired. Interested in tax-efficient withdrawal strategy.',
  },
  {
    id: 'lastMeetingDate',
    question: 'Last meeting date',
    description: 'When was the last time you met with this client?',
    type: 'text',
    required: true,
    placeholder: 'e.g., December 2025',
  },
  {
    id: 'lastMeetingTopics',
    question: 'Last meeting main topics',
    description: 'What were the key topics or decisions from the last meeting? Used to produce a concise last-meeting summary in the briefing.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Reviewed asset allocation, discussed husband\'s retirement income plan, deferred NQSO exercise decision pending tax estimate. Client requested a Roth conversion analysis.',
  },
  {
    id: 'currentConcerns',
    question: 'Current concerns or recent life events',
    description: 'Any new concerns, life changes, or events since the last meeting that should inform this meeting\'s agenda.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Client emailed in March asking about market volatility impact on the portfolio. Husband started Medicare enrollment. Daughter getting married, possible gifting question.',
  },
];

const meetingPrepPrompt = `You are assisting a financial advisor in preparing for an upcoming client meeting. You are not providing financial advice, you are helping the advisor organize their knowledge of the client's situation into a structured pre-meeting briefing, suitability checklist stub, and talking points.

Client name: {{clientName}}
Meeting type: {{meetingType}}
Meeting date: {{meetingDate}}
Key client facts: {{keyClientFacts}}
Last meeting date: {{lastMeetingDate}}
Last meeting main topics: {{lastMeetingTopics}}
Current concerns or life events: {{currentConcerns}}

Produce a structured pre-meeting prep document in Markdown. At the top, include the draft notice.

> **Advisor working document**, Internal use only. Review before the meeting.

---

# Meeting Prep: {{clientName}}
**Meeting type:** {{meetingType}}
**Date:** {{meetingDate}}
**Prepared:** [today]

---

## Pre-Meeting Briefing

### Client Snapshot
[Synthesize the key client facts into a concise narrative paragraph the advisor can re-read 10 minutes before the meeting. Write in third person. Highlight the 3–5 most financially significant facts, the ones most relevant to this meeting type.]

### Last Meeting Recap
**Last meeting:** {{lastMeetingDate}}

[2–4 bullet points summarizing the main topics and any action items or decisions from the last meeting that may have follow-up implications at this meeting.]

### Current Concerns and Life Events
[If current concerns or life events were provided, summarize them clearly and flag how each might affect the meeting agenda. If none were provided, note that no new events were flagged, but remind the advisor to ask at the start of the meeting.]

---

## Suitability Checklist Stub

> This checklist is a starting point for the advisor's suitability review conversation. It is not a substitute for your firm's required suitability documentation. Complete and file documentation per your compliance procedures.

| Suitability Factor | Last Known | Check at This Meeting? |
|---|---|---|
| Risk tolerance | [Note if known, or "confirm"] | Yes / No |
| Investment objectives | [Note if known, or "confirm"] | Yes / No |
| Time horizon | [Note if known, or "confirm"] | Yes / No |
| Liquidity needs | [Note if known, or "confirm"] | Yes / No |
| Tax situation changes | [Note if known, or "confirm"] | Yes / No |
| Employment / income changes | [Note if known, or "confirm"] | Yes / No |
| Family / beneficiary changes | [Note if known, or "confirm"] | Yes / No |
| Health or long-term care considerations | [Note if known, or "confirm"] | Yes / No |

*Fill in "Last Known" based on client records. Mark "Check at This Meeting?" Yes for any factor that may have changed since the last review, or that is specifically relevant to the meeting type.*

---

## Suggested Talking Points

[Based on the meeting type, client facts, last meeting recap, and current concerns, list 4–7 suggested talking points for this meeting, in the order you might naturally cover them. Each talking point should be one sentence framing the topic as a question or agenda item. Do not include specific investment recommendations. Flag any topic that may require documentation or follow-up compliance action.]

1. [Talking point 1]
2. [Talking point 2]
3. [Talking point 3]
4. [Talking point 4]
5. [Talking point 5, if warranted]
6. [Talking point 6, if warranted]

---

*This output is a draft for the advisor's review. It is not financial advice and does not substitute for your professional judgment or compliance review. Verify all client facts against your CRM and account records before the meeting.*`;

export const MeetingPrepAndSuitabilityNotes: WorkflowTemplate = {
  id: 'advisors-meeting-prep-suitability-notes',
  name: 'Meeting Prep & Suitability Notes',
  description: 'Generates a complete pre-meeting briefing package: a client snapshot, last-meeting recap, current concerns summary, suitability checklist stub, and suggested talking points, all in one advisor working document.',
  version: '1.0.0',
  category: 'advisors',
  requiresVerification: true,
  verificationNote: 'Suitability determinations are advisor judgments. This output is a conversation framework, not a suitability analysis. Review every item before the client meeting.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Client & Meeting Information',
      description: 'Provide client facts, last meeting summary, and any current concerns or life events',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-meeting-prep',
      type: 'generate',
      name: 'Generate Meeting Prep Document',
      description: 'Draft the pre-meeting briefing, suitability checklist stub, and talking points',
      config: {
        outputFile: 'MEETING_PREP.md',
        promptTemplate: meetingPrepPrompt,
        systemPrompt: 'You are a financial advisory practice management assistant helping a licensed financial advisor prepare for a client meeting. You synthesize notes about the client\'s situation into a clear, actionable pre-meeting briefing. You are careful to frame suitability checklist items as starters for the advisor\'s conversation, never as completed documentation. You never make specific investment recommendations; instead you help the advisor frame the right questions to ask. You always remind the advisor to verify facts against their CRM records before the meeting.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['MEETING_PREP.md'],
  namedOutputs: [
    { id: 'client_snapshot', name: 'Client snapshot', schema: 'string' },
    { id: 'suitability_checklist', name: 'Suitability checklist stub', schema: 'array' },
    { id: 'talking_points', name: 'Suggested talking points', schema: 'array' },
  ],
};

export default MeetingPrepAndSuitabilityNotes;
