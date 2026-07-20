// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'researchQuestion',
    question: 'Legal research question',
    description: 'State the specific legal question this memo addresses. Be precise — a well-framed question produces a focused memo.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Whether a commercial landlord in California may withhold a security deposit for normal wear and tear under Civil Code § 1950.5',
  },
  {
    id: 'jurisdiction',
    question: 'Jurisdiction',
    description: 'The controlling jurisdiction for this question. Include the state and, if relevant, whether federal or state law controls, and any specific court or agency.',
    type: 'text',
    required: true,
    placeholder: 'e.g., California (state law); U.S. District Court, S.D.N.Y. (federal question)',
  },
  {
    id: 'relevantFacts',
    question: 'Relevant facts',
    description: 'The material facts that bear on the legal analysis. Include dates, parties, and the conduct at issue. Facts you omit may affect the conclusion.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Client is a residential tenant who vacated a San Francisco apartment in good condition in March 2025. Landlord has not returned the $3,000 security deposit or provided an itemized statement within 21 days...',
  },
  {
    id: 'knownAuthorities',
    question: 'Authorities already identified (optional)',
    description: 'Cases, statutes, or regulations you have already found. The memo will incorporate them. Leave blank to let the analysis identify controlling authority.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Cal. Civ. Code § 1950.5; Granberry v. Islay Invs. (1995) 9 Cal.4th 738',
  },
  {
    id: 'proposedPosition',
    question: 'Proposed legal position',
    description: 'The legal conclusion you are considering or need to document.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Landlord is liable for statutory damages of up to twice the deposit amount under Civil Code § 1950.5(l) because the itemized statement was not provided within 21 days',
  },
  {
    id: 'memoRecipient',
    question: 'Memo recipient / use',
    description: 'Who will read this memo and for what purpose? Used to calibrate the level of explanation.',
    type: 'text',
    required: false,
    placeholder: 'e.g., Senior partner — for client advice letter; Internal file; Preparation for motion',
  },
];

const legalResearchMemoPrompt = `You are assisting a licensed attorney in drafting a legal research memo. You are not providing legal advice — you are helping the attorney organize and document the legal analysis, which the attorney will review, edit, and rely on at their own professional judgment.

Research question: {{researchQuestion}}
Jurisdiction: {{jurisdiction}}
Relevant facts: {{relevantFacts}}
Authorities already identified: {{knownAuthorities}}
Proposed legal position: {{proposedPosition}}
Memo recipient / use: {{memoRecipient}}

Produce a formatted legal research memo in Markdown. Begin with the draft notice.

> **Draft document** — Review all citations before relying on this memo. See the Citations table at the end.

---

## Legal Research Memo

**Issue:** {{researchQuestion}}
**Jurisdiction:** {{jurisdiction}}
**Short answer:** [One to three sentences. State the conclusion directly. Note the confidence level — e.g., "well-settled," "likely," "uncertain" — and the key authority on which it rests.]
**Date:** [Date]
**Prepared for:** {{memoRecipient}}

---

### Facts

[State the material facts in neutral, past-tense third person. Organize them chronologically or by logical grouping. Flag any facts that are unclear, contested, or that may need further development from the client.]

---

### Analysis

#### Applicable Law

[Identify the controlling statutes, regulations, and common-law rules. For each authority, state the rule it establishes and how it applies to the question presented. Where there is a clear hierarchy of authority (constitutional, statutory, regulatory, case law), observe it.]

#### Application to Facts

[Apply the controlling law to the specific facts stated above. Walk through the analysis step by step. Where the answer is clear, say so. Where it is uncertain, explain what turns the analysis and what additional facts or authorities would resolve it.]

#### Counterarguments and Risks

[Identify the strongest arguments against the proposed position. For each, explain why it does not control, or flag it as a genuine risk if it is substantial. A memo that acknowledges real risks protects the attorney and the client.]

---

### Conclusion

[State the conclusion directly. Express the confidence level using standard legal terminology (e.g., "clearly established," "more likely than not," "substantial question"). Identify any conditions, caveats, or open factual questions that could change the conclusion.]

---

### Citations — Verify Before Relying

The following citations were generated by AI. Verify each against Westlaw, Lexis, or primary authority before sharing with a client or filing.

| Status | Citation | AI summary | Verified by |
|--------|----------|-----------|-------------|
| ⬜ UNVERIFIED | [case or statute] | [AI summary of what it holds or says] | ____________ |

*Change ⬜ to ✅ after each verification. Do not share this memo until all citations show ✅.*

---

*This memo was generated by ${BRAND.messaging.redlineAuthor} and requires attorney review. It is not legal advice.*`;

export const LegalResearchMemo: WorkflowTemplate = {
  id: 'legal-research-memo',
  name: 'Legal Research Memo',
  description: 'Drafts a legal research memo on a specified question and jurisdiction, with sections for Issue, Facts, Analysis (applicable law, application, counterarguments), Conclusion, and a mandatory citation quarantine table. Every AI-supplied citation is placed in an UNVERIFIED table for attorney verification before the memo is shared.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Verify every citation in the table at the end against Westlaw, Lexis, or primary authority. Change the status from UNVERIFIED to verified after each check. Do not share this memo with a client or file it until all citations have been independently confirmed.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Research Question Details',
      description: 'Describe the legal question, jurisdiction, facts, and any authorities already identified',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-research-memo',
      type: 'generate',
      name: 'Generate Legal Research Memo',
      description: 'Draft the research memo with analysis and citation quarantine table',
      config: {
        outputFile: 'LEGAL_RESEARCH_MEMO.docx',
        promptTemplate: legalResearchMemoPrompt,
        systemPrompt: 'You are a legal research assistant helping a licensed attorney draft a research memo. You write with precision about the distinction between statutory rules, case holdings, regulatory guidance, and dicta. You always note when an answer is jurisdiction-specific or uncertain. You never overstate the strength of a position.\n\nCRITICAL CITATION DISCIPLINE: Every case name, statute, regulation, and ruling you cite in this memo is unverified AI output until the attorney independently confirms it against a primary source. You must place every citation into the Citations table at the end of the memo with the status "⬜ UNVERIFIED". Do not omit any citation from that table — if you cite it in the Analysis section, it must also appear in the table. Case names, docket numbers, statute section numbers, and regulatory citations from AI training data may contain errors. The attorney changes each ⬜ to ✅ only after verifying the citation against Westlaw, Lexis, or the primary source. The memo should not be shared with a client or filed until all citations show ✅.\n\nWhen jurisdictional law informs an entry, note that the applicable standards must be verified against current statutes and case law for the specific jurisdiction — law changes and AI training data has a cutoff date.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['LEGAL_RESEARCH_MEMO.docx'],
  namedOutputs: [
    { id: 'research_memo', name: 'Legal research memo', schema: 'string' },
    { id: 'citations', name: 'Citations requiring verification', schema: 'array' },
    { id: 'conclusion', name: 'Research conclusion', schema: 'string' },
  ],
};

export default LegalResearchMemo;
