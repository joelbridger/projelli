// Tax Practice Pack v2.2 (shipped). Built with input from practicing CPAs and EAs.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

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
    id: 'taxYear',
    question: 'Tax year',
    description: 'The tax year this engagement covers. Used in the consent form and scope summary.',
    type: 'text',
    required: true,
    placeholder: 'e.g., 2025',
  },
  {
    id: 'thirdPartyName',
    question: 'Third party name and type',
    description: 'The name and nature of the third party receiving the disclosure. Be specific — "cloud software" and "AI tool" are different third parties requiring separate consents.',
    type: 'text',
    required: true,
    placeholder: `e.g., TaxSlayer Pro (cloud-based tax preparation software) or ${BRAND.name} (AI workspace software)`,
  },
  {
    id: 'purposeOfDisclosure',
    question: 'Specific purpose of disclosure',
    description: 'Why the client\'s tax information is being disclosed to this third party. Must be specific — general language like "tax preparation purposes" may not satisfy Rev. Proc. 2013-14 requirements.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., electronic preparation of federal and state income tax returns for tax year 2025 using cloud-based software hosted on third-party servers',
  },
  {
    id: 'informationToBeDisclosed',
    question: 'Information to be disclosed',
    description: 'The specific categories of tax return information that will be shared with the third party.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., name, Social Security number, income, deductions, credits, and other information as entered on Form 1040 and applicable schedules',
  },
  {
    id: 'durationOfConsent',
    question: 'Duration of consent',
    description: 'How long this consent remains effective.',
    type: 'select',
    required: true,
    options: ['This tax year only', 'Ongoing until revoked in writing', 'Specific date'],
    defaultValue: 'This tax year only',
  },
  {
    id: 'engagementScope',
    question: 'Scope of engagement services',
    description: 'Briefly describe the services included in this engagement. This goes into the scope summary document, not the consent form itself.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Preparation of 2025 federal Form 1040, California Form 540, and all required schedules. Includes review of prior year return, one round of client review questions, e-filing, and post-filing support for any IRS correspondence related to this return.',
  },
  {
    id: 'engagementExclusions',
    question: 'What is out of scope (optional)',
    description: 'Services not included in this engagement. Helps manage client expectations and is included in the scope summary.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Tax planning, estimated tax calculation, amended returns, audit representation, bookkeeping, or advice regarding any tax year other than 2025.',
  },
];

const section7216ConsentPrompt = `You are assisting a licensed tax professional in drafting a complete §7216 engagement packet for a client. This packet contains three documents: a §7216 consent form, a plain-language client cover memo, and an engagement scope summary. Together, these give the client what they need to understand what they are consenting to and what this engagement covers.

Client name: {{clientName}}
Preparer / firm name: {{preparerFirmName}}
Tax year: {{taxYear}}
Third party name and type: {{thirdPartyName}}
Purpose of disclosure: {{purposeOfDisclosure}}
Information to be disclosed: {{informationToBeDisclosed}}
Duration of consent: {{durationOfConsent}}
Scope of engagement services: {{engagementScope}}
Out of scope / exclusions: {{engagementExclusions}}

Produce all three documents in a single Markdown file, clearly separated. At the top, include the draft notice.

> **Draft document** — Have a qualified tax attorney review before use with clients.

---

> **PRACTITIONER NOTICE — READ BEFORE USING:**
>
> Rev. Proc. 2013-14, §5.04 requires that a valid §7216 consent be:
> - A **separate document** (not part of the engagement letter or any other agreement)
> - Presented in **minimum 12-point type** when printed or displayed
> - Signed and dated by the taxpayer
> - Obtained **before** any return information is disclosed — not after
> - Specific in describing the purpose (general language may be insufficient)
> - One consent per type of use — a separate consent is needed for each additional third party or use
>
> This draft has not been reviewed by a tax attorney. Before using with clients, have a qualified tax attorney or enrolled agent familiar with §7216 confirm compliance with Rev. Proc. 2013-14 §5.04 and Treas. Reg. §301.7216-3.

---

# §7216 Engagement Packet
**Client:** {{clientName}}
**Firm:** {{preparerFirmName}}
**Tax year:** {{taxYear}}
**Prepared for attorney review:** [date]

---

## Document 1: §7216 Consent to Disclosure of Tax Return Information

**IRC §7216 / 26 C.F.R. §301.7216-3**

---

### Consent

I, **{{clientName}}**, hereby consent to the disclosure of my tax return information by **{{preparerFirmName}}** to the following party:

**Third party:** {{thirdPartyName}}

**Purpose of this disclosure:** {{purposeOfDisclosure}}

**Information to be disclosed:** {{informationToBeDisclosed}}

**Duration of consent:** {{durationOfConsent}}

---

### Your Rights

Your consent to disclosure of your tax return information is voluntary. You are not required to sign this form. If you do not sign, {{preparerFirmName}} may be unable to use {{thirdPartyName}} in connection with your engagement — [practitioner: describe specific consequence, e.g., "and will need to use alternative software to prepare your return"]. You may revoke this consent at any time by providing written notice to {{preparerFirmName}}.

This consent does not authorize use of your tax return information for any purpose other than the purpose stated above, and does not authorize disclosure to any third party other than the party named above.

---

### Signature

By signing below, I confirm that I have read this consent form, I understand what I am consenting to, and I give my voluntary consent to the disclosure described.

**Client signature:** _________________________________ Date: _____________

**Printed name:** {{clientName}}

---

### Practitioner Checklist — Before Obtaining Consent

- [ ] This consent is presented as a **separate, standalone document** (not embedded in the engagement letter or any other form)
- [ ] The form will be presented to the client in **minimum 12-point type** when printed or displayed
- [ ] Client will sign and date this form **before** any return information is processed or disclosed to {{thirdPartyName}}
- [ ] This consent covers only the specific third party and purpose stated above — a separate consent is required for any additional third parties or uses
- [ ] A signed copy will be retained in the client file per applicable recordkeeping requirements

---

## Document 2: Client Cover Memo

**To:** {{clientName}}
**From:** {{preparerFirmName}}
**Re:** What you are consenting to — plain language explanation
**Tax year:** {{taxYear}}

---

Dear {{clientName}},

The attached consent form is a legal requirement before I can use {{thirdPartyName}} as part of preparing your {{taxYear}} tax return. This memo explains what it means in plain language.

**What is §7216?**

Section 7216 of the Internal Revenue Code restricts how tax preparers can share or use your tax return information. It protects your privacy by requiring your explicit written consent before any of your tax information can be shared with a third party, even with software used to prepare your return.

**What are you consenting to?**

You are giving me permission to share the specific information listed in the consent form with {{thirdPartyName}} for one purpose only: {{purposeOfDisclosure}}.

Your information will not be used for any other purpose. It will not be sold. It will not be used to market products or services to you.

**Why is this necessary?**

[Explain in 1-2 sentences specific to the tool/software named: e.g., "TaxSlayer Pro is a cloud-based software program, which means that when I enter your information into it, that information is transmitted to and stored on TaxSlayer's servers. Federal law requires your consent before I do that."]

**Do you have to sign?**

No. Your consent is entirely voluntary. If you prefer not to sign, let me know and I will find an alternative approach for preparing your return.

**How long does this consent last?**

This consent is effective for {{durationOfConsent}}. You may revoke it at any time by notifying me in writing.

If you have questions about this before signing, please ask. I am glad to walk through it with you.

[Practitioner name]
[Title, credentials]
[Firm]
[Contact information]

---

## Document 3: Engagement Scope Summary

**Client:** {{clientName}}
**Firm:** {{preparerFirmName}}
**Tax year:** {{taxYear}}

This summary describes what is included in and excluded from this engagement. It is a reference document for both parties, not a contract.

### What This Engagement Covers

{{engagementScope}}

### What Is Not Included

{{engagementExclusions}}

[If no exclusions were provided: Add standard exclusions here — e.g., "Tax planning advice, representation before tax authorities, bookkeeping, payroll, or services related to any tax year other than {{taxYear}}."]

### Delivery and Timeline

[Practitioner: Add expected completion date, review process, and delivery method]

### Fees

[Practitioner: Add fee structure or reference the separate fee agreement]

### If Something Changes

If you receive new tax documents or your circumstances change after we begin preparation, please notify me promptly. Material changes to your tax situation may require updating this scope.

---

*This engagement packet is a draft. Documents 1 and 3 should be adapted to your firm's standard format and reviewed by a qualified tax attorney before use with clients. The cover memo in Document 2 is intended for client communication and may be delivered on firm letterhead.*`;

export const Section7216ConsentTemplate: WorkflowTemplate = {
  id: 'tax-section-7216-consent',
  name: 'Section 7216 Engagement Packet',
  description: 'Produces a complete three-document engagement packet: (1) a §7216 consent form meeting Rev. Proc. 2013-14 requirements, (2) a plain-language client cover memo explaining what the client is consenting to and why, and (3) an engagement scope summary. Useful even for practices that already have consent forms — the plain-language memo and scope summary add value on their own.',
  version: '2.0.0',
  category: 'tax',
  requiresVerification: true,
  verificationNote: 'Review the consent language against current Treasury Reg. §301.7216-3 requirements and confirm the 12-point-type and separate-document rules are met before presenting to the client.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Engagement & Disclosure Details',
      description: 'Provide client name, firm name, third party, disclosure purpose, engagement scope, and consent duration',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-engagement-packet',
      type: 'generate',
      name: 'Generate §7216 Engagement Packet',
      description: 'Draft all three documents: consent form, plain-language client memo, and engagement scope summary',
      config: {
        outputFile: 'SECTION_7216_ENGAGEMENT_PACKET.md',
        promptTemplate: section7216ConsentPrompt,
        systemPrompt: 'You are a tax practice assistant helping a licensed CPA or EA draft a §7216 engagement packet. You produce three documents in a single file: a legally structured consent form (noting the practitioner must have an attorney review it), a plain-language cover memo explaining consent in terms a non-lawyer client will understand, and a scope summary. You are careful to flag all §7216 compliance requirements prominently in the practitioner notice. Your plain-language memo is genuinely plain — you avoid legalese and explain the purpose, optionality, and duration of consent in terms that build client trust rather than create confusion. Your scope summary is concrete and specific to the engagement details provided.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['SECTION_7216_ENGAGEMENT_PACKET.md'],
  namedOutputs: [
    { id: 'consent_form', name: 'Draft §7216 consent form', schema: 'string' },
    { id: 'client_cover_memo', name: 'Plain-language client cover memo', schema: 'string' },
    { id: 'engagement_scope', name: 'Engagement scope summary', schema: 'string' },
  ],
};

export default Section7216ConsentTemplate;
