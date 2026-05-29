// @draft — Legal Practice Pack v2.1
// Requires attorney review before shipping. Do not expose to users without review.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Prospective client name',
    description: 'Full name of the prospective client. Used for the conflict check memo and matter summary.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Robert Tran',
  },
  {
    id: 'matterType',
    question: 'Matter type',
    description: 'The general area of law this matter falls under. Determines the scope and framing of the preliminary work description.',
    type: 'select',
    required: true,
    options: [
      'Civil litigation',
      'Criminal',
      'Family law',
      'Estate planning',
      'Real estate',
      'Business / transactional',
      'IP',
      'Employment',
      'Other',
    ],
    defaultValue: 'Civil litigation',
  },
  {
    id: 'howTheyFoundYou',
    question: 'How they found you',
    description: 'Referral source. Useful for tracking business development and for conflict check context (referral source may itself be a conflict).',
    type: 'select',
    required: true,
    options: ['Referral from existing client', 'Referral from other attorney', 'Web search', 'State bar referral service', 'Other'],
    defaultValue: 'Referral from existing client',
  },
  {
    id: 'intakeNotes',
    question: 'Intake call notes',
    description: 'Paste your raw notes from the intake call. They can be rough — bullet points, shorthand, partial sentences. The AI will synthesize them into a structured document. Include names of parties, dates, key events, and what the client wants.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Called in about dispute with former business partner. Says partner withdrew $80k from company account right before dissolution. Partnership was dissolved June 2025. Partner claims expenses — client says no documentation was ever provided. Two-person LLC, 50/50. Operating agreement exists — client has a copy. Client wants to recover the money. Mentioned partner\'s name: David Kowalski. Client also mentioned possible breach of fiduciary duty. Has emails from partner about "wrapping things up." Seemed credible, organized, not emotional. Potential 3-year SOL issue — need to check.',
  },
  {
    id: 'matterComplexity',
    question: 'Initial sense of matter complexity',
    description: 'Your gut read after the intake call. Used to calibrate the preliminary scope of work.',
    type: 'select',
    required: true,
    options: ['Straightforward', 'Moderate', 'Complex'],
    defaultValue: 'Moderate',
  },
  {
    id: 'potentialConflicts',
    question: 'Potential conflicts to flag (optional)',
    description: 'Any parties, entities, or relationships mentioned by the prospective client that might create a conflict with existing clients or matters. Leave blank if none are obvious — the conflict check memo will prompt a broader search regardless.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Opposing party David Kowalski — check if we have represented him or his other companies. The LLC name is Kowalski-Tran Ventures LLC. The client mentioned their accountant is Linda Park — check if she is a client.',
  },
];

const intakeSynthesizerPrompt = `You are assisting a licensed attorney in synthesizing notes from a new client intake call into a structured set of working documents. You are not providing legal advice — you are helping the attorney organize the information they gathered so they can make informed decisions about engagement, conflicts, and scope.

Prospective client: {{clientName}}
Matter type: {{matterType}}
Referral source: {{howTheyFoundYou}}
Complexity assessment: {{matterComplexity}}
Potential conflicts noted: {{potentialConflicts}}

Intake call notes:
{{intakeNotes}}

Produce a single Markdown file containing three documents, clearly separated. At the top, include the draft notice.

> **Draft document** — Review and edit before use in any matter.

---

# Client Intake Summary Package
**Prospective client:** {{clientName}}
**Matter type:** {{matterType}}
**Referral source:** {{howTheyFoundYou}}
**Complexity:** {{matterComplexity}}
**Prepared for attorney review:** [date]

---

## Document 1: Matter Summary

Synthesize the intake notes into a clear, organized narrative of the client's situation. Structure it as the attorney would want to read it — not as a transcript of the call, but as a coherent account of the facts, what the client wants, and what the legal issues appear to be.

### The Client's Situation
[Narrative of the facts as the client described them — who, what, when, where, how. Write in third person ("The client states that..."). Flag anything that seems unclear or requires follow-up with the client.]

### What the Client Wants
[State the client's stated objectives clearly. Separate their desired outcome ("recover the $80k") from their stated theory ("fraud") — sometimes clients conflate the two.]

### Key Facts and Documents Mentioned
| Item | Description | Status |
|------|-------------|--------|
| [Fact/Document] | [Description] | Have it / Don't have it / Need to request |

### Legal Issues to Investigate
[Based on the intake, list the apparent legal theories or issues. Frame these as "issues to research" not conclusions. Note any statute of limitations concerns that surfaced.]

### Open Questions / Clarifications Needed
- [Question 1]
- [Question 2]

---

## Document 2: Conflict Check Search Guide

> **IMPORTANT:** This document generates search parameters for running against your firm's conflict database or records. It does NOT perform a conflict check and does NOT determine whether a conflict exists. Do not proceed with engagement until you have run these searches against your actual conflict system and reviewed the results yourself.

### Parties to Search
Run your conflict database against each of the following. Search both full names and common variants/abbreviations.

| Name / Entity | Role | Search Notes |
|--------------|------|--------------|
| {{clientName}} | Prospective client | Also search former names if applicable |
| [Opposing party from notes] | Adverse party | Search all corporate aliases and related entities |
| [Other parties mentioned] | [Role] | |
| [Referral source if named] | Referral source | Referral source conflict check |

### Boolean Search Strings to Run
Copy and adapt these for your conflict system (Clio, Lawmatics, manual index, or other):

- \`"{{clientName}}"\` — exact name match
- [Opposing party name] — exact name match
- [LLC/entity name] AND [any member names mentioned]
- [Referral source name]

Adjust terms to match how your system indexes names. Run each search separately; don't combine into one query.

### Related Matter Types to Check
[Based on the matter description, list practice areas or entity types that may surface related conflicts — e.g., if the matter involves an LLC, check all matters involving that LLC and its principals]

### Checklist Before Engaging
- [ ] Searched conflict database for prospective client name and variants
- [ ] Searched conflict database for all adverse parties named during intake
- [ ] Searched conflict database for referral source (if named)
- [ ] Reviewed results and identified no disqualifying conflicts
- [ ] Documented search date and results in matter file
- [ ] [Any specific flags that surfaced during intake — from potentialConflicts field]

> This guide identifies parties and search terms — running the actual conflict check and reviewing results is your responsibility. Document your search and its outcome in the matter file before accepting the engagement.

---

## Document 3: Preliminary Scope of Work

### What This Engagement Would Likely Cover
Based on the matter description and complexity assessment, a {{matterType}} engagement of {{matterComplexity}} complexity would typically include:

[List the primary tasks and phases — e.g., initial case assessment, demand letter, filing, discovery, motion practice, trial prep. Calibrate to the stated complexity level. Flag anything that is speculative given the early stage.]

### What Is Likely Out of Scope
[List anything the client mentioned or implied that falls outside typical scope for this matter type, or that would require a separate engagement or referral]

### Questions to Resolve Before Committing to Full Scope
- [Question 1 — e.g., "Review operating agreement to assess breach of fiduciary duty claim"]
- [Question 2]
- [Question 3]

### Suggested Next Steps
1. [Step 1 — e.g., "Complete conflict check"]
2. [Step 2 — e.g., "Send engagement letter and retainer agreement"]
3. [Step 3 — e.g., "Request documents from client: operating agreement, bank records, emails"]
4. [Step 4 — e.g., "Research statute of limitations for [applicable claim] in [jurisdiction]"]

---

*This intake package is a starting point for your review. Verify all facts with the client and against source documents before acting on any legal issue identified here.*`;

export const ClientIntakeSynthesizer: WorkflowTemplate = {
  id: 'legal-client-intake-synthesizer',
  name: 'Client Intake Synthesizer',
  description: 'Synthesizes new client intake call notes into three structured documents in one file: a Matter Summary, a Conflict Check Memo with parties to search, and a Preliminary Scope of Work with next steps.',
  version: '1.0.0',
  category: 'legal',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Intake Call Information',
      description: 'Paste your intake call notes and provide basic matter information',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-intake-package',
      type: 'generate',
      name: 'Generate Intake Package',
      description: 'Synthesize into Matter Summary, Conflict Check Memo, and Preliminary Scope of Work',
      config: {
        outputFile: 'CLIENT_INTAKE_PACKAGE.md',
        promptTemplate: intakeSynthesizerPrompt,
        systemPrompt: 'You are a legal practice management assistant helping a licensed attorney process a new client intake. You synthesize rough notes into clear, organized documents the attorney can act on. You are careful to frame legal issues as "issues to research" rather than conclusions, and you never give legal advice. You think carefully about conflict check thoroughness — surfacing every party, entity, and relationship mentioned, not just the obvious ones. Your scope of work descriptions are realistic and calibrated to the complexity level provided.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['CLIENT_INTAKE_PACKAGE.md'],
  namedOutputs: [
    { id: 'matter_summary', name: 'Matter summary', schema: 'string' },
    { id: 'conflict_search_terms', name: 'Conflict search parameters', schema: 'array' },
    { id: 'next_steps', name: 'Suggested next steps', schema: 'array' },
  ],
};

export default ClientIntakeSynthesizer;
