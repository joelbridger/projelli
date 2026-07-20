// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'matterSummary',
    question: 'Client summary',
    description: 'A brief description of the case: what happened, what the core dispute is, and what the client is seeking or defending against.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Plaintiff alleges wrongful termination and retaliation after reporting workplace safety violations. Client (defendant employer) contends termination was for documented performance reasons unrelated to the report.',
  },
  {
    id: 'opposingParty',
    question: 'Opposing party description',
    description: 'Who the discovery is directed to, what they know, and what documents or information they likely have.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Plaintiff Sarah Chen — former employee with 4 years tenure in accounting. Likely has personal records, communications with HR, and medical/mental health records related to alleged emotional distress.',
  },
  {
    id: 'discoveryType',
    question: 'Discovery type',
    description: 'What type of discovery you are drafting.',
    type: 'select',
    required: true,
    options: [
      'Interrogatories',
      'Requests for Production (RFP)',
      'Requests for Admission (RFA)',
      'All three types',
    ],
  },
  {
    id: 'claimsAndDefenses',
    question: 'Key claims and defenses',
    description: 'The causes of action asserted and the defenses you are developing. Discovery should track these directly.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Claims: wrongful termination in violation of public policy; retaliation under Labor Code 1102.5; intentional infliction of emotional distress. Defenses: legitimate non-retaliatory reason for termination; no protected activity; failure to mitigate.',
  },
  {
    id: 'jurisdiction',
    question: 'Jurisdiction and court',
    description: 'The state and court where the action is pending. Interrogatory limits, RFA procedures, and other discovery rules vary significantly by jurisdiction.',
    type: 'text',
    required: true,
    placeholder: 'e.g., California Superior Court, Los Angeles County; U.S. District Court, C.D. Cal.',
  },
  {
    id: 'specificTopics',
    question: 'Specific topics or documents to target (optional)',
    description: 'Any specific areas you want covered that might not be obvious from the claims summary. Known documents, witnesses, dates, or transactions to focus on.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Performance review records for the 12 months before termination; HR investigation file; communications between plaintiff and supervisor Rodriguez between Jan-March 2024',
  },
];

const discoveryDrafterPrompt = `You are assisting a licensed attorney in drafting discovery requests. You are not providing legal advice — you are producing a numbered draft for attorney review and adaptation. The attorney will verify compliance with applicable court rules and standing orders before serving.

Client summary: {{matterSummary}}
Opposing party: {{opposingParty}}
Discovery type: {{discoveryType}}
Key claims and defenses: {{claimsAndDefenses}}
Jurisdiction and court: {{jurisdiction}}
Specific topics to target: {{specificTopics}}

Produce a numbered draft in Markdown. Begin with the draft notice.

> **Draft document** — Review every discovery request against applicable court rules, local rules, standing orders, and your case strategy before serving. AI-drafted discovery may miss case-specific facts or applicable rules.

---

## Discovery Draft — {{discoveryType}}

**Client file:** [Describe briefly based on inputs]
**Directed to:** {{opposingParty}}
**Jurisdiction:** {{jurisdiction}}

---

### Definitions and Instructions

[Provide standard definitions applicable to the discovery type: "You" and "Your" mean the responding party and their agents, attorneys, and representatives. "Document" means... "Communication" means... "Identify" means... Tailor to the discovery type. Note that the attorney should verify these definitions conform to local rules and the court's standing orders.]

---

[Then produce the numbered discovery requests. For each request or interrogatory:]

**[Number]. [Request text]**

*Strategic note: [One sentence explaining what this request targets and why it matters to the claims or defenses.]*

[For interrogatories: produce 15-25 interrogatories covering background, the core facts of each claim or defense, damages, and document identification. Note the applicable limit for the jurisdiction and flag if the draft exceeds it.]

[For RFPs: produce 20-30 requests organized by topic: the core events, damages documents, communications, ESI, and any specific topics identified by the attorney.]

[For RFAs: produce 15-20 requests targeting undisputed facts, authenticity of documents, and admissions that narrow the issues. RFAs should be simple and unambiguous — one fact per request.]

[If "all three types" was selected: produce all three sections with clear headers separating them.]

---

### Court Rules Notes

Note the interrogatory limit for {{jurisdiction}} if known. Flag any jurisdiction-specific discovery rules the attorney should confirm before serving (e.g., mandatory meet-and-confer, ESI protocols, timing requirements). Mark these as requiring attorney verification.

---

*This discovery draft was produced by ${BRAND.messaging.redlineAuthor} and requires attorney review before serving. Verify compliance with all applicable court rules, local rules, and standing orders.*`;

export const DiscoveryDrafter: WorkflowTemplate = {
  id: 'discovery-drafter',
  name: 'Discovery Drafter',
  description: 'Drafts interrogatories, requests for production, or requests for admission from a case summary. Produces a numbered draft you review and adapt to your case.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Review every discovery request against applicable court rules (local rules, standing orders) and your case strategy before serving. AI-drafted discovery may miss case-specific facts or applicable rules.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Case and Discovery Details',
      description: 'Provide the client summary, opposing party, discovery type, and key claims and defenses',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-discovery',
      type: 'generate',
      name: 'Generate Discovery Requests',
      description: 'Draft numbered discovery requests with strategic notes',
      config: {
        outputFile: 'DISCOVERY_DRAFT.docx',
        promptTemplate: discoveryDrafterPrompt,
        systemPrompt: 'You are a litigation support assistant helping a licensed attorney draft discovery requests. You write numbered, properly formatted discovery requests that are specific, unambiguous, and proportionate to the needs of the case. For each request, add a brief strategic note explaining what it targets and why. For interrogatories: cover background, facts, damages, and document identification. For RFPs: organize by topic and cover communications, documents, and ESI. For RFAs: focus on single, undisputable facts and authenticity. Always note when requests may be subject to a numerical limit and flag court-rule compliance issues for attorney verification. Avoid compound questions in RFAs. Avoid em dashes. Be precise and direct.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['DISCOVERY_DRAFT.docx'],
  namedOutputs: [
    { id: 'discovery_requests', name: 'Discovery requests draft', schema: 'string' },
    { id: 'strategic_notes', name: 'Strategic notes per request', schema: 'array' },
    { id: 'court_rules_flags', name: 'Court rules flags for verification', schema: 'array' },
  ],
};

export default DiscoveryDrafter;
