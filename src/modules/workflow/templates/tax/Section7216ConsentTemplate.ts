// @draft — Tax Practice Pack v2.2
// Requires CPA/EA advisor review before shipping. Do not expose to users without review.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full name of the client providing consent.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Patricia N. Schreiber',
  },
  {
    id: 'preparerFirmName',
    question: 'Preparer / firm name',
    description: 'The name of the tax practitioner or firm obtaining the consent.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Westfield Tax Services, LLC',
  },
  {
    id: 'thirdPartyName',
    question: 'Third party name and type',
    description: 'The name and nature of the third party receiving the disclosure.',
    type: 'text',
    required: true,
    placeholder: 'e.g., TaxSlayer Pro (tax software), or specific AI tool name',
  },
  {
    id: 'purposeOfDisclosure',
    question: 'Purpose of disclosure',
    description: 'Why the client\'s tax information is being disclosed to this third party.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., electronic preparation of federal and state tax returns using cloud-based software',
  },
  {
    id: 'informationToBeDisclosed',
    question: 'Information to be disclosed',
    description: 'Describe the specific tax return information that will be shared.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., name, SSN, income, deductions as entered on Form 1040',
  },
  {
    id: 'durationOfConsent',
    question: 'Duration of consent',
    description: 'How long this consent remains effective.',
    type: 'select',
    required: true,
    options: ['This tax year only', 'Ongoing until revoked', 'Specific date'],
    defaultValue: 'This tax year only',
  },
];

const section7216ConsentPrompt = `You are assisting a licensed tax professional in drafting a §7216 disclosure consent form. This is a legally sensitive document — you are providing a structured starting point only. The practitioner must confirm current regulatory requirements with a qualified tax attorney before use with clients.

Client name: {{clientName}}
Preparer / firm name: {{preparerFirmName}}
Third party name and type: {{thirdPartyName}}
Purpose of disclosure: {{purposeOfDisclosure}}
Information to be disclosed: {{informationToBeDisclosed}}
Duration of consent: {{durationOfConsent}}

Produce a properly structured §7216 consent form in Markdown. At the top, include the draft notice.

> **Draft document** — Review and edit before delivery.

---

> **IMPORTANT NOTICE TO PRACTITIONER — READ BEFORE USING:**
>
> This is a draft consent form for IRC §7216 / 26 C.F.R. §301.7216-3 purposes. Federal regulations impose specific requirements on the form and content of valid consent:
>
> **Rev. Proc. 2013-14, §5.04 requirements (not all may be reflected in this draft):**
> - The consent must be a separate document (not embedded in the engagement letter or other agreement)
> - The consent must be signed and dated by the taxpayer
> - The disclosure purpose must be described specifically — general language ("tax preparation purposes") may be insufficient
> - Minimum 12-point type is required for the consent (Treas. Reg. §301.7216-3(b)(3)(i))
> - Consent must be obtained **before** the return information is disclosed — not after
> - Each type of use requires a separate consent (e.g., disclosing to cloud software is one consent; sharing with a referral partner is a separate consent)
>
> **This draft has not been reviewed by a tax attorney.** Before using this form with clients, have a qualified tax attorney or enrolled agent familiar with §7216 review it for compliance with current Rev. Proc. 2013-14 §5.04 requirements and any subsequent IRS guidance.

---

# Consent to Disclosure of Tax Return Information
**IRC §7216 / 26 C.F.R. §301.7216-3**

---

## Consent

I, **{{clientName}}**, hereby consent to the disclosure of my tax return information by **{{preparerFirmName}}** to the following third party:

**Third party:** {{thirdPartyName}}

**Purpose of disclosure:** {{purposeOfDisclosure}}

**Information to be disclosed:** {{informationToBeDisclosed}}

**Duration of consent:** {{durationOfConsent}}

---

## Your Rights Regarding This Consent

Your consent to the disclosure of your tax return information is voluntary. You are not required to sign this consent form. If you do not sign this consent form, {{preparerFirmName}} will not be able to [describe consequence — e.g., use this software platform to prepare your return / use this AI-assisted service in your engagement]. You may revoke this consent at any time by providing written notice to {{preparerFirmName}}.

This consent does not authorize the use of your tax return information for any purpose other than that stated above.

---

## Acknowledgment and Signature

By signing below, I acknowledge that I have read and understand this consent form, and I voluntarily consent to the disclosure described above.

**Client signature:** _________________________________ Date: _____________

**Printed name:** {{clientName}}

---

## Practitioner Checklist — Before Obtaining Consent

- [ ] This consent is a **separate document** from the engagement letter and any other agreement
- [ ] This consent describes the specific purpose of the disclosure (not generic language)
- [ ] The form will be presented in **minimum 12-point type** when printed or displayed
- [ ] Client will sign and date this form **before** any return information is processed or disclosed
- [ ] This consent covers only the specific third party and use described above — a separate consent is required for any additional third parties or uses
- [ ] A signed copy will be retained in the client's file per applicable recordkeeping requirements

---

*{{preparerFirmName}} retains a copy of this consent form in accordance with applicable recordkeeping requirements.*

---

*This consent form is a draft. The practitioner must confirm compliance with Rev. Proc. 2013-14 §5.04 and Treas. Reg. §301.7216-3 with a qualified tax attorney before use with clients. Key requirements: separate document, minimum 12-point type, signed before disclosure occurs, one consent per type of use.*`;

export const Section7216ConsentTemplate: WorkflowTemplate = {
  id: 'tax-section-7216-consent',
  name: 'Section 7216 Consent Form',
  description: 'Drafts a §7216 disclosure consent form for situations where client tax data may be shared with third parties such as cloud software providers or AI tools. Includes required statutory language and practitioner guidance.',
  version: '1.0.0',
  category: 'tax',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Disclosure Details',
      description: 'Provide the client, preparer, third party, and disclosure information',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-consent-form',
      type: 'generate',
      name: 'Generate §7216 Consent Form',
      description: 'Draft the consent form with required statutory language and practitioner guidance',
      config: {
        outputFile: 'SECTION_7216_CONSENT.md',
        promptTemplate: section7216ConsentPrompt,
        systemPrompt: 'You are a tax practice assistant helping a licensed CPA or EA draft a §7216 consent form. You understand that this is a legally sensitive document with specific regulatory requirements. You produce a structured, professional draft and prominently flag that the practitioner must have a qualified tax attorney review the form for current regulatory compliance before using it with clients. You do not claim that the draft meets all regulatory requirements.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['SECTION_7216_CONSENT.md'],
  namedOutputs: [
    { id: 'consent_form', name: 'Draft §7216 consent form', schema: 'string' },
  ],
};

export default Section7216ConsentTemplate;
