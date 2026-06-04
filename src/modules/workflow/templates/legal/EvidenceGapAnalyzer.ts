// @draft — Legal Practice Pack v2.1
// Requires attorney review before shipping. Do not expose to users without review.

// NOTE: `category: 'legal'` requires adding 'legal' to the WorkflowTemplate category
// union in src/types/workflow.ts before this template is registered.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'practiceArea',
    question: 'Practice area',
    description: 'The area of law governing this matter. Affects which evidence categories and discovery mechanisms are most relevant.',
    type: 'select',
    required: true,
    options: ['Civil litigation', 'Criminal defense', 'Family law', 'Employment', 'IP', 'Other'],
    defaultValue: 'Civil litigation',
  },
  {
    id: 'caseSummary',
    question: 'Brief case summary',
    description: 'A few sentences describing the facts and posture of the matter — who the parties are, what happened, and where you are in the litigation.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Plaintiff is a former employee alleging wrongful termination in retaliation for an internal safety complaint. Defendant is a mid-size manufacturer. We represent the plaintiff. Case is in early discovery.',
  },
  {
    id: 'legalTheory',
    question: 'Legal theory being pursued',
    description: 'The specific cause(s) of action or defense theory. Include the elements you need to establish.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Retaliation under OSHA section 11(c). Elements: (1) protected activity, (2) adverse employment action, (3) causal connection. Also pleading state wrongful discharge claim.',
  },
  {
    id: 'evidenceInHand',
    question: 'Evidence currently in hand',
    description: 'List or describe what you already have — documents, witnesses, physical evidence, expert opinions, admissions. Be specific. The analysis is only as good as what you tell it you have.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Client\'s written safety complaint (dated March 5), termination letter (April 2), two co-worker witnesses willing to testify, client\'s personnel file (partial), email chain re: performance review.',
  },
  {
    id: 'burdenOfProof',
    question: 'Burden of proof standard',
    description: 'The applicable standard determines how strong the evidence needs to be to succeed.',
    type: 'select',
    required: true,
    options: ['Preponderance of the evidence', 'Clear and convincing evidence', 'Beyond a reasonable doubt'],
    defaultValue: 'Preponderance of the evidence',
  },
  {
    id: 'jurisdiction',
    question: 'Jurisdiction',
    description: 'State/federal court and circuit or district. Affects discovery rules, evidence standards, and procedural deadlines.',
    type: 'text',
    required: true,
    placeholder: 'e.g., S.D.N.Y., federal court, Second Circuit',
  },
];

const evidenceGapPrompt = `You are assisting a licensed attorney in identifying gaps in the evidence supporting their legal theory. You are not providing legal advice — you are helping the attorney systematically map what is missing and where to look.

Practice area: {{practiceArea}}
Case summary: {{caseSummary}}
Legal theory: {{legalTheory}}
Evidence currently in hand: {{evidenceInHand}}
Burden of proof: {{burdenOfProof}}
Jurisdiction: {{jurisdiction}}

Produce a Markdown evidence gap analysis structured as follows:

> **Draft document** — Review and edit before use in any matter.

# Evidence Gap Analysis
**Practice area:** {{practiceArea}}
**Burden of proof:** {{burdenOfProof}}
**Jurisdiction:** {{jurisdiction}}
**Prepared for attorney review:** [date]

---

## Theory Checklist
List each element of the legal theory and note whether the current evidence in hand addresses it, partially addresses it, or leaves it uncovered.

| Element | Coverage | Evidence addressing it |
|---------|----------|----------------------|
| [Element 1] | Full / Partial / Gap | [Evidence] |
| [Element 2] | Full / Partial / Gap | [Evidence] |

---

## Evidence Gaps by Category

### Direct Evidence
[Identify what direct evidence is missing and why it matters to the theory]

**Priority:** High / Medium / Low
**Suggested discovery targets:** [List specific requests, depositions, or sources to pursue]

### Circumstantial Evidence
[Identify circumstantial evidence gaps]

**Priority:** High / Medium / Low
**Suggested discovery targets:**

### Documentary Evidence
[Identify missing documents — emails, contracts, records, policies, financial records, etc.]

**Priority:** High / Medium / Low
**Suggested discovery targets:**

### Witness Evidence
[Identify witnesses not yet identified or deposed who may have relevant knowledge]

**Priority:** High / Medium / Low
**Suggested discovery targets:**

---

## Alternative Theories
If certain gaps cannot be filled, consider these alternative or supplemental theories:
- [Theory 1]: [Brief rationale and what evidence would be needed]
- [Theory 2]: [Brief rationale and what evidence would be needed]

---

## Discovery Priorities (Ranked)
1. [Most urgent — why]
2. [Second priority — why]
3. [Third priority — why]

---

*This analysis is a starting point for your review. Assess each gap against your knowledge of the record and applicable law before acting on any suggestion.*`;

export const EvidenceGapAnalyzer: WorkflowTemplate = {
  id: 'legal-evidence-gap-analyzer',
  name: 'Evidence Gap Analyzer',
  description: 'Given a legal theory and the evidence currently in hand, identify what is missing, what would strengthen the case, and where to look. Produces a gap analysis organized by evidence category with discovery priorities.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Verify this output against applicable law and professional standards before use in client matters.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Case Theory and Evidence Inventory',
      description: 'Describe your legal theory and what evidence you have so far',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-analysis',
      type: 'generate',
      name: 'Generate Evidence Gap Analysis',
      description: 'Identify evidence gaps and prioritize discovery targets',
      config: {
        outputFile: 'EVIDENCE_GAP_ANALYSIS.md',
        promptTemplate: evidenceGapPrompt,
        systemPrompt: 'You are a legal research assistant helping a licensed attorney map the evidentiary landscape of a matter. You think in terms of elements, burdens, and proof — but you never give legal advice and always frame your output as a starting point for the attorney\'s judgment. You are specific about what is missing and practical about where to look. If the practice area affects the analysis meaningfully, acknowledge how.\n\nEVIDENCE GROUNDING DISCIPLINE: Identify gaps and strengths based on the documents, facts, and evidence the attorney has described. Do not assert that a piece of evidence definitively exists or does not exist without a document basis from the information provided. When you reference legal standards, case law, or statutory requirements to frame the analysis, note that these references must be verified against primary authority before relying on them. Clearly distinguish between observations grounded in the provided record versus general legal knowledge from your training data.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['EVIDENCE_GAP_ANALYSIS.md'],
  namedOutputs: [
    { id: 'evidence_gaps', name: 'Evidence gaps by category', schema: 'array' },
    { id: 'discovery_priorities', name: 'Discovery priorities', schema: 'array' },
    { id: 'alternative_theories', name: 'Alternative theories', schema: 'array' },
  ],
  namedInputs: [
    {
      id: 'case_summary',
      name: 'Case summary',
      schema: 'string',
      acceptsOutputFrom: ['matter_summary'],
    },
  ],
};

export default EvidenceGapAnalyzer;
