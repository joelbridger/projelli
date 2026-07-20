// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full legal name of the client. For an entity, include the entity type (LLC, Corp, etc.).',
    type: 'text',
    required: true,
    placeholder: 'e.g., Sarah M. Ortega; Meridian Holdings LLC',
  },
  {
    id: 'matterType',
    question: 'Client work type',
    description: 'A brief description of the client work. This will appear in the scope of representation.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Residential real estate purchase — 412 Oak Street, Austin TX; Business formation and operating agreement',
  },
  {
    id: 'scopeOfRepresentation',
    question: 'Scope of representation',
    description: 'What work is included. Be specific about what is and is not covered. A precise scope protects the client and the firm.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Review and negotiate purchase agreement and all closing documents; coordinate with title company; attend closing. Excluded: tax advice, homeowner association review, survey disputes.',
  },
  {
    id: 'feeStructure',
    question: 'Fee structure',
    description: 'How the attorney is compensated. Include the rate, billing frequency, retainer amount if any, and any special terms.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Flat fee of $1,500 due at signing; OR Hourly at $350/hour, billed monthly, with a $1,500 retainer applied against the first invoices; OR Contingency: 33.3% of gross recovery before trial',
  },
  {
    id: 'firmName',
    question: 'Firm name and attorney name',
    description: 'Your firm name and the name of the responsible attorney. Used in the letter header and AI disclosure section.',
    type: 'text',
    required: true,
    placeholder: 'e.g., The Law Office of Marcus Webb; Webb & Chen LLP',
  },
  {
    id: 'aiToolsUsed',
    question: 'AI tools used in this engagement (for the disclosure clause)',
    description: 'Describe how AI tools are used in your practice for this type of work. This goes into the required AI disclosure section. Be specific enough to satisfy ABA Opinion 512.',
    type: 'textarea',
    required: true,
    placeholder: `e.g., The firm uses ${BRAND.name}, a local-first AI writing tool, to help draft documents and research memos. All AI-generated content is reviewed and edited by the responsible attorney before use. Client files are processed locally on the attorney's computer and are not transmitted to or stored by any third-party AI provider.`,
  },
  {
    id: 'additionalTerms',
    question: 'Additional terms or firm-specific clauses (optional)',
    description: 'Any additional terms you want to include: limitation of liability, file retention policy, dispute resolution, termination clause, etc.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Files will be retained for 7 years after client work closes; disputes submitted to binding arbitration in Travis County, Texas',
  },
];

const engagementLetterPrompt = `You are assisting a licensed attorney in drafting an engagement letter. You are not providing legal advice — you are producing a draft that the attorney will review, edit, and adapt to their firm's standard terms before sending.

Client name: {{clientName}}
Client work type: {{matterType}}
Scope of representation: {{scopeOfRepresentation}}
Fee structure: {{feeStructure}}
Firm name and attorney: {{firmName}}
AI tools used in this engagement: {{aiToolsUsed}}
Additional terms: {{additionalTerms}}

Produce a complete engagement letter draft in Markdown. Begin with the draft notice.

> **Draft document** — Review all scope, fee, and limitation-of-liability language against your firm's standard terms before sending. Confirm the AI Disclosure and Consent section meets your jurisdiction's specific consent requirements.

---

## Engagement Letter

[Firm letterhead placeholder — insert firm name, address, phone, email]

[Date]

{{clientName}}
[Client address — insert]

**Re: Engagement for Legal Services — {{matterType}}**

Dear {{clientName}},

Thank you for selecting {{firmName}} to represent you in connection with the above-referenced client work. This letter confirms the terms of our representation and asks for your agreement to those terms.

---

### 1. Scope of Representation

[Firmname] agrees to represent {{clientName}} in connection with: {{scopeOfRepresentation}}

This engagement does not include representation in any other client work unless agreed in a separate written engagement. If additional legal issues arise during the engagement, we will discuss whether our representation extends to those issues before proceeding.

---

### 2. Fees and Billing

{{feeStructure}}

[Expand fee terms as appropriate for the structure stated above. If flat fee: state what is included and whether the fee is refundable if the client work ends early. If hourly: state billing increments, invoice timing, and what happens if the retainer is exhausted. If contingency: state what expenses are deducted and when.]

You will be billed for reasonable out-of-pocket expenses incurred on your behalf, including filing fees, service of process, court reporter fees, and similar costs, which are separate from attorney's fees.

---

### 3. Your Responsibilities

To allow us to represent you effectively, we ask that you:

- Respond to our requests for information and documents promptly;
- Keep us informed of any changes to your contact information;
- Review all documents we send you and notify us of any inaccuracies; and
- Pay invoices within [30] days of receipt.

---

### 4. Termination

Either party may terminate this engagement at any time by written notice. If you terminate the engagement, you will be responsible for fees and expenses incurred through the date of termination. If we terminate, we will take reasonable steps to protect your interests and will give you reasonable notice to retain other counsel.

---

If {{additionalTerms}} contains firm-specific terms, include the following section. If it is blank or says there are no additional terms, omit this section and keep the remaining headings sensible.

### 5. Additional Terms

{{additionalTerms}}

---

### AI Disclosure and Consent

**Use of AI Tools in This Engagement**

{{firmName}} uses artificial intelligence tools to assist with certain aspects of legal work, including document drafting, research organization, and review preparation. Specifically: {{aiToolsUsed}}

In keeping with ABA Formal Opinion 512 (2024) and our duties of competence (Rule 1.1) and confidentiality (Rule 1.6), we disclose the following:

**What AI tools do in this engagement:** AI tools assist the responsible attorney by drafting initial versions of documents, organizing research, and identifying issues for attorney review. All AI-generated content is reviewed, edited, and approved by the responsible attorney before it is sent to you or filed on your behalf. AI tools do not make legal decisions.

**How your information is handled:** [Firm] uses ${BRAND.name}, a local-first AI writing tool. Your client information and client work details are processed locally on our firm's computers and are not transmitted to or stored by third-party AI service providers as part of our use of ${BRAND.name}. [If you use additional AI tools with cloud processing, describe that here and identify what data is sent and to whom.]

**Your right to opt out:** You have the right to object to the use of AI tools in your representation. If you prefer that we not use AI tools, please tell us before signing this letter and we will discuss how to proceed.

**Consent:** By signing this letter, you consent to our use of AI tools as described above, subject to our ongoing duty to keep your information confidential and to review all AI-assisted work product before use.

---

### Acceptance

This letter describes the terms of our engagement. Please sign and return a copy to indicate your agreement. If you have questions about any provision, please contact us before signing.

We look forward to working with you.

Sincerely,

[Attorney signature]
[Attorney name]
{{firmName}}

---

**CLIENT ACCEPTANCE**

I have read and agree to the terms of this engagement letter, including the AI Disclosure and Consent section.

Client signature: _________________________ Date: ___________

Print name: {{clientName}}

---

*This engagement letter was drafted by ${BRAND.messaging.redlineAuthor} and requires attorney review before sending. The AI disclosure clause is a model — confirm it meets your jurisdiction's specific consent requirements.*`;

export const EngagementLetterDrafter: WorkflowTemplate = {
  id: 'engagement-letter-drafter',
  name: 'Engagement Letter with AI Disclosure Clause',
  description: 'Drafts an engagement letter body with a model AI-disclosure clause meeting ABA Opinion 512\'s client-consent duty. You review the scope and fee terms before sending.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Review all scope, fee, and limitation-of-liability language against your firm\'s standard terms. The AI-disclosure clause is a model — confirm it meets your jurisdiction\'s specific consent requirements before use.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Engagement Details',
      description: 'Provide client name, client work type, scope, fee structure, and AI disclosure information',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-engagement-letter',
      type: 'generate',
      name: 'Generate Engagement Letter',
      description: 'Draft the engagement letter with AI disclosure and consent section',
      config: {
        outputFile: 'ENGAGEMENT_LETTER.docx',
        promptTemplate: engagementLetterPrompt,
        systemPrompt: 'You are a legal document drafting assistant helping a licensed attorney produce an engagement letter. You write in clear, professional language appropriate for a client-facing document. The AI Disclosure and Consent section must be complete and substantive, covering: what AI tools are used and how, how client data is handled (emphasizing local-first processing where applicable), the client\'s right to object, and explicit consent language consistent with ABA Formal Opinion 512. Use bracketed placeholders where the attorney must supply firm-specific information. Do not invent facts about the firm. Avoid em dashes. Write in direct, plain English.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['ENGAGEMENT_LETTER.docx'],
  namedOutputs: [
    { id: 'engagement_letter', name: 'Engagement letter draft', schema: 'string' },
    { id: 'ai_disclosure_clause', name: 'AI disclosure and consent clause', schema: 'string' },
    { id: 'scope_terms', name: 'Scope of representation', schema: 'string' },
  ],
};

export default EngagementLetterDrafter;
