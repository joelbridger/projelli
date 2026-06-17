// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

// NOTE: `category: 'legal'` requires adding 'legal' to the WorkflowTemplate category
// union in src/platform/types/workflow.ts before this template is registered.

import type { WorkflowTemplate, InterviewStepConfig, AnalyzeStepConfig } from '@/platform/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'matterName',
    question: 'Matter name',
    description: 'The case or matter name as you track it in your files.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Smith v. Acme Corp.',
  },
  {
    id: 'witnessName',
    question: 'Witness name',
    description: 'Full name of the deponent whose transcript you are analyzing.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Jane Doe',
  },
  {
    id: 'depositionDate',
    question: 'Deposition date',
    description: 'Date the deposition was taken. Used for citation purposes in the output.',
    type: 'text',
    required: true,
    placeholder: 'e.g., May 15, 2026',
  },
  {
    id: 'keyClaimsToScrutinize',
    question: 'Key claims to scrutinize',
    description: 'The specific factual assertions or storyline elements you want to test for consistency. Be specific — the more targeted this list, the more useful the output.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Witness claims she never received the email. Witness claims the meeting on March 3 never happened. Witness claims she had no supervisory role over the plaintiff.',
  },
  {
    id: 'depositionExcerpts',
    question: 'Deposition transcript excerpts',
    description: 'Paste the relevant portions of the deposition transcript. Include page and line numbers (e.g., "P. 42:3-18") for each excerpt — the analysis will reference them. You can paste multiple excerpts; separate them with a blank line.',
    type: 'textarea',
    required: true,
    placeholder: 'P. 42:3-18\nQ: Did you receive the email?\nA: No, I never received anything from him.\n\nP. 87:9-21\nQ: How often did you communicate with the plaintiff?\nA: Rarely. Maybe once or twice a quarter.',
  },
  {
    id: 'priorStatements',
    question: 'Prior statements to compare against (optional)',
    description: 'Paste excerpts from earlier sworn statements, affidavits, interrogatory answers, or prior deposition testimony. If none, leave blank. Including these allows the analysis to flag contradictions between this deposition and earlier statements.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Affidavit dated January 10, 2026: "I received the email from Mr. Johnson and forwarded it to my supervisor immediately."',
  },
];

// WS-D — The retrieval query that pulls the matter's record (the deposition the
// user is testing plus the matter's other documents/emails) from the local,
// matter-scoped, privilege-excluded RAG store. The structured findings are
// grounded ONLY in what comes back here plus the pasted excerpts.
const retrievalQueryTemplate = `Testimony and statements by {{witnessName}} relevant to: {{keyClaimsToScrutinize}}. Deposition excerpts: {{depositionExcerpts}}. Prior statements: {{priorStatements}}`;

// The analysis prompt. `{{retrievedContext}}` is the engine-supplied numbered
// list of matter-scoped sources. The model must cite each statement by its
// source NUMBER so the engine can recover a verifiable citation id and confirm
// it against the store — the model never invents citation ids.
const contradictionFinderPrompt = `You are a tireless first-year associate assisting a licensed attorney. You FLAG candidate contradictions for the attorney to verify. You do not render judgments and you never provide legal advice. Your job is to organize the record so the attorney can exercise their own judgment.

Matter: {{matterName}}
Witness: {{witnessName}}
Deposition date: {{depositionDate}}

Key claims the attorney wants scrutinized:
{{keyClaimsToScrutinize}}

Deposition transcript excerpts the attorney pasted:
{{depositionExcerpts}}

Prior statements the attorney pasted to compare against:
{{priorStatements}}

Below is additional context retrieved from THIS MATTER's documents and emails. Each source is numbered [N]. When you quote a statement, cite the source NUMBER it came from.

{{retrievedContext}}

Identify candidate contradictions between the witness's testimony and other statements (elsewhere in the testimony, in prior statements, or in the retrieved matter sources). For EACH candidate contradiction return a finding with:
  - statementA: the first statement, with the exact quote and the source NUMBER [N] it came from.
  - statementB: the conflicting statement, with the exact quote and the source NUMBER [N] it came from.
  - conflictRationale: a plain-language explanation of why they conflict.
  - topic: a short heading grouping the finding.
  - followUpQuestions: optional follow-up deposition questions.

Rules:
  - Only cite statements that actually appear in the material above. If a quote is not in any numbered source, set its sourceNumber to 0. Never fabricate a citation.
  - Do NOT invent contradictions. If the record does not support a conflict, do not report one. An empty findings list is a valid, honest answer.
  - Quote exactly; do not paraphrase inside the quote field.`;

export const DepositionContradictionFinder: WorkflowTemplate = {
  id: 'legal-deposition-contradiction-finder',
  name: 'Deposition Contradiction Finder',
  description: 'Flag candidate contradictions between a witness\'s deposition testimony and the rest of the matter record (other documents, emails, prior statements). Grounded in matter-scoped retrieval; every finding carries a citation you verify. Produces a structured Word deliverable.',
  version: '2.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Verify every flagged contradiction against the original transcript before use. AI can misread nuance, context, or page breaks.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Deposition Details',
      description: 'Provide the transcript excerpts and the key claims you want scrutinized',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'analyze-contradictions',
      type: 'analyze',
      name: 'Flag Contradictions (cited)',
      description: 'Retrieve the matter record, flag candidate contradictions, verify each citation, and produce a Word deliverable',
      config: {
        analyzeKind: 'contradictions',
        outputFile: 'Deposition Contradiction Analysis.docx',
        retrievalQueryTemplate,
        topK: 12,
        // F-510 — per-source diversity cap: at most 4 of the 12 retrieved
        // chunks may come from any single source document, so one large
        // low-signal file cannot drown out the deposition/summary sides the
        // finder needs to cite both halves of a contradiction.
        perSourceCap: 4,
        // VG-3b — these interview answers are attorney-pasted material the
        // analysis honestly falls back to when workspace retrieval is down.
        pastedInputIds: ['depositionExcerpts', 'priorStatements'],
        promptTemplate: contradictionFinderPrompt,
        documentTitle: 'Deposition Contradiction Analysis: {{witnessName}}',
        verificationBanner:
          'Each finding below was flagged by an AI associate and carries a citation. Verify every quote and page/line reference against the original transcript and source before relying on it.',
        systemPrompt:
          'You are a methodical, citation-focused legal research assistant helping a licensed attorney organize and analyze deposition testimony. You never provide legal advice and always frame your output as a starting point for the attorney\'s review. You do not speculate beyond what the record supports, and you never fabricate a citation. If the record is ambiguous, you note the ambiguity rather than resolve it.',
      } as AnalyzeStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['Deposition Contradiction Analysis.docx'],
  namedOutputs: [
    { id: 'contradictions', name: 'Contradiction findings', schema: 'array' },
    { id: 'followup_questions', name: 'Suggested follow-up questions', schema: 'array' },
  ],
};

export default DepositionContradictionFinder;
