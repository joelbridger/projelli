// @draft — Legal Practice Pack v2.1
// Requires attorney review before shipping. Do not expose to users without review.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'matterName',
    question: 'Matter name',
    description: 'The case or matter name as you track it in your files.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Harrington Industries v. Vance Capital LLC',
  },
  {
    id: 'opposingParty',
    question: 'Opposing party (for context)',
    description: 'Name of the opposing party. Used to help identify documents in which they appear as an author or recipient — which may affect privilege analysis.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Vance Capital LLC',
  },
  {
    id: 'privilegeTypes',
    question: 'Privilege types applicable',
    description: 'Select all privilege types you expect to assert. Attorney-client covers communications made in confidence for the purpose of legal advice. Work product covers documents prepared in anticipation of litigation.',
    type: 'multiselect',
    required: true,
    options: ['Attorney-client privilege', 'Work product doctrine', 'Both'],
  },
  {
    id: 'courtJurisdiction',
    question: 'Court / jurisdiction',
    description: 'The court and jurisdiction. Privilege log format requirements vary — some courts require specific columns or certifications. Note the court so the output can flag any jurisdiction-specific considerations.',
    type: 'text',
    required: true,
    placeholder: 'e.g., U.S. District Court, N.D. Cal. (Judge Chen)',
  },
  {
    id: 'documentList',
    question: 'Documents to log',
    description: 'List each document on its own line. For each, include: date, author, recipient(s), and a brief subject description. Example format: "2026-01-15 | Jane Smith (attorney) | John Doe (client) | Email re: litigation strategy for Q1". You can use any consistent separator. The more detail you provide, the more accurate the privilege description will be.',
    type: 'textarea',
    required: true,
    placeholder: '2026-01-15 | Jane Smith (atty) | John Doe (client) | Email re: litigation strategy\n2026-01-18 | John Doe (client) | Jane Smith (atty) | Email re: documents responsive to RFPs\n2026-02-03 | Jane Smith (atty) | File/internal | Memorandum re: deposition strategy for Martinez\n2026-02-10 | Jane Smith (atty), Mark Lee (atty) | File/internal | Notes from witness interview with R. Thompson',
  },
];

const privilegeLogPrompt = `You are assisting a licensed attorney in drafting a privilege log for document production. You are not providing legal advice — you are helping the attorney structure descriptions and assertions that the attorney will review, edit, and certify.

Matter: {{matterName}}
Opposing party: {{opposingParty}}
Privilege types: {{privilegeTypes}}
Court / jurisdiction: {{courtJurisdiction}}

Documents to log:
{{documentList}}

Produce a Markdown privilege log structured as follows:

> **Draft document** — Review and edit before use in any matter. Attorney must review each entry for accuracy before certifying the log for production.

# Privilege Log
**Matter:** {{matterName}}
**Court / jurisdiction:** {{courtJurisdiction}}
**Privilege(s) asserted:** {{privilegeTypes}}
**Prepared for attorney review:** [date]

---

## Cover Note

This privilege log was prepared in connection with document production in the above-captioned matter. Documents have been withheld or redacted on the grounds of attorney-client privilege and/or the work product doctrine, as identified below. All entries are subject to attorney review and correction before this log is served on opposing counsel.

[Note any jurisdiction-specific formatting requirements or caveats here if applicable.]

---

## Privilege Log

| # | Doc No. / Bates | Date | Author(s) | Recipient(s) (incl. CC/BCC) | Document Type | Description | Privilege Basis | Status |
|---|-----------------|------|-----------|---------------------------|---------------|-------------|-----------------|--------|

For each document in the input, create one table row. Use these conventions:
- **Description**: Write a neutral, non-revealing description that conveys the general subject matter without disclosing privileged content. For attorney-client communications: "Confidential communication between attorney and client regarding [general subject]." For work product: "Attorney memorandum prepared in anticipation of litigation regarding [general subject]."
- **Privilege Asserted**: "Attorney-Client Privilege," "Work Product Doctrine," or "Attorney-Client Privilege; Work Product Doctrine"
- **Basis**: One sentence. For attorney-client: "Confidential communication between attorney [name] and client [name] for the purpose of obtaining legal advice." For work product: "Document prepared by counsel in anticipation of litigation."
- **Status**: "Withheld in full," "Redacted," or "Withheld in full — partial redaction of related document." Work-product documents listed on a privilege log but not withheld should be marked "Listed — not withheld" with the basis column noting why they appear on the log.

Important: "Description" descriptions must convey general subject matter without disclosing privileged content. A description that reveals the legal advice sought or given itself waives privilege. When uncertain, err toward less descriptive. Flag these for attorney review rather than guessing.

After the table:

---

## Drafting Notes for Attorney Review

Flag any documents where:
- The privilege basis may be contested (e.g., document copied to a non-privileged third party, or where the primary purpose is unclear)
- The description requires more detail to withstand a challenge
- The privilege type selection may need reconsideration

List each flagged document by its log number with a brief explanation.

---

*This log is a starting point for your review. Verify each entry against the actual document before serving. The descriptions above do not constitute legal advice and should be edited to reflect the actual content and purpose of each document.*`;

export const PrivilegeLogDrafter: WorkflowTemplate = {
  id: 'legal-privilege-log-drafter',
  name: 'Privilege Log Drafter',
  description: 'Given a list of documents, draft a properly formatted privilege log with attorney-client and/or work product assertions for each entry. Produces a table formatted to common court standards with a cover note and attorney review flags.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Privilege Log Details',
      description: 'Provide the matter details and the list of documents to be logged',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-log',
      type: 'generate',
      name: 'Generate Privilege Log',
      description: 'Draft privilege log entries for each document',
      config: {
        outputFile: 'PRIVILEGE_LOG.md',
        promptTemplate: privilegeLogPrompt,
        systemPrompt: 'You are a legal research assistant helping a licensed attorney draft a privilege log for document production. You write neutral, non-revealing document descriptions that preserve privilege while satisfying discovery requirements. You flag entries that may be vulnerable to challenge so the attorney can make informed decisions. You never provide legal advice and never certify the correctness of privilege assertions — that is the attorney\'s job.\n\nPRIVILEGE CHARACTERIZATION DISCIPLINE: Flag any privilege characterization for attorney review; this draft is a starting point, not a legal determination. Privilege analysis is fact-specific and jurisdiction-dependent. Every assertion in this log that the attorney has not independently reviewed and approved should be treated as a working draft only. When jurisdictional privilege standards inform an entry, note that those standards must be verified against the applicable court rules and case law for the specific jurisdiction.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['PRIVILEGE_LOG.md'],
  namedOutputs: [
    { id: 'privilege_log_entries', name: 'Privilege log entries', schema: 'array' },
    { id: 'flagged_entries', name: 'Entries flagged for attorney review', schema: 'array' },
  ],
};

export default PrivilegeLogDrafter;
