// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full name of the client (or clients for a married couple). Used in the file name and throughout the summary.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Margaret and Thomas Aldridge',
  },
  {
    id: 'clientAge',
    question: 'Client age(s)',
    description: 'Age of the client or clients. Relevant to planning horizon, retirement account rules, and life insurance considerations.',
    type: 'text',
    required: false,
    placeholder: 'e.g., Margaret: 67, Thomas: 70',
  },
  {
    id: 'maritalStatus',
    question: 'Marital status',
    description: 'Current marital status. Drives the applicable planning tools (marital deduction, joint trusts, QTIP, etc.).',
    type: 'select',
    required: true,
    options: [
      'Married (first marriage)',
      'Married (subsequent marriage)',
      'Single',
      'Widowed',
      'Divorced',
      'Domestic partnership',
    ],
    defaultValue: 'Married (first marriage)',
  },
  {
    id: 'familyStructure',
    question: 'Family structure',
    description: 'Describe the family: children, grandchildren, stepchildren, dependents, or other beneficiaries. Note any special circumstances such as a child with special needs, a blended family, or an estranged family member.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Two adult children: Susan Aldridge (age 44, no dependents) and James Aldridge (age 41, married with two minor children). One minor grandchild from James. No stepchildren. James has a history of substance abuse — client expressed concern about outright distribution.',
  },
  {
    id: 'assetCategories',
    question: 'Asset categories and rough values',
    description: 'List the general categories of assets and approximate values. Account numbers and exact figures are not required — categories and rough ranges are sufficient for planning purposes. One category per line.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g.,\nPrimary residence (Chicago): approx. $850k\nVacation property (Wisconsin): approx. $320k\nIRA (Thomas): approx. $1.1M\n401(k) (Margaret, still employed): approx. $480k\nJoint brokerage account: approx. $275k\nLife insurance on Thomas: $500k death benefit (Margaret as primary beneficiary)\nSmall business interest (Thomas, sole owner): approx. $200k estimated value',
  },
  {
    id: 'currentDocuments',
    question: 'Current documents in place',
    description: 'Check all documents the client currently has. For each you have confirmed exists, note approximately when it was executed if known.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g.,\nWill (Thomas): yes, executed 2014\nWill (Margaret): yes, executed 2014\nRevocable living trust: no\nDurable power of attorney (financial): Margaret has one, Thomas does not\nHealthcare proxy / medical POA: neither\nLiving will / advance directive: neither\nBeneficiary designations reviewed: not recently\nLady Bird deed or transfer-on-death deed: no',
  },
  {
    id: 'planningObjectives',
    question: 'Planning objectives',
    description: 'What the client wants to accomplish. Include both what they stated and any goals you inferred from the conversation.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Avoid probate. Ensure Margaret is fully provided for if Thomas dies first. Minimize estate tax exposure (concerned about Illinois estate tax threshold). Protect James\'s share from his own creditors and poor decisions — interested in a discretionary trust. Provide for grandchildren\'s education. Keep family vacation property in family.',
  },
  {
    id: 'specialCircumstances',
    question: 'Special circumstances',
    description: 'Any circumstances that significantly affect planning options: blended family dynamics, business succession, special needs beneficiary, prior gifts, pending litigation, out-of-state property, foreign assets, charitable intentions, etc.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Thomas owns a small CPA practice as sole proprietor — no succession plan in place. Couple owns Wisconsin vacation property — may require ancillary probate if not addressed. James\'s history of instability increases interest in discretionary trust structure.',
  },
];

const estatePlanningClientSummaryPrompt = `You are assisting a licensed estate planning attorney in organizing client information gathered during an intake meeting into a structured planning summary. You are not providing legal advice — you are helping the attorney document the client's situation, identify planning gaps, and prepare for the drafting phase.

Client: {{clientName}}
Age(s): {{clientAge}}
Marital status: {{maritalStatus}}

Family structure:
{{familyStructure}}

Asset categories and approximate values:
{{assetCategories}}

Current documents:
{{currentDocuments}}

Planning objectives:
{{planningObjectives}}

Special circumstances:
{{specialCircumstances}}

Produce a single Markdown file formatted as a structured estate planning summary. Begin with the draft notice and the working document reminder.

> **Draft document** — Review and edit before use in any matter. This output is a draft for attorney review. It does not constitute legal advice and does not substitute for your professional judgment.
>
> **Working document reminder:** This is a working document for internal use. Verify all asset values and document status directly with the client before drafting.

---

# Estate Planning Client Summary
**Client:** {{clientName}}
**Marital status:** {{maritalStatus}}
**Prepared for attorney review:** [date]

---

## Client Demographics

| Field | Information |
|-------|-------------|
| Name(s) | {{clientName}} |
| Age(s) | {{clientAge}} |
| Marital status | {{maritalStatus}} |
| Family overview | [Concise 1-2 sentence summary of the family structure] |

---

## Family Structure

[Expand the family structure into a narrative overview: each family member, their relationship to the client(s), and any relevant circumstances (age, dependents, special needs, concerns the client raised). Note any family dynamics that are likely to affect planning choices.]

---

## Estate Overview

### Asset Categories

| Category | Approximate Value | Title / Ownership | Notes |
|----------|-------------------|-------------------|-------|

[Populate from the asset categories input. For each category: note how it is likely titled (joint tenancy, community property, sole ownership, beneficiary-designated) based on the information provided. Flag any asset category where title or beneficiary designation is not confirmed, as this affects whether the asset passes under the will, by beneficiary designation, or by operation of law.]

**Estimated gross estate (rough total):** [Sum the approximate values provided, or note as "Not calculated — values not provided." Flag if the total may approach or exceed the applicable federal or state estate tax exemption.]

---

## Current Documents in Place

| Document | Status | Notes |
|----------|--------|-------|

[For each document category in the input, indicate: In place (with approximate date if provided) / Not in place / Unknown. Flag any gap that creates immediate legal exposure — for example, no financial POA means no agent can act if the client becomes incapacitated before one is signed.]

### Document Gaps and Exposure

[List the specific documents that are missing or that appear outdated based on the information provided. For each gap, describe the practical consequence in plain terms — not legal conclusions, but factual observations about what would happen in the absence of that document.]

---

## Planning Goals

[Restate the client's stated objectives in organized form. Separate:
- Primary goals (the core outcomes the client needs the plan to accomplish)
- Secondary goals (preferences or nice-to-haves the client mentioned)
- Goals you inferred from the conversation that the client did not explicitly state]

---

## Special Circumstances

[Describe each special circumstance and note why it is relevant to the planning analysis. If none were identified, note that no special circumstances were raised at intake.]

---

## Recommended Next Steps and Documents to Consider

Based on the goals and circumstances described, the following documents and planning steps are commonly considered in situations like this one. This list is a starting point for attorney analysis and is not a recommendation or a complete planning prescription.

### Documents to Consider Drafting or Updating
- [Document 1 — with a brief note on why it addresses a stated goal or fills a gap]
- [Document 2]
- [Continue as applicable]

### Planning Strategies to Evaluate
- [Strategy or structure 1 — described in factual terms, not as advice. Example: "Discretionary trust for [beneficiary] — addresses client's concern about outright distribution to James."]
- [Continue as applicable]

### Third-Party Actions or Coordination Needed
- [Item 1 — e.g., "Beneficiary designation review and update — coordinate with financial advisor or plan administrator"]
- [Continue as applicable]

---

## Open Questions for Next Meeting

[List specific questions to resolve with the client before drafting begins. Focus on information that is necessary to draft accurately — unclear asset titling, unconfirmed document dates, unanswered questions about special circumstances, or planning choices the client has not yet made.]

- [Question 1]
- [Question 2]
- [Continue as applicable]

---

*This is a working document for internal use. Verify all asset values and document status directly with the client before drafting. Estate values and document status change; this summary reflects the information provided at intake.*

*This output is a draft for attorney review. It does not constitute legal advice and does not substitute for your professional judgment.*

*Compliance note: Verify all asset information directly with the client. Estate values and document status change; this summary reflects the information provided at intake.*`;

export const EstatePlanningClientSummary: WorkflowTemplate = {
  id: 'legal-estate-planning-client-summary',
  name: 'Estate Planning Client Summary',
  description: 'For estate planning attorneys: given client intake information and planning objectives, produces a structured summary covering client demographics, estate overview, current documents in place, planning goals, recommended documents to consider, and open questions for the next meeting.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Verify this output against applicable law and professional standards before use in client matters.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Client Information',
      description: 'Provide client demographics, asset overview, existing documents, and planning objectives',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-planning-summary',
      type: 'generate',
      name: 'Generate Planning Summary',
      description: 'Produce a structured estate planning client summary',
      config: {
        outputFile: 'Estate Planning/{{clientName}} - Planning Summary.md',
        promptTemplate: estatePlanningClientSummaryPrompt,
        systemPrompt: 'You are a legal practice management assistant helping a licensed estate planning attorney organize client intake information into a structured working document. You produce clear summaries that identify document gaps, surface planning considerations, and prepare the attorney for the drafting phase. You describe planning tools and structures in factual terms — what they do and why they are commonly used in a given situation — without recommending a specific course of action or providing legal advice. You flag missing information clearly so the attorney knows exactly what to gather before drafting begins.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['Estate Planning/{{clientName}} - Planning Summary.md'],
  namedOutputs: [
    { id: 'document_gaps', name: 'Document gaps and missing instruments', schema: 'array' },
    { id: 'planning_goals', name: 'Client planning goals', schema: 'array' },
    { id: 'open_questions', name: 'Open questions for next meeting', schema: 'array' },
  ],
};

export default EstatePlanningClientSummary;
