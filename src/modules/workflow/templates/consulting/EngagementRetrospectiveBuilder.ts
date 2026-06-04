// @draft — Consulting Practice Pack v2.3
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
    id: 'engagementName',
    question: 'Engagement name',
    description: 'The name or code for this engagement.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Pricing Model Redesign, FY2026 Strategic Planning, M&A Integration',
  },
  {
    id: 'engagementDuration',
    question: 'Engagement duration',
    description: 'How long the engagement ran (e.g., 8 weeks, 3 months, 6 months).',
    type: 'text',
    required: true,
    placeholder: 'e.g., 12 weeks, May 2026 - July 2026',
  },
  {
    id: 'whatWentWell',
    question: 'What went well',
    description: 'The things that worked, went smoothly, or exceeded expectations.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Strong sponsor support throughout. Client team was responsive and data-rich. The interim findings presentation landed well and built momentum.',
  },
  {
    id: 'whatWasHarder',
    question: 'What was harder than expected',
    description: 'Challenges, delays, surprises, or things that took more effort or time than anticipated.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Getting buy-in from Operations on the new process model took longer than expected. Data quality issues in the legacy system slowed analysis. Board had more questions than anticipated.',
  },
  {
    id: 'deliverables',
    question: 'Deliverables produced',
    description: 'What you delivered. List key outputs.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Final recommendation document, implementation roadmap, process flows, training materials, financial model',
  },
  {
    id: 'clientFeedback',
    question: 'Key client feedback (optional)',
    description: 'Feedback you received from the client. Direct quotes or themes.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., "This is exactly the analysis we needed but were not equipped to do." "The roadmap gives us confidence." "The timeline is aggressive."',
  },
  {
    id: 'wouldRepeat',
    question: 'Would you take a similar engagement again?',
    description: 'Your assessment of whether this type of work is a good fit.',
    type: 'select',
    required: true,
    options: ['Yes', 'No', 'Maybe'],
    defaultValue: 'Maybe',
  },
];

const engagementRetrospectivePrompt = `You are assisting a consultant in conducting a post-engagement retrospective. This is an internal reflection document to capture what was learned and what to do differently next time.

Client organization: {{clientOrganizationName}}
Engagement name: {{engagementName}}
Engagement duration: {{engagementDuration}}
What went well: {{whatWentWell}}
What was harder than expected: {{whatWasHarder}}
Deliverables produced: {{deliverables}}
Client feedback: {{clientFeedback}}
Would take a similar engagement again: {{wouldRepeat}}

Produce a structured engagement retrospective in Markdown. At the top, include the draft notice.

> **Draft document** - Review and edit before storing.

---

# Engagement Retrospective

**Client:** {{clientOrganizationName}}
**Engagement:** {{engagementName}}
**Duration:** {{engagementDuration}}
**Date prepared:** [Date]

---

## Engagement Summary

[1-2 sentences capturing what the engagement was, what the client needed, and what you delivered.]

---

## What Worked

[Narrative summary of what went well. Include:]
- Relationships and sponsor dynamics
- Client team capability and responsiveness
- Quality of available data and resources
- Momentum and decision-making speed
- Any early wins or moments when the engagement felt on-track

---

## What to Do Differently

[Things that were harder than expected, surprises, or operational friction. For each one, note a specific change to make next time.]

| Challenge | What We Learned | Do This Next Time |
|-----------|-----------------|-------------------|
| [Challenge 1] | [Root cause or insight] | [Specific change] |
| [Challenge 2] | [Root cause or insight] | [Specific change] |

---

## Deliverables

[List what you produced and shipped.]

- [Deliverable 1]
- [Deliverable 2]
- [Deliverable 3 etc.]

---

## Client Feedback

[Capture the feedback you received - direct quotes if possible, or themes.]

[If no formal feedback was collected, note that and suggest how to gather it next time.]

---

## Net Assessment

[Your honest read on whether this was a good engagement.]

- **Would you take a similar engagement again?** {{wouldRepeat}}
- **Why?** [1-2 sentences explaining your answer]
- **What client type or situation would be ideal for this kind of work?** [Your updated ICP based on this engagement]
- **What type of situation would you avoid?** [Red flags you discovered]

---

## Templates or Processes Worth Saving

[If you developed any reusable templates, checklists, analysis frameworks, or processes during this engagement, document them here so you can use them again.]

- [Template/process 1 - brief description and where it lives]
- [Template/process 2]

---

*This retrospective is for your learning and your firm's operational memory. Share selectively with team members who may encounter similar engagements.*`;

export const EngagementRetrospectiveBuilder: WorkflowTemplate = {
  id: 'consulting-engagement-retro',
  name: 'Engagement Retrospective Builder',
  description: 'Post-engagement retrospective capturing what went well, what was harder than expected, deliverables, client feedback, and whether to pursue similar work in future.',
  version: '1.0.0',
  category: 'consulting',
  requiresVerification: true,
  verificationNote: 'Review all retrospective findings for accuracy before sharing with the client.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Engagement Reflection',
      description: 'Reflect on what went well, what was hard, and what you learned',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-retrospective',
      type: 'generate',
      name: 'Generate Engagement Retrospective',
      description: 'Build a structured retrospective with learning capture and process documentation',
      config: {
        outputFile: '{{clientOrganizationName}}-{{engagementName}}-retro.md',
        promptTemplate: engagementRetrospectivePrompt,
        systemPrompt: 'You are a consulting practice assistant helping an experienced consultant reflect on a completed engagement. You are honest and specific about what was hard and why. You extract actionable learnings - not complaints but concrete changes to make next time. You help the consultant update their ICP and identify red flags. You capture templates and processes worth reusing.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['{{clientOrganizationName}}-{{engagementName}}-retro.md'],
  namedOutputs: [
    { id: 'what_worked', name: 'What worked', schema: 'string' },
    { id: 'what_to_change', name: 'What to do differently', schema: 'array' },
    { id: 'net_assessment', name: 'Net assessment and ICP', schema: 'string' },
  ],
};

export default EngagementRetrospectiveBuilder;
