// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.
//
// VG-3d — Issue Spotter. The vision names an issue-spotter as part of the
// litigation pack; this is the adoption-level-1 build (see ./index.ts:13-19):
// an interview -> generate template with a Word (.docx) deliverable, no logic
// in the engine beyond the standard markdown-to-docx render. It is NOT a
// grounded analyze step and does NOT retrieve from the workspace — it spots
// issues from the facts the attorney pastes in. The grounded/cited upgrade
// (an analyze step over matter-scoped retrieval) is a later, separate decision.
//
// The discipline the rest of the legal pack carries holds here: it proposes,
// it does not decide; it flags issues, it does not conclude the matter; missing
// facts are reported as findings, never invented; and an area with no issue is
// an honest "nothing here" rather than a manufactured one. @draft framing and
// the verification banner stay until attorney sign-off.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'matterName',
    question: 'Client file name',
    description: 'A short name for this client file, used in the heading of the analysis.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Johnson v. Nexus Dynamics; Acme Corp. acquisition of Riverside Foods',
  },
  {
    id: 'matterType',
    question: 'Client work type / practice area',
    description: 'The practice area the facts fall under. This calibrates which families of issues to look for. If more than one area is in play, list them.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Employment litigation; Commercial real estate; Estate administration; Breach of contract',
  },
  {
    id: 'jurisdiction',
    question: 'Jurisdiction',
    description: 'The governing jurisdiction. Issues turn on the controlling law, so name the state and, where relevant, whether federal or state law applies and any specific court.',
    type: 'text',
    required: true,
    placeholder: 'e.g., California (state law); U.S. District Court, S.D.N.Y.; Delaware Chancery',
  },
  {
    id: 'factPattern',
    question: 'Facts',
    description: 'Paste the facts as you have them. Include parties, dates, the conduct at issue, and any documents you know about. The analysis works from what you provide, so the more complete the facts, the more useful the issues spotted.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Client was terminated on March 3 after reporting a safety violation to OSHA in January. No written warnings preceded the termination. The employee handbook describes a progressive-discipline policy. Client signed an arbitration agreement at hiring...',
  },
  {
    id: 'clientObjectives',
    question: "Client's objectives",
    description: 'What the client is trying to achieve. The analysis flags which issues bear on these objectives so the most relevant ones surface first.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Client wants to recover lost wages and avoid arbitration if possible; Client wants the deal to close on schedule with the cleanest possible title',
  },
  {
    id: 'knownDeadlines',
    question: 'Known deadlines or constraints (optional)',
    description: 'Any statute of limitations, filing deadline, closing date, or other time constraint you already know about. The analysis flags issues that are time-sensitive in light of them.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Two-year statute of limitations on the tort claim; EEOC charge due within 300 days; closing scheduled for the end of next month',
  },
];

const issueSpotterPrompt = `You are assisting a licensed attorney by spotting the legal issues a set of facts raises. You are not providing legal advice and you are not deciding the client work. You are helping the attorney see the issues so the attorney can investigate them and exercise their own professional judgment.

Client file: {{matterName}}
Practice area: {{matterType}}
Jurisdiction: {{jurisdiction}}
Facts: {{factPattern}}
Client's objectives: {{clientObjectives}}
Known deadlines or constraints: {{knownDeadlines}}

Work only from the facts above. Identify the legal issues those facts raise, organized by area of law. For each issue, give the attorney enough to act on it without pretending to resolve it.

Rules you must follow:
- Flag issues. Do not conclude them. Your job is to surface what is in play, not to decide who wins. Where an issue could cut either way, say so and name what it turns on.
- Missing facts are a finding, not a gap to fill. When you cannot evaluate an issue because a fact is absent, say plainly what is missing and why it matters. Never invent a fact, a date, a document, or a quotation to complete the picture.
- An area with no issue is an honest answer. If the facts raise nothing in a relevant area, say so rather than manufacturing an issue to fill the section.
- Do not cite cases, statutes, or regulations from memory as authority. If naming a controlling rule would help the attorney, describe the rule in plain terms and flag it as something the attorney must confirm against primary law for this jurisdiction. Law changes and citations from training data may be wrong.

Produce the analysis in Markdown. Begin with the draft notice exactly as written.

> **Draft document** — This is a draft issue analysis generated by AI. It identifies issues to investigate; it does not resolve them or constitute legal advice. Confirm every issue, every missing-fact note, and any rule described against primary authority before relying on it.

---

## Issue Spotter Analysis

**Client file:** {{matterName}}
**Practice area:** {{matterType}}
**Jurisdiction:** {{jurisdiction}}
**Prepared:** [Date]

---

### Issues at a Glance

[A short list of the issues spotted, each one line, ordered so the issues that bear most directly on the client's stated objectives come first. If a known deadline makes an issue time-sensitive, mark it here.]

---

### Issues by Area

[For each area of law the facts implicate, add a subsection. Within each area, treat each distinct issue under its own heading using the structure below. If an area is relevant but the facts raise nothing in it, include the area and state honestly that no issue appears on these facts.]

#### [Area of law]

**Issue:** [State the legal question the facts raise, framed neutrally.]

**Facts that raise it:** [Quote or summarize the specific facts above that put this issue in play. Tie the issue to what the attorney actually told you, not to assumed facts.]

**What is missing to evaluate it:** [State plainly what additional facts, documents, or information the attorney would need to assess this issue. If nothing is missing and the facts are sufficient to frame the issue, say so. Do not fill the gap with invented facts.]

**Suggested next questions:** [Concrete questions the attorney could ask the client, or steps to take, to develop this issue.]

---

### Time-Sensitive Items

[If any known deadline or constraint was provided, list the issues affected by it and what is due when. If none was provided, note that no deadlines were supplied and that the attorney should confirm any applicable limitations periods.]

---

### What This Analysis Did Not Cover

[Note any obvious limits: facts that were sketchy, areas you could not assess because the facts were silent, and anything the attorney flagged that falls outside the facts provided. An honest boundary is more useful than a false sense of completeness.]

---

*This issue analysis was generated by ${BRAND.messaging.redlineAuthor} and requires attorney review. It identifies issues to investigate; it is not legal advice and does not resolve the client work.*`;

export const IssueSpotter: WorkflowTemplate = {
  id: 'legal-issue-spotter',
  name: 'Issue Spotter',
  description: 'Reads a fact pattern and spots the legal issues it raises, organized by area of law. For each issue it ties the issue to the specific facts, flags what is missing to evaluate it, and suggests next questions. It flags issues rather than concluding them, reports missing facts as findings rather than inventing them, and treats an area with no issue as an honest answer. Produces a draft Word document for attorney review.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'This is a draft issue analysis, not legal advice and not a resolution of the client work. Confirm each issue against the facts and primary authority for the jurisdiction, verify every note about a missing fact, and confirm any legal rule described before relying on it. The analysis works only from the facts you provided; it does not search the client file.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Client Work and Facts',
      description: 'Describe the client work, the practice area, the jurisdiction, the facts, and the client objectives',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-issue-spotter',
      type: 'generate',
      name: 'Spot the Issues',
      description: 'Draft the issue analysis organized by area, with missing facts flagged and next questions suggested',
      config: {
        outputFile: 'Issue Spotter Analysis.docx',
        promptTemplate: issueSpotterPrompt,
        systemPrompt: 'You are a legal issue-spotting assistant helping a licensed attorney. You surface the legal issues a set of facts raises so the attorney can investigate them; you do not decide the client work and you do not give legal advice.\n\nDISCIPLINE YOU MUST HOLD: Work only from the facts the attorney provides. Flag issues, do not conclude them. When a fact needed to evaluate an issue is absent, report the absence as a finding and say why it matters; never invent a fact, date, document, party, or quotation to fill the gap. An area of law that the facts raise nothing in is an honest "no issue on these facts," not a section to pad. Do not assert cases, statutes, or regulations from memory as authority; if a controlling rule is worth naming, describe it in plain terms and flag it as something the attorney must verify against primary law for the specific jurisdiction, because law changes and training data has a cutoff. The output is a draft for attorney review and must say so.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['Issue Spotter Analysis.docx'],
  namedOutputs: [
    { id: 'issue_analysis', name: 'Issue spotter analysis', schema: 'string' },
    { id: 'issues', name: 'Issues spotted', schema: 'array' },
    { id: 'missing_facts', name: 'Missing facts to develop', schema: 'array' },
  ],
};

export default IssueSpotter;
