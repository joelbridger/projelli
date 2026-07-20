// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'caseType',
    question: 'Case type',
    description: 'The type of case or claim. List all causes of action if there are multiple, since each may carry a different statute of limitations.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Personal injury (negligence); breach of written contract; premises liability',
  },
  {
    id: 'jurisdiction',
    question: 'Jurisdiction',
    description: 'The controlling jurisdiction. Include the state and, if filed or anticipated to be filed, the specific court.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Texas state court, Dallas County; U.S. District Court, N.D. Tex.',
  },
  {
    id: 'incidentDate',
    question: 'Incident / accrual date',
    description: 'The date the cause of action accrued (injury date, breach date, discovery date, etc.). If accrual is disputed, provide the earliest possible date and the disputed alternative.',
    type: 'text',
    required: true,
    placeholder: 'e.g., March 15, 2024 (injury); disputed accrual possibly as late as June 1, 2024 (discovery rule)',
  },
  {
    id: 'filingDate',
    question: 'Date action was or will be filed (if known)',
    description: 'If the action has already been filed, the actual filing date. If not yet filed, leave blank or enter the anticipated filing date.',
    type: 'text',
    required: false,
    placeholder: 'e.g., Filed January 10, 2025; or blank if not yet filed',
  },
  {
    id: 'keyEvents',
    question: 'Key procedural events and known deadlines',
    description: 'List any events you already know with their dates: service of process, answer due date, scheduling order dates, expert designation deadlines, discovery cutoff, dispositive motion deadline, trial date, etc. The template will organize these and flag gaps.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Summons served Feb 3, 2025; Answer due Feb 24, 2025; Scheduling conference set April 1, 2025; Trial date not yet set',
  },
  {
    id: 'specialConsiderations',
    question: 'Special circumstances affecting deadlines (optional)',
    description: 'Tolling agreements, government claims act requirements, minors or incapacitated parties, bankruptcy stays, prior related actions, or any other factors that may affect when the SOL runs.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Claimant is a minor (tolling may apply); government entity defendant (claims act notice required); prior action filed and dismissed',
  },
];

const deadlineCalendarPrompt = `You are assisting a licensed attorney in organizing case deadlines into a structured record. You are not providing legal advice and you are not computing or confirming any deadline. The attorney will verify every date against applicable court rules and statutes before docketing anything.

Case type: {{caseType}}
Jurisdiction: {{jurisdiction}}
Incident / accrual date: {{incidentDate}}
Date action filed: {{filingDate}}
Key procedural events and known deadlines: {{keyEvents}}
Special circumstances: {{specialConsiderations}}

Produce a structured deadline and SOL calendar in Markdown. Begin with the draft notice.

> **Draft document** — This record was structured by AI. Do not docket any date without independent attorney verification against applicable court rules and the specific SOL for each claim.

---

## Deadline and SOL Calendar

**Client file:** [Describe briefly based on inputs]
**Jurisdiction:** {{jurisdiction}}
**Case type / claims:** {{caseType}}
**Accrual date:** {{incidentDate}}
**Filing date:** {{filingDate}}

---

### SOL Critical Dates

For each cause of action identified, describe the type of limitations period that typically applies in the stated jurisdiction and what governs when it begins to run. Do NOT calculate or state a specific deadline date — describe the rule and instruct the attorney to confirm the applicable period and run date.

| Claim | Typical SOL category | What starts the clock | Attorney action required |
|-------|---------------------|----------------------|--------------------------|
| [claim from input] | [e.g., 2-year personal injury] | [e.g., date of injury or discovery] | CONFIRM: verify current statute and any tolling |

**SOL flags:** Note any circumstances from the input that could affect when the limitations period runs (tolling for minors, discovery rule, government claims act pre-suit requirements, prior dismissed action, etc.). For each, describe the rule and flag it as requiring attorney verification.

---

### Known Procedural Deadlines

Organize the dates and events provided by the attorney into a structured tracking table.

| Deadline | Date (from attorney input) | Source / rule | Status | Notes |
|----------|---------------------------|--------------|--------|-------|
| [event from keyEvents] | [date as provided] | [note applicable rule if obvious] | [ ] | |

---

### Anticipated Deadlines (Gaps to Confirm)

Based on the claims and jurisdiction stated, identify categories of deadlines the attorney should verify and docket if they apply. For each, describe what it is and what rule typically governs it. Do NOT calculate specific dates.

- **Answer deadline:** [Describe the rule; attorney must confirm based on service date and applicable rules]
- **Expert designation:** [Describe typical scheduling order requirement; confirm against actual scheduling order]
- **Discovery cutoff:** [Describe typical scheduling order requirement]
- **Dispositive motion deadline:** [Describe typical rule]
- **Pre-trial filings:** [Describe typical requirement]
- [Other categories as relevant to the case type]

---

### Pre-Suit Requirements

Note any pre-suit notice or claims act requirements that may apply based on the stated jurisdiction and defendant type (government entity, healthcare provider, etc.). Describe the requirement and flag it as requiring attorney verification.

---

### Verification Checklist

- [ ] SOL confirmed against current statute for each claim in {{jurisdiction}}
- [ ] Tolling analysis complete (minor, discovery rule, agreement, prior action, etc.)
- [ ] Government claims act pre-suit notice confirmed if applicable
- [ ] All dates in the Known Deadlines table confirmed against source documents
- [ ] Scheduling order reviewed and all court-imposed dates docketed
- [ ] All docketed dates verified in firm calendaring system

---

*This calendar was structured by ${BRAND.messaging.redlineAuthor} and requires attorney verification before any date is docketed. AI does not calculate deadlines.*`;

export const DeadlineCalendar: WorkflowTemplate = {
  id: 'deadline-calendar',
  name: 'Deadline and SOL Calendar',
  description: 'Structures case facts into a deadline checklist — statutes of limitations, court filing dates, and discovery cutoffs. Flags which are SOL-critical. Does not compute deadlines; produces the structured record you docket.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Verify every deadline against applicable court rules and the specific SOL for each claim. This template produces a structured record — do not docket any date without independent confirmation.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Case and Deadline Details',
      description: 'Provide case type, jurisdiction, incident date, filing date, and known procedural events',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-deadline-calendar',
      type: 'generate',
      name: 'Generate Deadline and SOL Calendar',
      description: 'Produce a structured deadline record with SOL flags and verification checklist',
      config: {
        outputFile: 'DEADLINE_CALENDAR.docx',
        promptTemplate: deadlineCalendarPrompt,
        systemPrompt: 'You are a legal practice assistant helping a licensed attorney organize case deadline information into a structured record. You write with precision and you never calculate or assert a specific legal deadline or statute of limitations expiration date — that determination belongs to the attorney. Your job is to organize what the attorney has provided, describe what rules typically govern each deadline category, and produce a checklist of what the attorney must verify and docket. When you describe a limitations period, describe the category and rule — never state "the deadline is [date]." Always flag tolling analysis, government claims act requirements, and any special circumstances as items requiring attorney action. Use plain, direct language. Avoid em dashes.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['DEADLINE_CALENDAR.docx'],
  namedOutputs: [
    { id: 'deadline_calendar', name: 'Deadline and SOL calendar', schema: 'string' },
    { id: 'sol_flags', name: 'SOL critical flags', schema: 'array' },
    { id: 'verification_checklist', name: 'Verification checklist', schema: 'array' },
  ],
};

export default DeadlineCalendar;
