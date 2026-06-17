// Tax Practice Pack v2.2 (shipped). Built with input from practicing CPAs and EAs.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full name of the client under examination.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Thornwood Landscaping LLC',
  },
  {
    id: 'taxYearUnderExamination',
    question: 'Tax year under examination',
    description: 'The tax year(s) the IRS or state agency is examining.',
    type: 'text',
    required: true,
    placeholder: 'e.g., 2023',
  },
  {
    id: 'examiningAgentContact',
    question: 'Examining agent and contact information (optional)',
    description: 'Name, ID number, and contact information of the IRS agent or state examiner.',
    type: 'text',
    required: false,
    placeholder: 'e.g., Revenue Agent Sandra Wu, ID #12345, (555) 200-1100',
  },
  {
    id: 'issuesRaised',
    question: 'Issue(s) raised in the notice or IDR',
    description: 'The specific issues or items the examiner has raised. Copy directly from the notice or Information Document Request if available.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Unreported income on Schedule C; disallowed home office deduction; substantiation of vehicle expense deductions',
  },
  {
    id: 'supportingDocumentsGathered',
    question: 'Supporting documents gathered so far',
    description: 'List the documents you have assembled or identified to support the client\'s positions.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Bank statements Jan-Dec 2023, client invoice log, home office photos and lease, mileage log',
  },
  {
    id: 'clientExplanation',
    question: 'Client\'s explanation of disputed items',
    description: 'The client\'s account of the facts underlying each disputed item, in their own words if possible.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Client says all Schedule C income was reported — they believe the discrepancy is because one payment was received in December 2022 but the 1099 was issued in 2023...',
  },
  {
    id: 'priorCommunications',
    question: 'Prior communications with IRS (optional)',
    description: 'Summary of any prior contacts — calls, letters, meetings — and their outcomes.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Called agent on April 2, 2026 — agreed to 30-day extension. Sent acknowledgment letter April 5.',
  },
];

const auditDefenseFileBuilderPrompt = `You are assisting a licensed tax professional in organizing an audit defense file and drafting a response package. This is a practitioner work-product document. You are helping organize the record — you are not providing legal advice or making representations to the IRS.

Client name: {{clientName}}
Tax year under examination: {{taxYearUnderExamination}}
Examining agent and contact: {{examiningAgentContact}}
Issues raised: {{issuesRaised}}
Supporting documents gathered: {{supportingDocumentsGathered}}
Client's explanation: {{clientExplanation}}
Prior communications: {{priorCommunications}}

Produce an audit defense memo and cover letter template in Markdown. At the top, include the draft notice.

> **Draft document** — Review and edit before delivery.

---

# Audit Defense File
**PRACTITIONER WORK PRODUCT — PRIVILEGED AND CONFIDENTIAL**

**Client:** {{clientName}}
**Tax year:** {{taxYearUnderExamination}}
**Prepared:** [date]
**Assigned to:** [practitioner name]

---

## Statute of Limitations and Extension Tracker

| Item | Date | Notes |
|------|------|-------|
| Return filed (original) | | |
| Original SOL expiration | [3 years from filing date for standard assessments — see §6501(a)] | |
| Any Form 872 extension(s) signed | | Include each extension separately |
| Current SOL expiration | | After all extensions |
| Collection SOL (if applicable) | [10 years from assessment under §6502] | |

> If the SOL has passed or is approaching, flag for immediate attorney review before responding to any IRS contact. Do not extend the SOL without evaluating the tradeoffs.

---

## IDR Cross-Reference Index

[For each Information Document Request received, create one row:]

| IDR # | Date Received | Items Requested | Response File(s) | Status |
|-------|--------------|-----------------|-----------------|--------|
| IDR-1 | | [list items] | [file names or folder path] | Draft / Sent / Pending |

> Every IDR item must be explicitly addressed in the response. Unanswered IDR items signal incomplete cooperation and may result in summons.

---

## Issues Raised

[Summarize each issue raised in the notice or IDR as a numbered list. State each issue clearly and separately so the memo can address them one by one.]

---

## Defense Analysis by Issue

[For each issue identified above, create a numbered section:]

### Issue [N]: [Issue Name]

**Issue as raised:**
[Restate the issue exactly as the examiner raised it]

**Client's position and legal basis:**
[State the client's position clearly. Identify the applicable IRC section, regulation, or case law that supports the position. Frame this as the practitioner's assessment of the legal support available — be honest about strength.]

**Substantiation (factual record — documents only):**
[List the specific documents from the gathered list that support this issue. This section contains documents only — no legal argument. Note any gaps — documents that would help but have not yet been found or that may not exist.]

**Legal position (argument only — no documents here):**
[Identify the applicable IRC section, regulation, Revenue Ruling, or case law that supports the client's position. Frame as the practitioner's assessment of legal support available. Be honest about strength — note if the position is "substantial authority" (>40% likelihood of prevailing), "reasonable basis" (<40% but defensible), or weaker. Do NOT list documents in this section — those belong in Substantiation above.]

**Proposed response strategy:**
[For this specific issue: whether to concede, contest, or seek a compromise. Note any audit lottery considerations or penalties that may attach if the position is challenged and fails.]

**Open items still needed:**
- [Item 1]
- [Item 2]

[Repeat for each issue]

---

## Summary of Open Items Across All Issues

[Consolidated list of all items still needed before the response can be finalized, regardless of which issue they relate to.]

---

## Appeals / Litigation Track Note

[After reviewing all issues above, write one paragraph on posture:]

If the examining agent denies one or more of the client's positions, the next step is:
- **IRS Appeals:** Available for most examination disputes. File a written protest within 30 days of the 30-day letter (or 90-day letter for Tax Court). Appeals is independent of the examination division and often reaches different outcomes. Note any docketed Tax Court cases that affect timing.
- **Tax Court:** If a statutory notice of deficiency (90-day letter) is issued, the client has 90 days to petition Tax Court (150 days if outside the US). Missing this deadline forfeits Tax Court rights.
- **Refund suit:** Alternative to Tax Court — pay the tax, file a claim for refund, then sue in US District Court or Court of Federal Claims. Different considerations (jury trial available; different burden of proof).

Current posture recommendation: [Based on the issues and evidence, note which track you would recommend if exam does not concede — and why.]

---

## Cover Letter Template

[Draft a professional cover letter to accompany the response. The letter should:]

[Practitioner letterhead]

[Date]

[Examining agent name and contact, if provided]
Internal Revenue Service
[Address from the notice]

Re: {{clientName}} — Response to [Notice type] — Tax Year {{taxYearUnderExamination}}

Dear [Agent name or "Examining Officer"]:

[Opening paragraph: identify the client, the notice being responded to, and the tax year]

[Body: state that the client is providing documentation in response to the issues raised. Describe the organization of the response package — e.g., "Enclosed please find documentation organized by issue as follows:"]

[For each issue: one sentence stating the client's position and what documentation is enclosed]

[Closing: note that the practitioner is available for questions, provide contact information, and request confirmation of receipt]

Sincerely,

[Practitioner signature block]

Enclosures:
[List of enclosed documents]

---

*This defense file is a working document. All positions should be reviewed by the practitioner before submission. Verify that all documents referenced as enclosed are actually included in the final response package. Consider whether Kovel agreement or attorney involvement is warranted before submission.*`;

export const AuditDefenseFileBuilder: WorkflowTemplate = {
  id: 'tax-audit-defense-file-builder',
  name: 'Audit Defense File Builder',
  description: 'Builds an organized audit response file from practitioner notes, with issue-by-issue defense analysis (position, legal basis, supporting documents, response strategy, open items) plus a cover letter template.',
  version: '1.0.0',
  category: 'tax',
  requiresVerification: true,
  verificationNote: "Every 'substantial authority' position in this output is a proposed argument, not a legal determination. Verify citations before filing or communicating to the IRS.",
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Audit Information',
      description: 'Provide the issues raised, supporting documents, and client explanation',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-audit-defense-file',
      type: 'generate',
      name: 'Generate Audit Defense File',
      description: 'Build the issue-by-issue defense memo and cover letter template',
      config: {
        outputFile: 'AUDIT_DEFENSE_FILE.md',
        promptTemplate: auditDefenseFileBuilderPrompt,
        systemPrompt: 'You are a tax practice assistant helping a licensed CPA or EA organize an audit defense file. You analyze each issue raised by the examiner separately, identify the applicable legal authority, assess the supporting documentation, and flag open items. You are honest about the strength of each position — you do not overstate the case. You help the practitioner think through response strategy for each issue and produce a professional cover letter template. You always flag that the response must be reviewed before submission and note when attorney involvement may be warranted.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['AUDIT_DEFENSE_FILE.md'],
  namedOutputs: [
    { id: 'defense_memo', name: 'Audit defense memo', schema: 'string' },
    { id: 'cover_letter', name: 'Cover letter template', schema: 'string' },
    { id: 'open_items', name: 'Open items list', schema: 'array' },
  ],
};

export default AuditDefenseFileBuilder;
