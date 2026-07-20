// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'propertyDescription',
    question: 'Property description',
    description: 'Address and type of property. Include the legal description or parcel number if available.',
    type: 'text',
    required: true,
    placeholder: 'e.g., 221 Birch Lane, Round Rock, TX 78664 — single-family residential; Parcel No. 123-456-789',
  },
  {
    id: 'transactionType',
    question: 'Transaction type',
    description: 'Select the type of real estate transaction.',
    type: 'select',
    required: true,
    options: [
      'Purchase (buyer-side)',
      'Sale (seller-side)',
      'Refinance',
      'Purchase and Sale (representing both sides)',
    ],
  },
  {
    id: 'parties',
    question: 'Parties',
    description: 'Names of buyer(s), seller(s), and lender (if financing). Include entity type for any entity parties.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Buyer: Daniel and Claire Nguyen; Seller: Westfield Properties LLC; Lender: First Community Bank',
  },
  {
    id: 'keyDates',
    question: 'Key contract dates',
    description: 'The dates established by the purchase contract or refinance commitment. Include contract execution date, inspection deadline, financing contingency deadline, title commitment deadline, and closing date.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Contract executed: May 1, 2025; Inspection deadline: May 12, 2025; Financing contingency: May 28, 2025; Title commitment deadline: May 20, 2025; Closing: June 15, 2025',
  },
  {
    id: 'financingDetails',
    question: 'Financing details',
    description: 'Type of financing, lender requirements, and any special conditions. Note if cash sale.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Conventional 30-year, 20% down; loan amount $320,000; lender requires survey; no HOA; OR Cash purchase — no financing',
  },
  {
    id: 'knownIssues',
    question: 'Known issues or special circumstances',
    description: 'Any title issues, encumbrances, survey matters, inspection findings, repair obligations, or other special circumstances that require attention before closing.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Existing survey from 2019 — lender may require update; seller has outstanding HOA lien to be cleared at closing; buyers are using 1031 exchange proceeds',
  },
  {
    id: 'jurisdiction',
    question: 'State / jurisdiction',
    description: 'The state where the property is located. Closing procedures, required documents, and attorney involvement vary significantly by state.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Texas; Florida; New York; Georgia',
  },
];

const realEstateClosingChecklistPrompt = `You are assisting a real estate attorney in generating a pre-closing checklist and document tracker for a residential transaction. You are not providing legal advice — you are producing a structured checklist for attorney review and use. The attorney will verify all items against the specific transaction documents, lender requirements, and applicable state closing procedures.

Property: {{propertyDescription}}
Transaction type: {{transactionType}}
Parties: {{parties}}
Key contract dates: {{keyDates}}
Financing details: {{financingDetails}}
Known issues: {{knownIssues}}
State / jurisdiction: {{jurisdiction}}

Produce a structured closing checklist in Markdown. Begin with the draft notice.

> **Draft document** — Verify all checklist items against the specific transaction documents, lender requirements, and applicable {{jurisdiction}} closing procedures before use.

---

## Real Estate Closing Checklist

**Property:** {{propertyDescription}}
**Transaction type:** {{transactionType}}
**Parties:** {{parties}}
**Jurisdiction:** {{jurisdiction}}

---

### Key Dates Tracker

| Milestone | Contract date | Actual date | Status | Notes |
|-----------|--------------|-------------|--------|-------|
[Populate with all dates from keyDates input, plus any standard milestones applicable to the transaction type.]

---

### Pre-Closing Checklist

Organize the checklist into the standard phases below. For each item: include a Status column (Not Started / In Progress / Complete), an Assigned To column, and a Notes column. Adapt the items to the transaction type selected.

#### Phase 1: Title and Search

| Item | Status | Assigned to | Notes |
|------|--------|-------------|-------|
| Order title search / title commitment | | | |
| Review title commitment — Schedule A (ownership, legal description) | | | |
| Review title commitment — Schedule B-I (requirements to be cleared) | | | |
| Review title commitment — Schedule B-II (exceptions to coverage) | | | |
| Identify and clear title objections | | | |
| Obtain payoff statements for all liens to be discharged | | | |
| Confirm HOA status, dues, and any outstanding assessments | | | [Flag from known issues if applicable]
| Survey — obtain or confirm existing survey acceptable to lender/title | | | [Flag from known issues]
| Confirm legal description matches contract and prior deed | | | |

#### Phase 2: Financing (skip if cash transaction)

| Item | Status | Assigned to | Notes |
|------|--------|-------------|-------|
| Loan commitment received from lender | | | |
| Review loan commitment — confirm terms match contract | | | |
| Financing contingency deadline satisfied or waived | | | |
| Lender-required title endorsements identified | | | |
| Confirm lender's closing instructions received | | | |
| Wire instructions confirmed with lender | | | |
| Final loan approval / clear to close received | | | |

#### Phase 3: Due Diligence

| Item | Status | Assigned to | Notes |
|------|--------|-------------|-------|
| Inspection completed and report received | | | |
| Inspection objections / repair requests resolved | | | |
| Confirm all agreed repairs completed (if applicable) | | | |
| Review seller disclosure statement | | | |
| Confirm property insurance (homeowner's) in place for closing | | | |
[For refinance: omit seller-side items; add: Confirm flood zone determination.]

#### Phase 4: Document Preparation

| Item | Status | Assigned to | Notes |
|------|--------|-------------|-------|
| Draft / review deed (warranty deed, special warranty, quitclaim per contract) | | | |
| Draft / review closing disclosure or settlement statement (CD/HUD-1) | | | |
| Confirm closing figures match contract terms | | | |
| Prepare / review promissory note and deed of trust (if financing) | | | |
| Confirm vesting — how will buyer(s) take title | | | |
| Prepare / review any seller's affidavits required | | | |
| Confirm entity authority documents if party is an entity | | | |
| Prepare 1099-S reporting if applicable | | | |

#### Phase 5: Closing Funds

| Item | Status | Assigned to | Notes |
|------|--------|-------------|-------|
| Closing disclosure / settlement statement delivered to buyer [X days before closing per RESPA if applicable] | | | |
| Buyer funds verified (wire or certified check — confirm acceptable form) | | | |
| Wire instructions verified — confirm by phone, NOT email only | | | |
| Confirm seller net proceeds confirmed and payoff amounts verified | | | |

#### Phase 6: Closing Day

| Item | Status | Assigned to | Notes |
|------|--------|-------------|-------|
| All parties confirmed for closing | | | |
| ID verification for all signing parties | | | |
| All documents executed | | | |
| Funds confirmed received before disbursement | | | |
| Deed executed, notarized, and ready to record | | | |
| All payoffs disbursed | | | |
| Seller proceeds disbursed | | | |

#### Phase 7: Post-Closing

| Item | Status | Assigned to | Notes |
|------|--------|-------------|-------|
| Deed recorded in {{jurisdiction}} county records | | | |
| Recorded deed returned to buyer | | | |
| Title policy issued to buyer (and lender if applicable) | | | |
| All original documents delivered to appropriate parties | | | |
| File closed and stored per firm retention policy | | | |

---

### Known Issues Tracker

[If known issues were identified in the input, list each issue with its resolution status and responsible party.]

| Issue | Resolution required | Responsible party | Status |
|-------|--------------------|--------------------|--------|
[Populate from knownIssues input.]

---

### Notes

[Space for attorney notes on special circumstances, outstanding items, and communication log.]

---

*This checklist was generated by ${BRAND.messaging.redlineAuthor}. Verify all items against the specific transaction documents, lender requirements, and {{jurisdiction}} closing procedures before use.*`;

export const RealEstateClosingChecklist: WorkflowTemplate = {
  id: 'real-estate-closing-checklist',
  name: 'Real Estate Closing Checklist',
  description: 'Generates a pre-closing checklist and document tracker for a residential transaction. Covers title, financing, inspection contingencies, and closing deliverables.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Verify all checklist items against the specific transaction documents, lender requirements, and applicable state closing procedures before use.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Transaction Details',
      description: 'Provide property description, transaction type, parties, key dates, and known issues',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-closing-checklist',
      type: 'generate',
      name: 'Generate Closing Checklist',
      description: 'Produce a structured pre-closing checklist and document tracker',
      config: {
        outputFile: 'CLOSING_CHECKLIST.docx',
        promptTemplate: realEstateClosingChecklistPrompt,
        systemPrompt: 'You are a real estate law practice assistant helping a licensed attorney generate a pre-closing checklist for a residential transaction. You produce structured, comprehensive checklists organized by closing phase. Adapt the checklist items to the transaction type (purchase, sale, refinance) and jurisdiction noted. Include status tracking columns so the attorney can use the document as a live tracker. Flag any known issues from the input as items requiring resolution. Note that wire fraud is a significant risk in real estate closings — always include the wire verification item under closing funds. Do not compute or assert closing figures. Use plain, direct language. Avoid em dashes.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['CLOSING_CHECKLIST.docx'],
  namedOutputs: [
    { id: 'closing_checklist', name: 'Pre-closing checklist', schema: 'string' },
    { id: 'key_dates', name: 'Key dates tracker', schema: 'string' },
    { id: 'known_issues', name: 'Known issues requiring resolution', schema: 'array' },
  ],
};

export default RealEstateClosingChecklist;
