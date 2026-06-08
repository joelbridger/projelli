// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

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
    placeholder: 'e.g., Garcia v. Meridian Properties LLC',
  },
  {
    id: 'caseType',
    question: 'Case type',
    description: 'The general nature of the matter — helps determine what phases and deadlines to flag.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Commercial lease dispute, Personal injury, Employment discrimination',
  },
  {
    id: 'keyEvents',
    question: 'Key events (one per line with approximate date)',
    description: 'Paste the key events, one per line. Include an approximate date for each — exact dates preferred but "approximately March 2025" works. Put the date first, then the event. The AI will sort and organize them. Include both substantive events and procedural ones.',
    type: 'textarea',
    required: true,
    placeholder: 'January 15, 2024 — Plaintiff signs commercial lease with defendant\nMarch 2024 — Plaintiff reports HVAC failure to defendant in writing\nApril 3, 2024 — Defendant responds, denies responsibility\nJuly 1, 2024 — Plaintiff\'s business forced to close temporarily due to conditions\nAugust 15, 2024 — Plaintiff sends demand letter\nSeptember 30, 2024 — Complaint filed\nNovember 5, 2024 — Defendant answers',
  },
  {
    id: 'partiesInvolved',
    question: 'Parties involved',
    description: 'List all parties and their roles — plaintiffs, defendants, third parties, key witnesses, relevant entities.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Plaintiff: Maria Garcia (tenant/business owner)\nDefendant: Meridian Properties LLC (landlord)\nKey witness: Tom Park, building manager\nThird party: HVAC contractors (identity TBD)',
  },
  {
    id: 'jurisdiction',
    question: 'Jurisdiction and court',
    description: 'Court and jurisdiction. Used to flag applicable statutes of limitations and procedural deadlines.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Superior Court of California, Los Angeles County',
  },
  {
    id: 'trialDate',
    question: 'Trial date (if known)',
    description: 'If a trial date or pretrial conference has been set, enter it here. Leave blank if not yet scheduled.',
    type: 'text',
    required: false,
    placeholder: 'e.g., September 22, 2026',
  },
];

const caseTimelinePrompt = `You are assisting a licensed attorney in building a working case timeline. You are not providing legal advice — you are helping the attorney organize the factual and procedural record for their own review.

Matter: {{matterName}}
Case type: {{caseType}}
Parties: {{partiesInvolved}}
Jurisdiction: {{jurisdiction}}
Trial date: {{trialDate}}

Key events (raw input):
{{keyEvents}}

Produce a formatted Markdown case timeline structured as follows:

> **Draft document** — Review and edit before use in any matter.

# Case Timeline: {{matterName}}
**Case type:** {{caseType}}
**Jurisdiction:** {{jurisdiction}}
**Trial date:** {{trialDate}}
**Prepared for attorney review:** [date]

---

## Parties Quick Reference
| Role | Name / Entity |
|------|--------------|
[List parties from input]

---

## Chronological Timeline

Sort all events chronologically. Organize them into phases based on the case type. Typical phases for a civil litigation matter:
- **Pre-incident period** (background facts)
- **Incident / core facts** (the events giving rise to the claim)
- **Post-incident / pre-litigation** (demand letters, negotiations, notices)
- **Litigation** (filing, service, motions, discovery, trial prep)

For each event, format as:

**[Date]** — [Event description]
> *Parties involved:* [relevant parties]
> *Significance:* [brief note on why this event matters legally or factually — one sentence]
> *Source/document:* [if inferable from context, note what document might evidence this]

Flag with ⚠️ any event that may have statute of limitations implications, missed deadlines, or procedural consequence.

---

## Statute of Limitations Notes
Based on the case type and jurisdiction provided, note any limitations periods the attorney should verify — including when they may have begun to run and when they expire.

*Important: These are starting points for your research, not legal conclusions. Verify all limitations periods against current law for this jurisdiction.*

---

## Upcoming Procedural Deadlines
If a trial date is provided, work backward to flag common pretrial deadlines the attorney should track (expert disclosures, discovery cutoff, dispositive motion deadline, pretrial conference). Note these as approximate — the attorney must verify against the actual scheduling order.

---

## Open Questions
List factual gaps or events that appear to be missing from the timeline based on the case type — things that likely happened but were not mentioned.

---

*This timeline is a working draft. Verify all dates against source documents before relying on it in any filing or strategy discussion.*`;

export const CaseTimelineBuilder: WorkflowTemplate = {
  id: 'legal-case-timeline-builder',
  name: 'Case Timeline Builder',
  description: 'Build a chronological case timeline from events the attorney provides, organized into phases (pre-incident, incident, post-incident, litigation), with statute of limitations flags and procedural deadline notes.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Verify every deadline against applicable court rules and confirm SOL calculations independently before docketing.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Case Events and Parties',
      description: 'Enter the key events and parties — the AI will sort and structure them into a timeline',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-timeline',
      type: 'generate',
      name: 'Generate Case Timeline',
      description: 'Build a structured chronological timeline organized by phase',
      config: {
        outputFile: 'CASE_TIMELINE.md',
        promptTemplate: caseTimelinePrompt,
        systemPrompt: 'You are a legal research assistant helping a licensed attorney build a working case timeline. You are precise with dates, careful about what you flag as legally significant, and explicit about what requires verification. You never provide legal advice. When statute of limitations or procedural deadlines are involved, you surface the issue and direct the attorney to verify — you do not provide a definitive answer.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['CASE_TIMELINE.md'],
  namedOutputs: [
    { id: 'timeline_events', name: 'Chronological events', schema: 'array' },
    { id: 'sol_flags', name: 'Statute of limitations flags', schema: 'array' },
  ],
  namedInputs: [
    {
      id: 'matter_name',
      name: 'Matter name',
      schema: 'string',
      acceptsOutputFrom: ['matter_summary'],
    },
  ],
};

export default CaseTimelineBuilder;
