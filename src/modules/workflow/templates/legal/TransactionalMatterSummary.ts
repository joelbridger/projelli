// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'matterName',
    question: 'Matter name',
    description: 'The name or reference you use to track this transaction in your files.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Meridian Acquisition of Solaris Holdings',
  },
  {
    id: 'transactionType',
    question: 'Transaction type',
    description: 'The structure of the deal. Affects which key terms the summary will emphasize.',
    type: 'select',
    required: true,
    options: [
      'Asset purchase',
      'Stock purchase',
      'Merger',
      'Commercial agreement',
      'Joint venture',
      'Real estate purchase',
      'Financing / loan',
      'Other',
    ],
    defaultValue: 'Asset purchase',
  },
  {
    id: 'parties',
    question: 'Parties and their roles',
    description: 'List each party and their role in the transaction. Include entity type where known (LLC, corporation, etc.). One party per line.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g.,\nMeridian Group LLC — Buyer\nSolaris Holdings Inc. — Seller\nFirst National Bank — Lender (acquisition financing)\nPinnacle Capital Partners — Seller\'s PE sponsor',
  },
  {
    id: 'dealValue',
    question: 'Deal value (optional)',
    description: 'The total purchase price or deal size. You may leave this blank if it is confidential or not yet agreed. If included, do not paste full term sheets — enter only the headline figure.',
    type: 'text',
    required: false,
    placeholder: 'e.g., $4.2M asset purchase price',
  },
  {
    id: 'keyAgreedTerms',
    question: 'Key agreed terms',
    description: 'Summarize the terms that are substantially agreed. Include price structure, payment mechanics, key conditions, and any notable reps and warranties positions. Rough notes are fine.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Purchase price $4.2M, $3.5M at close, $700k held in escrow 18 months for indemnification. Buyer acquiring all equipment, customer contracts, and IP; excluding real property and existing AR. Seller reps include good title, no undisclosed liabilities, and no material adverse change since Dec 2025 financials. Indemnification cap at purchase price; basket $42k (1%).',
  },
  {
    id: 'openItems',
    question: 'Open items and who owns each',
    description: 'List the issues still under negotiation or outstanding tasks. Note who is responsible for resolving each — Buyer\'s counsel, Seller\'s counsel, the parties directly, or a third party.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g.,\n- IP assignment schedule — Seller\'s counsel to provide by June 10\n- Non-compete geographic scope — parties to agree; currently 50-mile vs. statewide\n- Title search on equipment (Buyer\'s counsel)\n- Landlord consent to assignment of lease — Seller to obtain\n- Final working capital target — accountants to finalize peg',
  },
  {
    id: 'keyDates',
    question: 'Key dates and deadlines',
    description: 'List signing target, closing target, and any conditions precedent with their own deadlines. One entry per line.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g.,\nLetter of Intent signed: May 28, 2026\nDue diligence period ends: June 14, 2026\nAgreement execution target: June 20, 2026\nClosing target: July 1, 2026\nCondition: HSR filing (if required) — 30 days from execution',
  },
];

const transactionalMatterSummaryPrompt = `You are assisting a licensed transactional attorney in organizing the current status of a deal into a structured matter summary. You are not providing legal advice — you are helping the attorney organize the information they have gathered so they can track the transaction, manage open items, and prepare for client communications.

> **Compliance note:** Do not include confidential term-sheet or NDA-protected details in the AI prompt unless you are using a local model.

Matter: {{matterName}}
Transaction type: {{transactionType}}
Deal value: {{dealValue}}

Parties and roles:
{{parties}}

Key agreed terms:
{{keyAgreedTerms}}

Open items:
{{openItems}}

Key dates:
{{keyDates}}

Produce a single Markdown file formatted as a structured matter summary. Begin with the draft notice.

> **Draft document** — Review and edit before use in any matter. This output is a draft for attorney review. It does not constitute legal advice and does not substitute for your professional judgment.

---

# Transaction Matter Summary
**Matter:** {{matterName}}
**Transaction type:** {{transactionType}}
**Prepared for attorney review:** [date]

---

## Parties and Roles

| Party | Entity Type | Role |
|-------|-------------|------|

[Populate from the parties input. If entity type is not specified, note as "Not confirmed." Group by role: Buyer side, Seller side, Lenders and third parties.]

---

## Deal Structure Overview

[Write a concise 2-4 sentence narrative describing what this transaction is: what is being bought or sold, who the principals are, the general structure (asset vs. stock, etc.), and the headline commercial terms. Write in the third person, at the level of a client update memo. Do not editorialize about deal quality.]

---

## Key Agreed Terms

### Price and Payment Structure
[Summarize the price, payment mechanics, and any holdback or escrow arrangement.]

### Assets or Interests Being Transferred
[For asset deals: list the categories of assets being acquired and any notable exclusions. For stock or merger deals: describe the equity interests and any carve-outs.]

### Representations and Warranties Highlights
[Note the most significant or negotiated reps and warranties positions. Flag any known carve-outs or knowledge qualifiers that depart from standard.]

### Indemnification and Liability
[Summarize the indemnification structure: caps, baskets, survival periods, and any special indemnities. If not yet agreed, note as open.]

### Conditions to Closing
[List the conditions precedent to closing from both sides — regulatory approvals, third-party consents, financing, due diligence satisfaction, etc.]

---

## Open Items

| # | Issue | Owner | Status | Target Date |
|---|-------|-------|--------|-------------|

[Populate from the open items input. Assign a sequential number to each. "Status" should be: Open / In Progress / Pending Third Party / Resolved — use the information provided; default to "Open" if not specified. "Target Date" should reflect any deadline mentioned or be left blank.]

---

## Key Dates

| Milestone | Date | Notes |
|-----------|------|-------|

[Populate from the key dates input. Include: LOI / term sheet, due diligence period, execution target, closing target, and any conditions with their own deadlines. Flag any dates that appear tight given the number of open items.]

---

## Items to Monitor

[Based on the open items and key dates, list 3-5 specific things the attorney should monitor or action in the near term. Frame as concrete tasks ("Obtain landlord consent letter before June 20"), not general reminders. Flag any open item whose resolution is on the critical path to closing.]

---

*This summary reflects the information provided as of the date of preparation. Verify all terms against the current draft agreement and confirm open item status with the parties before use in any client communication.*`;

export const TransactionalMatterSummary: WorkflowTemplate = {
  id: 'legal-transactional-matter-summary',
  name: 'Transactional Matter Summary',
  description: 'For business and transactional attorneys: given a deal\'s current status, produces a structured matter summary covering parties and roles, deal structure, key agreed terms, open issues with ownership, and key dates. Suitable for internal tracking and client update preparation.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Verify this output against applicable law and professional standards before use in client matters.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Transaction Details',
      description: 'Provide the transaction structure, agreed terms, open items, and key dates',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-matter-summary',
      type: 'generate',
      name: 'Generate Matter Summary',
      description: 'Produce a structured summary of the transaction status',
      config: {
        outputFile: '{{matterName}}/Transaction Summary.docx',
        promptTemplate: transactionalMatterSummaryPrompt,
        systemPrompt: 'You are a legal practice management assistant helping a licensed transactional attorney organize the current state of a deal. You produce clear, structured matter summaries that attorneys can share internally or use to prepare client updates. You present agreed terms accurately without editorializing, surface open items with clear ownership, and flag dates or dependencies that may create scheduling risk. You never provide legal advice and never characterize deal terms as favorable or unfavorable — that is the attorney\'s judgment.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['{{matterName}}/Transaction Summary.docx'],
  namedOutputs: [
    { id: 'parties', name: 'Parties and roles', schema: 'array' },
    { id: 'open_items', name: 'Open items with owners', schema: 'array' },
    { id: 'key_dates', name: 'Key transaction dates', schema: 'array' },
  ],
};

export default TransactionalMatterSummary;
