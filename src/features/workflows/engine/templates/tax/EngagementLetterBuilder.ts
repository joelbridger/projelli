// Tax Practice Pack v2.2 (shipped). Built with input from practicing CPAs and EAs.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full name of the individual or entity engaging your services.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Sarah J. Moretti',
  },
  {
    id: 'clientEntityType',
    question: 'Client entity type',
    description: 'The legal form of the client. Determines which return types and filing obligations are referenced.',
    type: 'select',
    required: true,
    options: ['Individual', 'Sole Proprietor', 'S-Corp', 'C-Corp', 'Partnership/LLC', 'Non-profit'],
    defaultValue: 'Individual',
  },
  {
    id: 'servicesPerformed',
    question: 'Services to be performed',
    description: 'Describe the specific tax services covered by this engagement.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Preparation of 2025 Form 1040, Schedule C, and applicable state return',
  },
  {
    id: 'feeArrangement',
    question: 'Fee arrangement',
    description: 'The billing structure for this engagement.',
    type: 'select',
    required: true,
    options: ['Flat fee', 'Hourly', 'Flat fee with hourly for out-of-scope'],
    defaultValue: 'Flat fee',
  },
  {
    id: 'feeAmountOrRate',
    question: 'Fee amount or rate',
    description: 'The specific dollar amount or hourly rate for this engagement.',
    type: 'text',
    required: true,
    placeholder: 'e.g., $650 flat, or $195/hr',
  },
  {
    id: 'documentDeliveryMethod',
    question: 'Document delivery method',
    description: 'How completed returns and documents will be delivered to the client.',
    type: 'select',
    required: true,
    options: ['Secure portal', 'Email', 'In-person pickup'],
    defaultValue: 'Secure portal',
  },
  {
    id: 'estimatedCompletionDate',
    question: 'Estimated completion date (optional)',
    description: 'Target date for completing the engagement, if known at this stage.',
    type: 'text',
    required: false,
    placeholder: 'e.g., March 15, 2026',
  },
  {
    id: 'specialCircumstances',
    question: 'Any special circumstances (optional)',
    description: 'Anything out of the ordinary that should be reflected in the engagement letter.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., client had unreported income in prior year, amended return likely needed',
  },
];

const engagementLetterPrompt = `You are assisting a licensed tax professional in drafting an engagement letter for a new client. You are not providing legal or regulatory advice — you are helping the practitioner produce a professional starting-point document they will review and finalize before sending.

Client name: {{clientName}}
Client entity type: {{clientEntityType}}
Services to be performed: {{servicesPerformed}}
Fee arrangement: {{feeArrangement}}
Fee amount or rate: {{feeAmountOrRate}}
Document delivery method: {{documentDeliveryMethod}}
Estimated completion date: {{estimatedCompletionDate}}
Special circumstances: {{specialCircumstances}}

Produce a complete engagement letter in Markdown. At the top, include the draft notice.

> **Draft document** — Review and edit before delivery.

---

# Tax Professional Services Engagement Letter

[Practitioner letterhead — name, firm, address, phone, email]

[Date]

{{clientName}}
[Client address]

Dear {{clientName}},

## Scope of Services

[Clearly describe the services to be performed based on the inputs. Be specific about the tax year, forms, and jurisdictions covered. Note what is explicitly not included — e.g., audit representation, amended returns for prior years, state returns beyond those specified — unless additional fees are agreed.]

## Client Responsibilities

[The client agrees to provide complete, accurate, and timely information. The practitioner's work product depends entirely on the information furnished. The practitioner is not responsible for errors or omissions resulting from incomplete or inaccurate information. List specific documentation the client must supply, consistent with the services described.]

## Practitioner Responsibilities

[The practitioner will prepare the described returns with professional care, notify the client of any additional work identified, and communicate any issues that arise before the estimated completion date.]

## Fees and Payment Terms

[State the fee arrangement and amount/rate. Describe payment timing — e.g., invoice upon delivery, 50% upon engagement start — and accepted payment methods. Note the out-of-scope hourly rate if applicable.]

## Document Handling and Return

[Describe how completed documents will be delivered ({{documentDeliveryMethod}}). Note the client's responsibility to review documents before signing. Describe document retention — what the practitioner will retain and for how long.]

## Engagement Limitations

[Clarify that this engagement covers only the services listed. Tax law interpretation involves judgment and positions may be challenged. The engagement does not include legal advice or legal representation. The practitioner is not responsible for tax positions taken in prior years unless specifically engaged for that purpose.]

## Estimated Completion

[Include the estimated completion date if provided, with a note that this is an estimate contingent on timely receipt of complete client information.]

[If special circumstances were noted, address them here with appropriate language about potential scope changes or additional fees.]

## Signature and Acceptance

By signing below, you acknowledge that you have read and agree to the terms of this engagement.

**Practitioner:**

Signature: _________________________________ Date: _____________

Printed name: _________________________________

**Client:**

Signature: _________________________________ Date: _____________

Printed name: _________________________________

---

*This engagement letter is a starting point. The practitioner should review for state-specific requirements, firm policy, and any professional liability considerations before sending to the client. Consult your state CPA society or a qualified tax attorney if you have questions about specific provisions.*`;

export const EngagementLetterBuilder: WorkflowTemplate = {
  id: 'tax-engagement-letter-builder',
  name: 'Engagement Letter Builder',
  description: 'Drafts a professional engagement letter for a new tax client, covering scope of services, client responsibilities, fees, document handling, and engagement limitations.',
  version: '1.0.0',
  category: 'tax',
  requiresVerification: true,
  verificationNote: 'Review all scope language and limitation-of-liability clauses against your firm\'s standard terms before sending.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Engagement Details',
      description: 'Provide the client and engagement information for the letter',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-engagement-letter',
      type: 'generate',
      name: 'Generate Engagement Letter',
      description: 'Draft the complete engagement letter with all required sections',
      config: {
        outputFile: 'ENGAGEMENT_LETTER.md',
        promptTemplate: engagementLetterPrompt,
        systemPrompt: 'You are a tax practice management assistant helping a licensed CPA or EA draft professional client engagement letters. You write clearly and precisely, using plain language appropriate for a client to read. You are careful to include all standard engagement letter sections without inventing obligations or protections not supported by the practitioner\'s inputs. You always note that the document requires practitioner review before sending, and you flag any state-specific requirements the practitioner should verify.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['ENGAGEMENT_LETTER.md'],
  namedOutputs: [
    { id: 'engagement_letter', name: 'Draft engagement letter', schema: 'string' },
    { id: 'scope_of_services', name: 'Scope of services description', schema: 'string' },
  ],
};

export default EngagementLetterBuilder;
