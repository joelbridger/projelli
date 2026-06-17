// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'matterName',
    question: 'Matter name',
    description: 'The matter or file name you use to track this contract review.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Wellbridge Software Services Agreement - Review',
  },
  {
    id: 'contractType',
    question: 'Contract type',
    description: 'The type of contract being reviewed. Determines which risk areas the checklist emphasizes.',
    type: 'select',
    required: true,
    options: [
      'NDA / Confidentiality agreement',
      'Service agreement',
      'Vendor / supplier agreement',
      'Employment agreement',
      'Independent contractor agreement',
      'Commercial lease',
      'Software license / SaaS agreement',
      'Asset purchase agreement',
      'Stock purchase agreement',
      'Loan / credit agreement',
      'Partnership or joint venture agreement',
      'Other',
    ],
    defaultValue: 'Service agreement',
  },
  {
    id: 'clientRole',
    question: "Your client's role",
    description: "Select the role that best describes your client's position in this contract. This affects which risk areas are most relevant to highlight.",
    type: 'select',
    required: true,
    options: [
      'Buyer / purchaser',
      'Seller',
      'Service provider',
      'Service recipient / customer',
      'Lender',
      'Borrower',
      'Licensor',
      'Licensee',
      'Employer',
      'Employee / contractor',
      'Landlord',
      'Tenant',
      'Both parties (reviewing for a mutual agreement)',
    ],
    defaultValue: 'Service recipient / customer',
  },
  {
    id: 'keyCommercialTerms',
    question: 'Key commercial terms already noted',
    description: 'Summarize the headline commercial terms you have already identified: price, payment schedule, term length, scope of services, or any other material business terms. Leave blank if you have not yet reviewed the contract.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., 12-month initial term, auto-renews annually. Fixed fee of $8,500/month. Provider delivers software implementation services. Governing law: Illinois. Client noticed the liability cap is set at one month\'s fees — wants it raised to 12 months.',
  },
  {
    id: 'specificConcerns',
    question: 'Specific concerns or flagged issues',
    description: 'Any provisions, terms, or risk areas your client or you have already flagged as problematic. The checklist will address standard risk areas regardless, but noting specific concerns ensures they receive focused attention.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Client concerned about broad IP assignment clause — wants to retain ownership of pre-existing tools. Auto-renewal notice period is only 15 days — client thinks that is too short to realistically act on. Unlimited audit rights clause seems overbroad.',
  },
];

const contractReviewChecklistPrompt = `You are assisting a licensed attorney in conducting a structured review of an incoming contract. You are not providing legal advice — you are generating a review checklist that organizes the standard risk areas for this contract type so the attorney can work through each one systematically.

Matter: {{matterName}}
Contract type: {{contractType}}
Client's role: {{clientRole}}
Key commercial terms noted: {{keyCommercialTerms}}
Specific concerns flagged: {{specificConcerns}}

Produce a single Markdown file formatted as a structured contract review checklist. Begin with the draft notice.

> **Draft document** — Review and edit before use in any matter. This output is a draft for attorney review. It does not constitute legal advice and does not substitute for your professional judgment.
>
> **Compliance note:** This checklist highlights standard risk areas. It does not replace a full attorney review and may not capture jurisdiction-specific requirements.

---

# Contract Review Checklist
**Matter:** {{matterName}}
**Contract type:** {{contractType}}
**Client role:** {{clientRole}}
**Prepared for attorney review:** [date]

---

## How to Use This Checklist

Work through each section below. For each item, mark the status and add a note if action is needed. Status options:

- **OK** — reviewed, no issue
- **Flag** — requires negotiation or further review
- **Missing** — provision not present; evaluate whether it should be added
- **N/A** — not applicable to this contract type

Add your notes and recommended redlines in the "Notes / Recommended Action" column.

---

## Section 1: Parties and Authority

| # | Item | Status | Notes / Recommended Action |
|---|------|--------|----------------------------|
| 1.1 | Correct legal name and entity type for each party | | |
| 1.2 | Signatory authority confirmed (board resolution, officer certificate, or other authorization) | | |
| 1.3 | No missing or incorrect party names that could create an ambiguity about who is bound | | |
| 1.4 | Affiliates and subsidiaries addressed where relevant (are they bound? are they permitted to perform?) | | |

---

## Section 2: Term and Termination

| # | Item | Status | Notes / Recommended Action |
|---|------|--------|----------------------------|
| 2.1 | Initial term clearly stated | | |
| 2.2 | Renewal mechanics: automatic renewal, notice period, opt-out window | | |
| 2.3 | Termination for convenience: available to your client? To both parties? | | |
| 2.4 | Termination for cause: trigger events defined, notice and cure period adequate | | |
| 2.5 | Effect of termination: what obligations survive, what rights are cut off | | |
| 2.6 | Transition or wind-down obligations on termination | | |
| 2.7 | [If applicable to {{contractType}}] Early termination fee or liquidated damages provision | | |

---

## Section 3: Payment and Fees

| # | Item | Status | Notes / Recommended Action |
|---|------|--------|----------------------------|
| 3.1 | Price or fee clearly stated; no ambiguity about what is included | | |
| 3.2 | Payment schedule and due dates | | |
| 3.3 | Invoice requirements: form, delivery method, timing | | |
| 3.4 | Late payment remedy: interest rate, grace period, right to suspend performance | | |
| 3.5 | Fee adjustment or escalation provisions: CPI, unilateral increase rights, renegotiation triggers | | |
| 3.6 | Expense reimbursement: scope, pre-approval requirements, documentation | | |
| 3.7 | Taxes: which party bears sales, use, or withholding tax obligations | | |
| 3.8 | Disputed invoice process | | |

---

## Section 4: Intellectual Property and Data Ownership

| # | Item | Status | Notes / Recommended Action |
|---|------|--------|----------------------------|
| 4.1 | Ownership of work product or deliverables produced under the contract | | |
| 4.2 | Pre-existing IP: each party's pre-existing IP is clearly excluded from assignment | | |
| 4.3 | License grants: scope (field of use, territory, exclusivity), duration, sublicensing rights | | |
| 4.4 | IP developed jointly: ownership and exploitation rights addressed | | |
| 4.5 | Data ownership: who owns data generated or processed under the agreement | | |
| 4.6 | Data use and privacy obligations: permitted uses, restrictions, applicable law (GDPR, CCPA, HIPAA, etc.) | | |
| 4.7 | Confidentiality: scope of protected information, obligations, permitted disclosures, duration | | |
| 4.8 | Return or destruction of data and confidential information on termination | | |

---

## Section 5: Indemnification and Liability

| # | Item | Status | Notes / Recommended Action |
|---|------|--------|----------------------------|
| 5.1 | Indemnification scope: what events trigger indemnity, who bears it | | |
| 5.2 | IP infringement indemnity: which party indemnifies for third-party IP claims, and what are the carve-outs | | |
| 5.3 | Mutual vs. one-sided indemnification: is the obligation reciprocal | | |
| 5.4 | Indemnification procedure: notice, control of defense, cooperation obligations | | |
| 5.5 | Liability cap: amount, whether it applies to indemnification obligations | | |
| 5.6 | Exclusion of consequential, indirect, and punitive damages | | |
| 5.7 | Carve-outs from liability cap or damages exclusion: fraud, gross negligence, willful misconduct, IP claims, confidentiality breaches | | |
| 5.8 | Insurance requirements: types, limits, additional insured status, certificate delivery | | |

---

## Section 6: Governing Law and Dispute Resolution

| # | Item | Status | Notes / Recommended Action |
|---|------|--------|----------------------------|
| 6.1 | Governing law clearly stated and favorable or acceptable to your client | | |
| 6.2 | Jurisdiction and venue for litigation, if applicable | | |
| 6.3 | Arbitration clause: mandatory or optional, forum, rules, seat, number of arbitrators | | |
| 6.4 | Class action waiver, if present | | |
| 6.5 | Pre-dispute escalation process: senior officer escalation, mediation, notice requirements | | |
| 6.6 | Prevailing party attorney fees provision | | |
| 6.7 | Jury trial waiver, if present | | |

---

## Section 7: Key Missing or Unusual Provisions

[Review the contract type and client role, then identify:
- Provisions that are standard for a {{contractType}} but appear to be absent from this contract
- Provisions that are present but structured in an unusual or potentially one-sided way that warrants specific attention for a {{clientRole}}
- Any provision that directly addresses the specific concerns flagged: {{specificConcerns}}

Present these as a bullet list, with a brief factual description of why each is notable. Do not characterize provisions as "unfair" or make recommendations — note the provision and what it does, and leave the legal judgment to the attorney.]

---

## Section 8: Recommended Redlines and Issues to Flag

[Based on the commercial terms provided ({{keyCommercialTerms}}) and the specific concerns flagged ({{specificConcerns}}), generate a prioritized list of redline issues to address. For each issue:
- State the provision at issue
- Describe the current position in factual terms
- Describe the alternative position your client may prefer
- Note the priority: High (significant legal or commercial exposure) / Medium (meaningful but negotiable) / Low (preferred position, not a deal point)

Format as a numbered list. If no commercial terms or concerns were provided, generate placeholder items for the most common redline issues in a {{contractType}} from the perspective of a {{clientRole}}.]

| # | Provision | Current Position | Alternative Position | Priority |
|---|-----------|-----------------|---------------------|----------|

---

*This checklist highlights standard risk areas for a {{contractType}} from the perspective of a {{clientRole}}. It does not replace a full attorney review and may not capture all jurisdiction-specific requirements or issues unique to this contract. Attorney review of the actual contract text is required.*

*This output is a draft for attorney review. It does not constitute legal advice and does not substitute for your professional judgment.*`;

export const ContractReviewChecklist: WorkflowTemplate = {
  id: 'legal-contract-review-checklist',
  name: 'Contract Review Checklist',
  description: 'For transactional and general practice attorneys reviewing an incoming contract: produces a structured review checklist covering standard risk areas including parties and authority, term and termination, payment and fees, IP and data ownership, indemnification and liability cap, governing law and dispute resolution, missing provisions, and recommended redlines.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Verify this output against applicable law and professional standards before use in client matters.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Contract Details',
      description: 'Provide the contract type, your client\'s role, and any specific concerns to address',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-review-checklist',
      type: 'generate',
      name: 'Generate Review Checklist',
      description: 'Produce a structured contract review checklist with risk areas and recommended redlines',
      config: {
        outputFile: '{{matterName}}/Contract Review - {{contractType}}.docx',
        promptTemplate: contractReviewChecklistPrompt,
        systemPrompt: 'You are a legal practice management assistant helping a licensed attorney conduct a structured contract review. You generate comprehensive, organized checklists that cover the standard risk areas for a given contract type and client role. You present provisions and risk areas in factual terms, noting what each provision does and what a typical alternative position looks like, without characterizing provisions as favorable or unfavorable — that judgment belongs to the attorney. You surface missing provisions that are standard for the contract type, and you address specific concerns the attorney has flagged directly. You never provide legal advice.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['{{matterName}}/Contract Review - {{contractType}}.docx'],
  namedOutputs: [
    { id: 'flagged_provisions', name: 'Flagged or missing provisions', schema: 'array' },
    { id: 'recommended_redlines', name: 'Recommended redlines and priority', schema: 'array' },
  ],
};

export default ContractReviewChecklist;
