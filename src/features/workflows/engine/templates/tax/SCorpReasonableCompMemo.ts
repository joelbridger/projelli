// Tax Practice Pack v2.2 (shipped). Built with input from practicing CPAs and EAs.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'shareholderName',
    question: 'Shareholder-employee name',
    description: 'Name of the shareholder-employee whose compensation is being analyzed.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Sandra K. Trevino',
  },
  {
    id: 'roleTitle',
    question: 'Role and title',
    description: 'The shareholder-employee\'s title and primary role in the business.',
    type: 'text',
    required: true,
    placeholder: 'e.g., President and sole owner — licensed civil engineer providing structural consulting services',
  },
  {
    id: 'dutiesAndResponsibilities',
    question: 'Duties and responsibilities',
    description: 'Describe the specific work the shareholder-employee performs. Be detailed — the IRS examines whether salary is commensurate with actual duties performed.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Performs all client-facing engineering work, signs and seals all structural plans, manages 3 project managers, handles business development, attends client meetings approximately 20 hours/week',
  },
  {
    id: 'timeAllocation',
    question: 'Time allocation',
    description: 'Approximate weekly hours worked in the business, and how time is split across functions.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 50 hours/week total: 30 hours billable engineering work, 10 hours management, 10 hours business development and administration',
  },
  {
    id: 'industry',
    question: 'Industry and geography',
    description: 'Industry and geographic market, which anchor the comparability analysis.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Civil/structural engineering consulting, Dallas-Fort Worth metro area',
  },
  {
    id: 'comparableMarketData',
    question: 'Comparable compensation data (optional)',
    description: 'Any market compensation data you have gathered (BLS OES, AICPA survey, LinkedIn Salary, etc.). Include source, role surveyed, and compensation range. Leave blank if you want the memo to flag this as a data gap.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., BLS OES May 2024 — Civil Engineers, Dallas-Fort Worth: median $112,000, 75th pct $138,000; NSPE salary survey 2024 — PE with 15+ years experience: median $135,000',
  },
  {
    id: 'currentSalary',
    question: 'Current W-2 salary paid',
    description: 'The W-2 salary amount currently being paid to the shareholder-employee.',
    type: 'text',
    required: true,
    placeholder: 'e.g., $72,000 per year',
  },
  {
    id: 'distributionsHistory',
    question: 'S-corp distributions history',
    description: 'Total distributions paid to the shareholder in the year(s) under analysis. Ratio of salary to total compensation (salary + distributions) is a key audit trigger.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 2023: $148,000 in distributions; 2024: $162,000 in distributions. Salary-to-total-comp ratio: approximately 33%.',
  },
  {
    id: 'qualificationsExperience',
    question: 'Qualifications and experience',
    description: 'Relevant credentials, licenses, years of experience, and education.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Licensed PE (Texas, 18 years); B.S. Civil Engineering; 22 years industry experience; serves on city infrastructure advisory board',
  },
  {
    id: 'taxYear',
    question: 'Tax year(s) this memo covers',
    description: 'The year or years the reasonable comp analysis is documenting.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Tax years 2023 and 2024',
  },
];

const sCorpReasonableCompMemoPrompt = `You are assisting a licensed tax professional in structuring a reasonable compensation analysis for an S-corporation shareholder-employee. This is a practitioner work-product document for the client file. You are organizing the analysis, not providing an independent appraisal or legal opinion.

Shareholder-employee: {{shareholderName}}
Role and title: {{roleTitle}}
Duties and responsibilities: {{dutiesAndResponsibilities}}
Time allocation: {{timeAllocation}}
Industry and geography: {{industry}}
Comparable market data: {{comparableMarketData}}
Current W-2 salary: {{currentSalary}}
Distributions history: {{distributionsHistory}}
Qualifications and experience: {{qualificationsExperience}}
Tax years covered: {{taxYear}}

Produce a formatted reasonable compensation memo in Markdown. Begin with the draft notice.

> **Draft document** — Review and verify all comparable compensation data before relying on this memo in an IRS examination or client discussion.

---

# S-Corp Reasonable Compensation Memo
**PRACTITIONER WORK PRODUCT — PRIVILEGED AND CONFIDENTIAL**

**Shareholder-employee:** {{shareholderName}}
**Entity:** [S-Corp name — add]
**Tax year(s):** {{taxYear}}
**Prepared by:** [Practitioner name]
**Date:** [Date]

---

## Background and Purpose

This memorandum documents the reasonable compensation analysis for {{shareholderName}}, a shareholder-employee of [S-Corp name], for tax year(s) {{taxYear}}. The purpose is to document the basis for the W-2 salary paid, in accordance with the IRS requirement under IRC §3121(d) and longstanding case law that S-corporation officer-employees who provide services must be paid reasonable compensation subject to employment taxes.

---

## Section 1 — The Reasonable Compensation Factors

The IRS and Tax Court have applied a multi-factor framework to evaluate reasonable compensation. The following factors are drawn from case law including Pediatric Surgical Associates, P.C. v. Commissioner and subsequent authority (verify citations against primary sources). Each factor is addressed for {{shareholderName}}.

### 1. Duties and Responsibilities

{{dutiesAndResponsibilities}}

[Analyze how the scope and nature of duties compare to a hypothetical third-party employee performing the same functions. Note whether the shareholder-employee is the primary revenue-generating professional, a manager, or both.]

### 2. Time and Effort Devoted to the Business

{{timeAllocation}}

[Note total hours and how time is distributed. High billable-hour involvement by the sole or primary owner is a factor supporting higher reasonable comp.]

### 3. Training, Experience, and Qualifications

{{qualificationsExperience}}

[Analyze how credentials and experience bear on market compensation. Licensed professionals and specialists with hard-to-replace expertise typically command above-median compensation.]

### 4. Compensation Paid to Comparable Employees

[If comparable data was provided, present and analyze it here. If no data was provided, flag this as a documentation gap and recommend obtaining at least one market survey source before finalizing the analysis.]

Comparable data provided: {{comparableMarketData}}

[Analyze the provided data — or flag the data gap.]

### 5. Compensation Paid by Similar Companies for Similar Services

[Describe the relevant labor market (geography, industry, firm size) and what comparable employers pay for comparable services. Reference any survey data provided. Note if the company size or market position would justify a premium or discount relative to the survey median.]

### 6. Character and Condition of the Organization

[Briefly describe the S-corp's size, revenue, and stage. A highly profitable small firm whose profits depend substantially on the shareholder-employee's personal services is a context where below-median salaries are particularly scrutinized.]

### 7. Conflict of Interest — Relationship Between Shareholder and Compensation Decision

[Note that as the sole or controlling shareholder, {{shareholderName}} sets their own compensation. This conflict of interest makes the IRS more likely to scrutinize below-median salaries. The documentation in this memo is designed to address this scrutiny.]

---

## Section 2 — Analysis and Conclusion

**Current W-2 salary:** {{currentSalary}}
**Distributions in the period:** {{distributionsHistory}}
**Salary as a percentage of total compensation:** [Calculate and display]

[Analyze whether the current salary is reasonable in light of the factors above and the market data. State a conclusion:]
- If the salary appears to be in the reasonable range: state so, note the market data supporting it, and identify any risk factors.
- If the salary appears low relative to market: state this plainly, quantify the gap, and recommend a salary adjustment. Note the payroll tax exposure on the gap amount.
- If data is insufficient to conclude: state what data is needed to complete the analysis.

**Conclusion:** [State whether the current salary of {{currentSalary}} is, is not, or may not be reasonable compensation for the services performed, based on the analysis above. Frame as a practitioner's documented judgment, not a guarantee.]

---

## Section 3 — Risk Factors and Mitigants

[List the factors that increase IRS examination risk for this situation and the mitigants documented by this memo.]

**Risk factors to note:**
- [ ] Salary-to-total-compensation ratio below 40% is a known audit trigger (calculate the actual ratio here)
- [ ] Sole or controlling shareholder setting own salary
- [ ] Prior years with similar low salary ratios
- [ ] Industry where personal services generate most revenue (professional services)

**Mitigants documented:**
- Comparable market data on file
- Specific duties and time allocation documented
- Qualifications and experience documented
- This memo in the client file

---

## Section 4 — Documentation Checklist for the Client File

- [ ] Copy of this memo, signed and dated by the preparer
- [ ] Comparable compensation sources (print or export from BLS, AICPA, or other survey — note date accessed)
- [ ] Description of duties reviewed and confirmed with client
- [ ] W-2 and payroll records for the period
- [ ] S-corp income statement showing distributions and net income
- [ ] Any third-party appraisal or compensation study (if obtained)
- [ ] Annual review: document that compensation was reviewed each year

---

## Citations and Verification

The following authorities are referenced in this memo. Verify each before relying on this memo in an examination.

| Status | Authority | Description | Verified |
|--------|-----------|-------------|---------|
| UNVERIFIED | IRC §3121(d) | Definition of employee for FICA purposes — officer rule | ____________ |
| UNVERIFIED | Rev. Rul. 74-44 | S-corp distributions recharacterized as wages | ____________ |
| UNVERIFIED | Pediatric Surgical Associates, P.C. v. Commissioner | Multi-factor reasonable comp framework (verify citation) | ____________ |

*Change UNVERIFIED to VERIFIED after checking each authority against primary source.*

---

*This memorandum is a practitioner work-product document for internal file purposes. It reflects a framework analysis based on the facts and data provided. It is not a compensation appraisal. Comparable compensation data must be verified against current market sources before relying on this memo in an IRS examination.*`;

export const SCorpReasonableCompMemo: WorkflowTemplate = {
  id: 'scorp-reasonable-comp-memo',
  name: 'S-Corp Reasonable Compensation Memo',
  description: 'Structures a reasonable-compensation analysis for S-corp shareholder-employees — documents the factors, comparable roles, and supporting rationale. Produces a memo for the client file.',
  version: '1.0.0',
  category: 'tax',
  requiresVerification: true,
  verificationNote: 'Verify all comparable compensation data against current market sources before relying on this memo in an IRS examination. The analysis is a starting framework, not an appraisal.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Shareholder and Compensation Details',
      description: 'Provide shareholder role, duties, compensation history, and market data',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-reasonable-comp-memo',
      type: 'generate',
      name: 'Generate Reasonable Compensation Memo',
      description: 'Draft the multi-factor reasonable compensation analysis memo for the client file',
      config: {
        outputFile: 'SCORP_REASONABLE_COMP_MEMO.md',
        promptTemplate: sCorpReasonableCompMemoPrompt,
        systemPrompt: 'You are a tax practice assistant helping a licensed CPA or EA document a reasonable compensation analysis for an S-corporation shareholder-employee. You understand the IRS multi-factor framework for reasonable compensation and the audit risk associated with low salary-to-distribution ratios. You are precise about what this memo is: a structured file documentation tool, not a compensation appraisal. You always note when comparable data is insufficient and recommend obtaining independent market data.\n\nCRITICAL: The reasonable compensation standard is fact-intensive and evolves through case law. Every case citation and IRC section reference in this memo must be verified against primary authority before relying on it in an examination. Salary-to-total-comp ratios flagged by the IRS change over time — verify current guidance before concluding any salary is definitively reasonable or unreasonable.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['SCORP_REASONABLE_COMP_MEMO.md'],
  namedOutputs: [
    { id: 'factors_analysis', name: 'Reasonable compensation factors analysis', schema: 'string' },
    { id: 'conclusion', name: 'Compensation conclusion', schema: 'string' },
    { id: 'documentation_checklist', name: 'Documentation checklist', schema: 'string' },
  ],
};

export default SCorpReasonableCompMemo;
