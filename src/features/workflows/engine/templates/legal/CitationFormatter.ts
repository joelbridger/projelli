// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'rawCitations',
    question: 'Raw citations to format',
    description: 'Paste your raw citations, one per line. Include cases, statutes, regulations, constitutional provisions, secondary sources, and any other authorities. The more complete information you provide (full case name, volume, reporter, first page, year, court), the more accurate the formatted citation.',
    type: 'textarea',
    required: true,
    placeholder: `e.g.:
Brown v. Board of Education, 347 US 483 (1954)
42 USC 1983
Fed R Civ P 56
Restatement Second of Torts section 402A
Prosser and Keeton on Torts (5th ed 1984) p. 695
Texas Penal Code 22.01
Bell Atl. Corp. v. Twombly, 550 U.S. 544 (2007)`,
  },
  {
    id: 'documentType',
    question: 'Document type',
    description: 'What type of document will these citations appear in? Bluebook format varies for briefs vs. law review articles vs. memoranda.',
    type: 'select',
    required: true,
    options: [
      'Court brief or motion (practitioner format)',
      'Legal memorandum (practitioner format)',
      'Law review or academic article',
      'Contract or transactional document',
    ],
  },
  {
    id: 'jurisdiction',
    question: 'Court / jurisdiction (for local citation rules)',
    description: 'The court where the document will be filed, if applicable. Some courts require specific citation formats that differ from standard Bluebook.',
    type: 'text',
    required: false,
    placeholder: 'e.g., U.S. District Court, S.D.N.Y.; Texas Court of Appeals, 3rd District; California Superior Court',
  },
  {
    id: 'toaRequired',
    question: 'Generate Table of Authorities?',
    description: 'Select whether to generate a Table of Authorities from the formatted citations.',
    type: 'select',
    required: true,
    options: [
      'Yes — generate a complete TOA',
      'No — formatted citations only',
    ],
  },
  {
    id: 'additionalInstructions',
    question: 'Additional formatting instructions (optional)',
    description: 'Any specific formatting preferences or local rules that override standard Bluebook. For example: whether to use large and small caps for secondary sources, whether court rules require underlining vs. italics for case names, or any other special instructions.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Court requires underlining for case names, not italics; use abbreviations per local rule X; omit "at" before page numbers',
  },
];

const citationFormatterPrompt = `You are assisting a licensed attorney in formatting legal citations into Bluebook style and generating a Table of Authorities. You are not providing legal advice — you are formatting citations based on the information provided by the attorney. The attorney must verify every formatted citation against the current Bluebook edition and the original source before filing.

Raw citations: {{rawCitations}}
Document type: {{documentType}}
Court / jurisdiction: {{jurisdiction}}
Generate TOA: {{toaRequired}}
Additional instructions: {{additionalInstructions}}

Produce formatted citations and, if requested, a Table of Authorities in Markdown. Begin with the draft notice.

> **Draft document** — Verify every formatted citation against the current Bluebook edition before filing. Check page numbers, dates, reporter abbreviations, and all formatting details independently. Bluebook rules change across editions and AI can make formatting errors.

---

## Citation Formatting

**Document type:** {{documentType}}
**Court / jurisdiction:** {{jurisdiction}}

---

### Formatted Citations

For each raw citation provided, produce:
1. The Bluebook-formatted citation for the document type selected (practitioner/brief format or law review format as applicable)
2. A brief note flagging any information that was missing from the input and that the attorney should verify (e.g., "Verify: exact reporter abbreviation, first page number, parenthetical")
3. A verification flag if the citation involves an older source or a format that is particularly prone to AI error (e.g., specific secondary source editions, foreign citations, agency materials)

Format each entry as follows:

**[Number]. Raw input:**
> [quote the raw citation as provided]

**Formatted (Bluebook {{documentType}}):**
> [formatted citation]

**Verify:** [note what must be confirmed — page numbers, reporter, court, year, etc.]

---

[Repeat for all citations provided.]

---

### Formatting Notes

- Note any citations where the raw input lacked information needed for a complete Bluebook citation, and what the attorney must supply.
- Note any citations that follow a less common Bluebook rule (e.g., older statutes, administrative decisions, foreign materials, restatements, model codes) where AI formatting is especially prone to error.
- Note the Bluebook rules applied for the major citation types (cases, statutes, regulations, secondary sources) so the attorney can verify against the current edition.

---

If {{toaRequired}} indicates that a Table of Authorities is required, include the following section. If {{toaRequired}} indicates formatted citations only, omit this entire Table of Authorities section.

### Table of Authorities

Produce a complete Table of Authorities in standard court format. Organize citations into the standard categories. Within each category, list citations in the order they should appear (cases: alphabetically or as first cited; statutes/regs: by code section; secondary sources: alphabetically).

**Cases**

| Citation | Pages |
|----------|-------|
[For each case: formatted citation and a "p. __" placeholder for the attorney to fill in the page(s) where the case appears in the brief]

**Constitutional Provisions**

[If any constitutional provisions were cited]

**Statutes**

| Citation | Pages |
|----------|-------|
[For each statute]

**Regulations**

| Citation | Pages |
|----------|-------|
[For each regulation]

**Rules**

| Citation | Pages |
|----------|-------|
[For court rules, procedural rules, etc.]

**Secondary Sources**

| Citation | Pages |
|----------|-------|
[Restatements, treatises, law review articles, etc.]

*Note: Fill in the "Pages" column with the page numbers where each authority appears in your document before filing. Verify all formatted citations against the current Bluebook before submitting the TOA.*

---

*Citation formatting produced by ${BRAND.messaging.redlineAuthor}. Verify every citation against the current Bluebook edition before filing. AI formatting is a starting point — do not rely on it without independent verification.*`;

export const CitationFormatter: WorkflowTemplate = {
  id: 'citation-formatter',
  name: 'Bluebook Citation Formatter and TOA',
  description: 'Formats raw citations into Bluebook style and generates a Table of Authorities draft. Verify formatted citations before filing — Bluebook rules change and AI can make formatting errors.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Verify every formatted citation against the current Bluebook edition before filing. Check page numbers, dates, and reporter abbreviations independently.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Citations to Format',
      description: 'Paste raw citations, select document type, and indicate whether a TOA is needed',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-citations',
      type: 'generate',
      name: 'Format Citations and Generate TOA',
      description: 'Produce Bluebook-formatted citations and optional Table of Authorities',
      config: {
        outputFile: 'CITATIONS_AND_TOA.docx',
        promptTemplate: citationFormatterPrompt,
        systemPrompt: 'You are a legal citation formatting assistant helping a licensed attorney format citations into Bluebook style. You apply Bluebook rules carefully for the document type specified (practitioner format for briefs/memos; law review format for academic articles). For each citation: produce the formatted version, note what information was missing from the raw input, and flag any element the attorney should independently verify (reporter abbreviation, page number, year, court, edition). You are aware that AI citation formatting is error-prone — especially for older cases, secondary sources with specific edition requirements, administrative materials, and foreign citations. Always flag these prominently. Never omit a verification note. If generating a TOA, organize by standard category and include page number placeholders. Avoid em dashes. Be precise and direct.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['CITATIONS_AND_TOA.docx'],
  namedOutputs: [
    { id: 'formatted_citations', name: 'Bluebook-formatted citations', schema: 'array' },
    { id: 'table_of_authorities', name: 'Table of Authorities draft', schema: 'string' },
    { id: 'verification_flags', name: 'Citations requiring verification', schema: 'array' },
  ],
};

export default CitationFormatter;
