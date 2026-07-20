// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientName',
    question: 'Client name',
    description: 'Full legal name of the client completing the affidavit.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Jennifer L. Morales',
  },
  {
    id: 'jurisdiction',
    question: 'State / jurisdiction',
    description: 'The state where the family law client work is pending. Financial affidavit formats and required fields vary by state.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Florida; Texas; New York',
  },
  {
    id: 'incomeSources',
    question: 'Income sources and amounts',
    description: 'All sources of income. For each source, note the amount and frequency (monthly, weekly, annual). Include wages, self-employment, rental income, investment income, retirement distributions, support received, and any other regular income.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Wages: $5,200/month gross, $3,900/month net (employer: Apex Corp); Rental income: $1,200/month (512 Oak St); Child support received: $800/month from prior marriage',
  },
  {
    id: 'monthlyExpenses',
    question: 'Monthly expenses',
    description: 'Itemized monthly expenses. Include housing (mortgage/rent, taxes, insurance, HOA), utilities, food, transportation, healthcare, childcare, education, and any other regular expenses.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Mortgage: $1,850; HOA: $150; Property taxes: $325/month; Electric: $120; Gas: $65; Groceries: $700; Car payment: $420; Car insurance: $180; Health insurance: $310; Childcare: $1,200; School tuition: $450',
  },
  {
    id: 'assets',
    question: 'Assets',
    description: 'All assets with approximate current values. Include real property, vehicles, bank accounts, investment accounts, retirement accounts, business interests, and personal property of significant value.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Primary residence: est. $380,000 (mortgage balance: $210,000); Checking (First National): approx. $4,200; Savings (First National): approx. $18,500; 401(k) (Fidelity): approx. $87,000; Vehicle 2021 Honda CR-V: est. $24,000 (loan balance: $11,000)',
  },
  {
    id: 'debts',
    question: 'Debts and liabilities',
    description: 'All liabilities with approximate balances and monthly payments. Include mortgage, car loans, student loans, credit cards, personal loans, and any other obligations.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Mortgage: $210,000 balance, $1,850/month; Car loan: $11,000 balance, $420/month; Student loans: $24,000 balance, $280/month; Visa credit card: $3,400 balance, min $85/month; MasterCard: $1,100 balance, min $35/month',
  },
  {
    id: 'dependentInfo',
    question: 'Dependent information',
    description: 'Names and ages of dependents. Note which parent currently claims each dependent for tax purposes and which parent pays each category of child-related expense.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Lily Morales, age 9 (currently claimed by Jennifer for taxes); Lucas Morales, age 6 (to be agreed). Jennifer currently pays all childcare and school expenses.',
  },
  {
    id: 'sourceDocuments',
    question: 'Source documents available for verification',
    description: 'What source documents has the attorney collected to verify the figures above? List them here so the verification checklist can reference them.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., 3 months pay stubs (Apex Corp); 2024 federal tax return; 3 months bank statements (First National checking and savings); most recent 401(k) statement; mortgage statement; car loan statement; credit card statements',
  },
];

const financialAffidavitPrompt = `You are assisting a licensed family law attorney in organizing financial affidavit inputs into a structured draft. You are not providing legal advice — you are organizing the figures the attorney has provided into a structured format for attorney review. The attorney will verify every figure against source documents before filing.

Client name: {{clientName}}
Jurisdiction: {{jurisdiction}}
Income sources: {{incomeSources}}
Monthly expenses: {{monthlyExpenses}}
Assets: {{assets}}
Debts and liabilities: {{debts}}
Dependent information: {{dependentInfo}}
Source documents available: {{sourceDocuments}}

Produce a structured financial affidavit draft in Markdown. Begin with the draft notice.

> **Draft document** — Verify all figures against source documents (pay stubs, bank statements, tax returns) before filing. Do not certify any financial affidavit based on AI-organized data without independent verification of every figure.

---

## Financial Affidavit — Draft

**Client:** {{clientName}}
**Jurisdiction:** {{jurisdiction}}
**Prepared:** [Date — insert at filing]

*All figures below are as provided by the attorney. Each line item must be verified against source documents before this affidavit is certified and filed.*

---

### Section 1: Income

#### Gross Monthly Income

| Income source | Gross monthly amount | Source document |
|---------------|---------------------|----------------|
[For each income source stated: list source, gross monthly amount (convert to monthly if weekly or annual), and note the source document that should be used to verify it.]

**Total gross monthly income:** $[sum of above — ATTORNEY: verify this total]

#### Net Monthly Income

| Income source | Net monthly amount | Basis |
|---------------|--------------------|-------|
[For each income source: list net monthly amount as stated. Flag any where net was not provided and attorney must calculate.]

**Total net monthly income:** $[ATTORNEY: verify]

---

### Section 2: Monthly Expenses

| Category | Monthly amount | Source / notes |
|----------|---------------|----------------|
[Organize all expenses by standard category: housing, utilities, food, transportation, insurance, healthcare, childcare, education, debt service, other. List each line item as provided by attorney with the source document or basis noted.]

**Total monthly expenses:** $[sum — ATTORNEY: verify]

**Monthly net cash flow (Income - Expenses):** $[ATTORNEY: calculate and verify]

---

### Section 3: Assets

| Asset | Estimated value | Outstanding balance | Net equity | Source document |
|-------|----------------|--------------------|-----------:|----------------|
[For each asset: list description, estimated value, any outstanding loan, net equity, and source document. Flag any asset where value is estimated vs. appraised.]

**Total estimated assets:** $[ATTORNEY: verify]
**Total estimated net equity:** $[ATTORNEY: verify]

---

### Section 4: Liabilities

| Creditor / debt | Balance | Monthly payment | Source document |
|----------------|---------|----------------|----------------|
[For each liability: list creditor, balance, monthly payment, and source document.]

**Total liabilities:** $[ATTORNEY: verify]

---

### Section 5: Dependents

[Organize dependent information as provided: names, ages, which parent claims for taxes, and which parent currently pays each category of child-related expense.]

---

### Verification Checklist

Every figure in this affidavit must be verified against the source documents listed before filing. Check each item off after verification.

| Line item | Source document | Verified by | Date verified |
|-----------|----------------|-------------|---------------|
[For each material figure: list the line item, the source document that should verify it, and leave columns for the attorney to initial and date after verification.]

- [ ] All income figures verified against pay stubs, tax returns, or other source documents
- [ ] All expense figures verified against statements and receipts
- [ ] All asset values verified against statements or appraisals
- [ ] All debt balances verified against current statements
- [ ] Monthly totals re-calculated and confirmed by attorney
- [ ] Figures consistent with {{jurisdiction}} financial affidavit form requirements
- [ ] Affidavit certified by client under oath only after all figures verified

---

*This financial affidavit was organized by ${BRAND.messaging.redlineAuthor}. Do not certify or file this document until all figures have been independently verified against source documents.*`;

export const FinancialAffidavitOrganizer: WorkflowTemplate = {
  id: 'financial-affidavit-organizer',
  name: 'Financial Affidavit Organizer',
  description: 'Organizes financial-affidavit inputs into a structured draft. Does not calculate support amounts — produces the organized record you verify and certify.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Verify all figures against source documents (pay stubs, bank statements, tax returns) before filing. Do not certify any financial affidavit based on AI-organized data without independent verification of every figure.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Financial Affidavit Details',
      description: 'Provide income, expenses, assets, debts, and dependent information',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-financial-affidavit',
      type: 'generate',
      name: 'Generate Financial Affidavit Draft',
      description: 'Produce a structured affidavit draft with verification checklist',
      config: {
        outputFile: 'FINANCIAL_AFFIDAVIT_DRAFT.docx',
        promptTemplate: financialAffidavitPrompt,
        systemPrompt: 'You are a family law practice assistant helping a licensed attorney organize financial affidavit information into a structured draft. You organize figures as provided by the attorney — you never invent numbers, calculate support amounts, or make assumptions about values that were not stated. Every figure you include must be labeled with its source as provided by the attorney. Where a figure was not provided (e.g., net income was not stated), flag it clearly as something the attorney must calculate and verify. Produce a detailed verification checklist that maps each line item to the source document that should confirm it. Use plain, direct language. Avoid em dashes.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['FINANCIAL_AFFIDAVIT_DRAFT.docx'],
  namedOutputs: [
    { id: 'affidavit_draft', name: 'Financial affidavit draft', schema: 'string' },
    { id: 'income_summary', name: 'Income summary table', schema: 'string' },
    { id: 'verification_checklist', name: 'Figure verification checklist', schema: 'array' },
  ],
};

export default FinancialAffidavitOrganizer;
