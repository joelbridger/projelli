// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'matterName',
    question: 'Client file name',
    description: 'The case or client file name as you track it in your files.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Okafor v. Pinnacle Health Systems',
  },
  {
    id: 'caseTheory',
    question: 'Case theory (brief)',
    description: 'A sentence or two describing your theory of the case — what you are trying to prove or defend. This anchors the triage to what is actually relevant.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., We represent the plaintiff, a former nurse who was terminated after reporting patient safety concerns. We need to establish that (1) she engaged in protected activity and (2) her termination was causally connected to that report.',
  },
  {
    id: 'productionSize',
    question: 'Number of documents in production',
    description: 'Approximate size of the document production you received. Helps calibrate the triage strategy.',
    type: 'select',
    required: true,
    options: ['Under 100', '100–500', '500–2,000', '2,000+'],
    defaultValue: '100–500',
  },
  {
    id: 'documentOrganization',
    question: 'How the documents are organized',
    description: 'Describe how the production is structured — by custodian, by date range, by category, by Bates range, or not at all. This affects how you approach review.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Produced by custodian (4 custodians), Bates numbered DEF-0001 through DEF-2,218, native files with metadata, no load file provided',
  },
  {
    id: 'documentIndex',
    question: 'Document index, summaries, or file names',
    description: 'Paste the document index, file listing, or a description of what was produced. If you have a Summation or Relativity export, paste the index here. If not, paste file names or a written description of what you received. The more specific, the better the triage.',
    type: 'textarea',
    required: true,
    placeholder: 'DEF-0001 to DEF-0045: HR records for plaintiff (personnel file, performance reviews, disciplinary records)\nDEF-0046 to DEF-0199: Email communications, custodian: Sarah Nguyen (HR director)\nDEF-0200 to DEF-0541: Email communications, custodian: Dr. Mark Ellis (plaintiff\'s supervisor)\nDEF-0542 to DEF-0612: Hospital policies and procedures manuals (various dates)\nDEF-0613 to DEF-0789: Incident reports, 2023–2025\nDEF-0790 to DEF-0892: Financial records (payroll, benefits)',
  },
  {
    id: 'keyIssuesToFind',
    question: 'Key issues to look for',
    description: 'What specific facts, communications, or events are you looking for in this production? List the key issues, people, dates, or topics that are most likely to appear in the documents. This drives the search term recommendations.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Any communications about plaintiff\'s safety complaint (March 2024)\nDocuments mentioning the plaintiff by name around the time of termination (April–June 2024)\nHR policy on retaliation and whistleblower protections\nAny performance improvement plan or disciplinary action pre-dating the complaint\nCommunications between Dr. Ellis and HR about the plaintiff',
  },
];

const triagePlanPrompt = `You are assisting a licensed attorney in triaging a document production. You are not providing legal advice — you are helping the attorney build a review plan so they can allocate their time effectively and find the most relevant documents first.

Client file: {{matterName}}
Case theory: {{caseTheory}}
Production size: {{productionSize}}
Organization: {{documentOrganization}}
Key issues to find: {{keyIssuesToFind}}

Document index / production contents:
{{documentIndex}}

Produce a Markdown triage plan structured as follows:

> **Draft document** — Review and edit before use in any client work.

> **Volume limitation:** This template is designed for document sets under approximately 500 pages (roughly 50-500 documents). For large productions, use this output as a first-pass triage guide — not a replacement for eDiscovery platforms (Relativity, Logikcell, Everlaw). If your production size is in the thousands, this plan identifies where to focus, not how to complete full review.
>
> **Privilege flag:** Before analyzing, producing, or acting on any document identified in this review, flag any document that may be privileged for human attorney review. Do not rely on AI to make final privilege determinations. Any document that appears to involve attorney-client communications or attorney work product must be reviewed by the supervising attorney before being included in a production set.

# Discovery Document Triage Plan
**Client file:** {{matterName}}
**Production size:** {{productionSize}}
**Prepared for attorney review:** [date]

---

## Case Theory Anchor
[1–2 sentence restatement of what you are looking for and why, derived from the case theory input]

---

## Triage Plan

### Priority 1 — Review Immediately
These documents are most likely to contain directly relevant evidence or are essential to understanding the case theory. Review before anything else.

| Bates / File Range | Document Type | Why It's Priority 1 |
|--------------------|--------------|---------------------|
| [range] | [type] | [reason] |

**Estimated review volume:** [X documents]

---

### Priority 2 — Review Before Depositions
Important but not urgent. Should be reviewed before any depositions to avoid being caught off guard and to generate deposition preparation material.

| Bates / File Range | Document Type | Why It's Priority 2 |
|--------------------|--------------|---------------------|
| [range] | [type] | [reason] |

**Estimated review volume:** [X documents]

---

### Priority 3 — Spot-Check
Lower relevance likelihood, but should not be completely ignored. Spot-check a sample or run targeted searches rather than reviewing in full.

| Bates / File Range | Document Type | Review Approach |
|--------------------|--------------|----------------|
| [range] | [type] | [spot-check strategy] |

**Estimated review volume:** [X documents to sample]

---

## Search Terms by Issue

For each key issue, provide specific search terms to run across the full production:

### [Issue 1]
- Primary terms: \`[term1]\`, \`[term2]\`, \`[term3]\`
- Proximity searches to consider: \`[term1] w/5 [term2]\`
- Custodians to prioritize: [names]

### [Issue 2]
- Primary terms: \`[term1]\`, \`[term2]\`
- Proximity searches to consider:
- Custodians to prioritize:

[Continue for each key issue]

---

## Production Gaps to Flag
Based on the production description, note any categories of documents that seem conspicuously absent given the case theory — these may warrant a follow-up meet-and-confer or targeted motion to compel.

- [Gap 1]: [Why it's notable]
- [Gap 2]: [Why it's notable]

---

## Privilege Flag Review

List any documents in the index that may warrant privilege review before production. Flag any document where:
- The author or recipient is identified as an attorney (in-house or outside counsel)
- The subject description suggests legal advice, litigation strategy, or counsel communication
- The custodian is a member of a legal or compliance team

| Bates / File Range | Flag Reason | Recommended Action |
|--------------------|-------------|-------------------|
| [range] | [reason] | Review before producing |

> Do not produce or disclose any flagged document without attorney review of the actual document.

---

*This triage plan is a starting point for your review. Adjust priorities as you get into the documents. Search terms may need refinement based on how the documents are actually coded and indexed.*`;

export const DiscoveryDocumentTriage: WorkflowTemplate = {
  id: 'legal-discovery-document-triage',
  name: 'Discovery Document Triage',
  description: 'Given a production set description or document index, build a prioritized review plan: what to read immediately, what to review before depositions, what to spot-check, and targeted search terms organized by issue.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Verify this output against applicable law and professional standards before use in client matters.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Production Details and Review Priorities',
      description: 'Describe the document production and what you are looking for',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-triage',
      type: 'generate',
      name: 'Generate Document Triage Plan',
      description: 'Build a prioritized review plan with search terms by issue',
      config: {
        outputFile: 'DISCOVERY_TRIAGE_PLAN.docx',
        promptTemplate: triagePlanPrompt,
        systemPrompt: 'You are a litigation support specialist helping a licensed attorney build a practical document review plan. You think about relevance in terms of the case theory, prioritize ruthlessly, and recommend targeted search strategies. You flag production gaps without overstating them. You never provide legal advice. Your recommendations are practical, time-sensitive, and calibrated to the size of the production.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['DISCOVERY_TRIAGE_PLAN.docx'],
  namedOutputs: [
    { id: 'priority1_docs', name: 'Priority 1 document ranges', schema: 'array' },
    { id: 'search_terms', name: 'Search terms by issue', schema: 'array' },
    { id: 'production_gaps', name: 'Production gaps flagged', schema: 'array' },
  ],
  namedInputs: [
    {
      id: 'case_theory',
      name: 'Case theory',
      schema: 'string',
      acceptsOutputFrom: ['matter_summary', 'evidence_gaps'],
    },
  ],
};

export default DiscoveryDocumentTriage;
