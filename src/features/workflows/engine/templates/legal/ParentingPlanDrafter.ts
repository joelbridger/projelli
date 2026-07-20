// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'parties',
    question: 'Parties',
    description: 'Names of both parents. Used throughout the plan.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Parent A: Maria Reyes; Parent B: Carlos Reyes',
  },
  {
    id: 'children',
    question: 'Children — names and ages',
    description: 'Names and ages (or dates of birth) of all children covered by this plan.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Sofia, age 8 (DOB Jan 12, 2017); Mateo, age 5 (DOB March 3, 2020)',
  },
  {
    id: 'currentLivingSituation',
    question: 'Current living situation',
    description: 'Where each child currently lives, how custody is currently arranged (if at all), and how long this arrangement has been in place.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Children currently live primarily with Maria in Austin, TX. Carlos lives 8 miles away. Informal shared schedule has been in place since separation in August 2024 — children with Carlos on weekends.',
  },
  {
    id: 'clientPriorities',
    question: 'Client priorities',
    description: 'What your client most wants from the parenting plan. What custody arrangement are they seeking? What concerns do they have about the other parent or the children\'s wellbeing?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Client (Maria) seeks primary physical custody with Carlos having every-other-weekend. Concerned about Carlos\'s work travel schedule affecting reliability. Wants final decision-making authority on education and healthcare.',
  },
  {
    id: 'knownDisputes',
    question: 'Known disputes or sensitive issues',
    description: 'Areas where the parties disagree, any safety or welfare concerns, or any circumstances (relocation, work schedules, school schedules, special needs) that the plan must address.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Dispute over school choice for Sofia (entering middle school); Carlos objects to primary with Maria; no domestic violence or safety concerns; Sofia has ADHD with medication schedule that must be coordinated',
  },
  {
    id: 'jurisdiction',
    question: 'State / jurisdiction',
    description: 'The state governing this parenting plan. Best-interests standards and specific plan requirements vary by state.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Texas; California; New York',
  },
];

const parentingPlanPrompt = `You are assisting a licensed family law attorney in structuring a parenting plan outline from client intake notes. You are not providing legal advice — you are producing a structured outline for attorney review. The attorney will adapt this outline to the specific client circumstances, applicable state law, and the children's best interests before presenting it to the client or court.

Parent A / Parent B: {{parties}}
Children (names and ages): {{children}}
Current living situation: {{currentLivingSituation}}
Client priorities: {{clientPriorities}}
Known disputes or sensitive issues: {{knownDisputes}}
State / jurisdiction: {{jurisdiction}}

Produce a structured parenting plan outline in Markdown. Begin with the draft notice.

> **Draft document** — Review all custody and access provisions against the client's specific circumstances and applicable {{jurisdiction}} standards for best interests of the child. Do not present any parenting plan to a client or court without attorney review.

---

## Parenting Plan Outline

**Parties:** {{parties}}
**Children:** {{children}}
**Jurisdiction:** {{jurisdiction}}

*This outline is based on intake notes and requires attorney review and completion before use.*

---

### 1. Legal Custody

**[ATTORNEY: Complete this section based on client strategy and applicable {{jurisdiction}} law]**

[Describe the options: sole legal custody vs. joint legal custody. Note what "legal custody" typically covers in {{jurisdiction}} — major decisions regarding education, healthcare, extracurricular activities, religious upbringing. Describe the proposed arrangement based on client priorities. Flag the key dispute points the attorney noted above.]

Proposed arrangement: [Based on client priorities stated above]
Key open issues: [Flag disputes from input]

---

### 2. Physical Custody and Primary Residence

**[ATTORNEY: Complete based on proposed schedule and {{jurisdiction}} standards]**

Proposed primary residence: [Based on client priorities]
Standard parenting time schedule: [Describe the proposed regular schedule as a starting framework]

---

### 3. Regular Parenting Time Schedule

**Weekday schedule:**
[Describe proposed weekday arrangement — which nights each parent has the children]

**Weekend schedule:**
[Describe the proposed weekend rotation — e.g., every other weekend, defined times]

**Transition logistics:**
- Pickup/dropoff location: [FILL IN]
- Pickup/dropoff time: [FILL IN]
- Responsible party for transportation: [FILL IN]

---

### 4. Holiday and Vacation Schedule

[Produce a structured table for standard holidays. For each holiday, propose a default allocation (alternating, fixed, or split) as a starting framework for attorney review.]

| Holiday / School Break | Year 1 | Year 2 | Notes |
|------------------------|--------|--------|-------|
| Winter break (school) | [Parent A / Parent B] | [Parent B / Parent A] | [Define start/end] |
| Thanksgiving break | | | |
| Spring break | | | |
| Summer vacation | | | [Define total weeks each parent; note school start/end] |
| Mother's Day | Parent A | Parent A | |
| Father's Day | Parent B | Parent B | |
| Child's birthday | [Alternating / or split day] | | |
| Parent A's birthday | | | |
| Parent B's birthday | | | |
| [Other significant holidays relevant to the family] | | | |

**Vacation planning:**
- Advance notice required: [FILL IN — typically 30-60 days]
- Passport and travel consent provisions: [FILL IN if applicable]

---

### 5. Decision-Making Authority

**Education:**
[Describe proposed decision-making authority for school choice, enrollment, IEP/504 decisions, tutoring. Flag the Sofia school dispute identified in intake.]

**Healthcare:**
[Describe proposed decision-making for routine care, specialists, medications, mental health. Note medication coordination issue from intake if applicable.]

**Extracurricular activities:**
[Describe proposed decision-making for activities and associated costs.]

**Religious upbringing:**
[Note if raised in intake; if not raised, include as a section with a placeholder.]

---

### 6. Communication Between Parents

- Preferred method: [e.g., email / co-parenting app / text for routine matters]
- Response time expectation: [e.g., within 24 hours for routine; immediately for emergencies]
- Co-parenting communication platform: [e.g., OurFamilyWizard, TalkingParents — optional but recommended]
- Emergency contact protocol: [Each parent provides emergency contact info; immediate notification required for medical emergencies]

---

### 7. Communication Between Children and Non-Residential Parent

- Children may contact the non-residential parent by phone or video at reasonable times
- Neither parent will interfere with the children's communications with the other parent
- [Add any specific provisions relevant to the children's ages]

---

### 8. Right of First Refusal

[If applicable: if the residential parent requires childcare for more than [X] hours, the other parent has the first right to care for the children before outside childcare is arranged. ATTORNEY: determine whether to include and set the threshold.]

---

### 9. Relocation

- Neither parent shall relocate with the children more than [XX] miles from [reference location] without [X days] advance written notice and [court approval / written consent of the other parent].
- [Note applicable {{jurisdiction}} relocation statute — ATTORNEY: verify current statute and notice requirements.]

---

### 10. Dispute Resolution

[Describe proposed dispute resolution process: direct negotiation, mediation before litigation, parenting coordinator. Note any disputes from intake that may require a specific process.]

---

### Verification Checklist for Attorney

- [ ] Legal custody arrangement confirmed consistent with {{jurisdiction}} standards
- [ ] Physical custody schedule reviewed against client's specific work and school schedule
- [ ] Holiday schedule reviewed against client's family and cultural traditions
- [ ] All decision-making provisions consistent with client priorities and known disputes
- [ ] Relocation provision verified against current {{jurisdiction}} statute
- [ ] Medication and special needs provisions complete (if applicable)
- [ ] Plan reviewed with client before presenting to opposing party or court

---

*This parenting plan outline was structured by ${BRAND.messaging.redlineAuthor}. All custody and access provisions require attorney review against the specific client circumstances and applicable {{jurisdiction}} best-interests standards before use.*`;

export const ParentingPlanDrafter: WorkflowTemplate = {
  id: 'parenting-plan-drafter',
  name: 'Parenting Plan Drafter',
  description: 'Structures a parenting plan outline from intake notes — physical custody, legal custody, holiday schedule, decision-making, and communication protocol. You review before presenting to the client or court.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Review all custody and access provisions against the client\'s specific circumstances and applicable state standards for best interests. Do not present any parenting plan to a client or court without attorney review.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Family and Custody Details',
      description: 'Provide parties, children, current living situation, client priorities, and known disputes',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-parenting-plan',
      type: 'generate',
      name: 'Generate Parenting Plan Outline',
      description: 'Produce a structured parenting plan outline covering all standard sections',
      config: {
        outputFile: 'PARENTING_PLAN_OUTLINE.docx',
        promptTemplate: parentingPlanPrompt,
        systemPrompt: 'You are a family law practice assistant helping a licensed attorney structure a parenting plan outline from client intake notes. You produce structured, organized outlines that cover all standard sections of a parenting plan: legal custody, physical custody, regular parenting time, holiday schedule, decision-making, parent communication, child communication, right of first refusal, relocation, and dispute resolution. You use the intake information to populate the outline with a proposed starting framework, clearly marking where the attorney must fill in client-specific detail. You never advise on what is in the best interests of a specific child — you describe standard options and defer to the attorney. You do not express a view on contested custody disputes. Use plain, direct language. Avoid em dashes.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['PARENTING_PLAN_OUTLINE.docx'],
  namedOutputs: [
    { id: 'parenting_plan', name: 'Parenting plan outline', schema: 'string' },
    { id: 'key_disputes', name: 'Key disputed issues flagged', schema: 'array' },
    { id: 'verification_checklist', name: 'Attorney verification checklist', schema: 'array' },
  ],
};

export default ParentingPlanDrafter;
