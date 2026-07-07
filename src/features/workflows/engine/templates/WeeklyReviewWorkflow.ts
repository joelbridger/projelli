// Weekly Review Workflow Template
// Helps professionals conduct weekly business reviews

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'businessName',
    question: 'What is your business name?',
    description: 'The name of your practice or firm',
    type: 'text',
    required: true,
    placeholder: 'e.g., TaskFlow',
  },
  {
    id: 'weekHighlights',
    question: 'What were your wins this week?',
    description: 'Accomplishments, milestones, positive developments',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Closed a new client engagement, won a contested client file, delivered a project on time, had a strong client call',
  },
  {
    id: 'weekChallenges',
    question: 'What challenges did you face?',
    description: 'Problems, setbacks, frustrations',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Proposal didn\'t convert, spent too much time on admin instead of billable work, difficult client situation',
  },
  {
    id: 'keyMetrics',
    question: 'What are your key metrics this week?',
    description: 'Numbers that matter (billable hours, active clients, revenue, pipeline, etc.)',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Billable hours: 32 hrs (+4), Active client matters: 18, Revenue collected: $12,400, New engagements signed: 1',
  },
  {
    id: 'tasksCompleted',
    question: 'What tasks did you complete?',
    description: 'Major items you checked off',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Filed motion, completed client deliverable, sent 3 proposals, updated engagement letter template',
  },
  {
    id: 'tasksIncomplete',
    question: 'What tasks are still in progress or blocked?',
    description: 'Items that carried over or got stuck',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Waiting on client documents to proceed, contract review still in progress, intake for new client not yet started',
  },
  {
    id: 'learnings',
    question: 'What did you learn this week?',
    description: 'Insights about customers, product, market, yourself',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Clients respond faster to phone than email, bundling related tasks cuts context-switching, I need to protect morning hours for deep work',
  },
  {
    id: 'nextWeekPriorities',
    question: 'What are your top 3 priorities for next week?',
    description: 'The most important things to focus on',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 1) Finish brief due Thursday, 2) Follow up with 3 prospective clients, 3) Complete Q2 billing run',
  },
  {
    id: 'energyLevel',
    question: 'How are you feeling? (Professional wellbeing)',
    description: 'Your energy, motivation, stress levels',
    type: 'select',
    required: true,
    options: ['Energized and motivated', 'Good, steady pace', 'Okay, some stress', 'Tired but pushing through', 'Burnt out, need rest'],
    defaultValue: 'Good, steady pace',
  },
  {
    id: 'helpNeeded',
    question: 'What help or resources do you need?',
    description: 'Support, advice, connections, tools',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Referral to a specialist for client work outside my practice area, advice on fee structure, recommendation for a bookkeeper',
  },
];

const weeklyReviewPrompt = `You are helping a professional conduct their weekly business review.

Based on the following information:

**Business:** {{businessName}}
**Wins:** {{weekHighlights}}
**Challenges:** {{weekChallenges}}
**Metrics:** {{keyMetrics}}
**Completed:** {{tasksCompleted}}
**Incomplete:** {{tasksIncomplete}}
**Learnings:** {{learnings}}
**Next Week:** {{nextWeekPriorities}}
**Energy Level:** {{energyLevel}}
**Help Needed:** {{helpNeeded}}

Generate a Weekly Review document in Markdown format:

# {{businessName}} Weekly Review

**Week of:** [Current date range]
**Name:** [Name]

---

## Executive Summary
[2-3 sentence overview of how the week went and what's most important for next week]

---

## Wins

### Key Accomplishments
1. **[Win 1]** - [Why this matters]
2. **[Win 2]** - [Why this matters]
3. **[Win 3]** - [Why this matters]

### Celebrate
[Brief note on what to feel good about]

---

## Challenges & Learnings

### Challenges Faced
1. **[Challenge 1]**
   - What happened: [Description]
   - Impact: [How it affected progress]
   - Learning: [What you learned]

2. **[Challenge 2]**
   - What happened: [Description]
   - Impact: [How it affected progress]
   - Learning: [What you learned]

### Key Insights
Based on this week's experiences:
- [Insight 1]
- [Insight 2]
- [Insight 3]

---

## Metrics Dashboard

### Key Numbers
| Metric | This Week | Last Week | Change | Trend |
|--------|-----------|-----------|--------|-------|
| [Metric 1] | | | | Up/Down/Flat |
| [Metric 2] | | | | Up/Down/Flat |
| [Metric 3] | | | | Up/Down/Flat |
| [Metric 4] | | | | Up/Down/Flat |

### Metrics Analysis
[Brief interpretation of what the numbers mean]

---

## Task Review

### Completed This Week
- [x] [Task 1]
- [x] [Task 2]
- [x] [Task 3]
- [x] [Task 4]
- [x] [Task 5]

### Carried Over / Blocked
- [ ] [Task 1] - [Why incomplete/blocked]
- [ ] [Task 2] - [Why incomplete/blocked]

### Completion Rate
[X]% of planned tasks completed

---

## Wellbeing Check

**Energy Level:** {{energyLevel}}

### Reflection
[Based on energy level, provide relevant advice]

### Self-Care Actions for Next Week
1. [Action based on current state]
2. [Action based on current state]

---

## Next Week Plan

### Top 3 Priorities
1. **[Priority 1]**
   - Why: [Reason this is most important]
   - Success looks like: [Clear outcome]
   - Time allocation: [Hours/days]

2. **[Priority 2]**
   - Why: [Reason this is important]
   - Success looks like: [Clear outcome]
   - Time allocation: [Hours/days]

3. **[Priority 3]**
   - Why: [Reason this is important]
   - Success looks like: [Clear outcome]
   - Time allocation: [Hours/days]

### Secondary Tasks
- [ ] [Task]
- [ ] [Task]
- [ ] [Task]

### Won't Do (Intentionally)
- [Thing to say no to]
- [Thing to say no to]

---

## Help Needed

### Requests
{{helpNeeded}}

### Specific Asks
1. [Specific, actionable request]
2. [Specific, actionable request]

---

## Notes for Future Self

### What to Remember
- [Important context or decision]
- [Important context or decision]

### Questions to Revisit
- [Open question]
- [Open question]

---

*Review completed: [Date]*`;

const actionPlanPrompt = `You are helping a professional create next week's action plan.

Based on:
**Business:** {{businessName}}
**Priorities:** {{nextWeekPriorities}}
**Incomplete Tasks:** {{tasksIncomplete}}
**Energy Level:** {{energyLevel}}
**Help Needed:** {{helpNeeded}}

Generate a Weekly Action Plan in Markdown format:

# {{businessName}} - Week of [Date Range]

## Weekly Focus
**Theme:** [One word/phrase that captures the week's focus]

**North Star Metric:** [The one number that matters most this week]
**Target:** [Specific target for that metric]

---

## Daily Plan

### Monday
**Focus:** [Theme for the day]
**Energy Allocation:** [High/Medium/Low energy work]

| Time Block | Task | Priority | Duration |
|------------|------|----------|----------|
| Morning | [Task] | P1/P2/P3 | Xhr |
| Mid-day | [Task] | P1/P2/P3 | Xhr |
| Afternoon | [Task] | P1/P2/P3 | Xhr |

**Must Complete:**
- [ ] [Most important task]

---

### Tuesday
**Focus:** [Theme for the day]
**Energy Allocation:** [High/Medium/Low energy work]

| Time Block | Task | Priority | Duration |
|------------|------|----------|----------|
| Morning | [Task] | P1/P2/P3 | Xhr |
| Mid-day | [Task] | P1/P2/P3 | Xhr |
| Afternoon | [Task] | P1/P2/P3 | Xhr |

**Must Complete:**
- [ ] [Most important task]

---

### Wednesday
**Focus:** [Theme for the day]
**Energy Allocation:** [High/Medium/Low energy work]

| Time Block | Task | Priority | Duration |
|------------|------|----------|----------|
| Morning | [Task] | P1/P2/P3 | Xhr |
| Mid-day | [Task] | P1/P2/P3 | Xhr |
| Afternoon | [Task] | P1/P2/P3 | Xhr |

**Must Complete:**
- [ ] [Most important task]

---

### Thursday
**Focus:** [Theme for the day]
**Energy Allocation:** [High/Medium/Low energy work]

| Time Block | Task | Priority | Duration |
|------------|------|----------|----------|
| Morning | [Task] | P1/P2/P3 | Xhr |
| Mid-day | [Task] | P1/P2/P3 | Xhr |
| Afternoon | [Task] | P1/P2/P3 | Xhr |

**Must Complete:**
- [ ] [Most important task]

---

### Friday
**Focus:** [Theme for the day]
**Energy Allocation:** [High/Medium/Low energy work]

| Time Block | Task | Priority | Duration |
|------------|------|----------|----------|
| Morning | [Task] | P1/P2/P3 | Xhr |
| Mid-day | [Task] | P1/P2/P3 | Xhr |
| Afternoon | [Task] | P1/P2/P3 | Xhr |

**Must Complete:**
- [ ] [Most important task]
- [ ] Weekly review

---

## Priority Matrix

### P1 - Must Do (Revenue/Critical)
1. [ ] [Task] - [Expected outcome]
2. [ ] [Task] - [Expected outcome]
3. [ ] [Task] - [Expected outcome]

### P2 - Should Do (Important)
1. [ ] [Task]
2. [ ] [Task]
3. [ ] [Task]

### P3 - Could Do (Nice to Have)
1. [ ] [Task]
2. [ ] [Task]

### Not This Week (Intentional No)
- [Task to defer]
- [Task to defer]

---

## Energy Management Plan

Based on: {{energyLevel}}

### High Energy Tasks (Do First)
- [Deep work requiring focus]
- [Creative work]
- [Important calls/meetings]

### Low Energy Tasks (Do When Tired)
- [Administrative tasks]
- [Email/communication]
- [Routine tasks]

### Recovery Activities
- [Self-care item]
- [Self-care item]

---

## Potential Blockers

| Blocker | Likelihood | Mitigation |
|---------|------------|------------|
| [Blocker 1] | High/Med/Low | [Plan] |
| [Blocker 2] | High/Med/Low | [Plan] |

---

## Quick Reference

### Key Contacts This Week
- [Person] - [Purpose] - [Contact method]
- [Person] - [Purpose] - [Contact method]

### Important Deadlines
- [Day]: [Deadline]
- [Day]: [Deadline]

### Links/Resources Needed
- [Resource]
- [Resource]

---

## End of Week Checklist
- [ ] All P1 tasks completed
- [ ] Metrics tracked
- [ ] Customer interactions logged
- [ ] Week reviewed
- [ ] Next week planned

---

*Plan created: [Date]*
*Adjust as needed - done is better than perfect!*`;

export const WeeklyReviewWorkflow: WorkflowTemplate = {
  id: 'weekly-review',
  name: 'Weekly Review',
  description: 'Conduct a comprehensive weekly review and create next week\'s action plan.',
  version: '1.0.0',
  category: 'planning',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Weekly Review Questions',
      description: 'Reflect on your week and plan ahead',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-review',
      type: 'generate',
      name: 'Generate Weekly Review',
      description: 'Create a comprehensive weekly review document',
      config: {
        outputFile: 'WEEKLY_REVIEW.md',
        promptTemplate: weeklyReviewPrompt,
        systemPrompt: 'You are a professional practice advisor helping practitioners reflect on their progress and learn from their experiences. Be encouraging but honest.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-plan',
      type: 'generate',
      name: 'Generate Action Plan',
      description: 'Create next week\'s detailed action plan',
      config: {
        outputFile: 'WEEKLY_ACTION_PLAN.md',
        promptTemplate: actionPlanPrompt,
        systemPrompt: 'You are a productivity expert helping professionals structure their time effectively. Be realistic about capacity and energy.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['WEEKLY_REVIEW.md', 'WEEKLY_ACTION_PLAN.md'],
};

export default WeeklyReviewWorkflow;
