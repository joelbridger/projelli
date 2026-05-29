// First Hire Playbook Workflow Template
// Generates a job description, interview rubric, scoring scorecard, and
// onboarding plan for a professional making their first hire.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'role',
    question: 'What role are you hiring for?',
    description: 'Be specific. Not "engineer" — "Senior Backend Engineer" or "Founding Customer Success Lead".',
    type: 'text',
    required: true,
    placeholder: 'e.g., Founding Engineer (Full Stack)',
  },
  {
    id: 'roleType',
    question: 'Role type',
    description: 'How are you bringing this person on?',
    type: 'select',
    required: true,
    options: ['Full-time employee', 'Part-time employee', 'Full-time contractor', 'Part-time contractor', 'Fractional executive', 'Apprentice/intern'],
    defaultValue: 'Full-time employee',
  },
  {
    id: 'companyContext',
    question: 'Tell me about your company',
    description: 'A few sentences. What does it do, what stage, what\'s the team size today?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Solo law practice, 3 years in practice, growing faster than I can handle alone. Looking to hire a first associate or paralegal to take on overflow work and help with client intake.',
  },
  {
    id: 'whyThisRole',
    question: 'Why this role, why now?',
    description: 'What problem will this hire solve? What changes after they start?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., I\'m the bottleneck on both billable client work and practice management. Bringing on support lets me focus on the work only I can do and stop losing billable hours to admin.',
  },
  {
    id: 'topResponsibilities',
    question: 'Top 3-5 responsibilities',
    description: 'What will this person do day-to-day in their first 6 months?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 1) Handle client intake and initial consultations, 2) Draft standard documents for review, 3) Manage matter files and deadlines, 4) Take on independent client matters with light supervision',
  },
  {
    id: 'mustHaveSkills',
    question: 'Must-have skills/experience',
    description: 'What are the non-negotiables?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 2+ years of relevant experience, licensed in our jurisdiction (if applicable), strong written communication, comfortable working independently with light supervision',
  },
  {
    id: 'niceToHave',
    question: 'Nice-to-have skills/experience',
    description: 'Things that would be great but aren\'t deal-breakers.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Experience in our specific practice area, existing client relationships, bilingual, familiarity with our case management software',
  },
  {
    id: 'compensation',
    question: 'Compensation range',
    description: 'Salary range, equity range, benefits. Be specific even if it changes.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., $120-150K base salary, 1-2% equity over 4 years with 1-year cliff, full health benefits, unlimited PTO',
  },
  {
    id: 'workLocation',
    question: 'Work location',
    description: 'Remote, hybrid, in-person?',
    type: 'select',
    required: true,
    options: ['Fully remote (anywhere)', 'Fully remote (specific timezones)', 'Hybrid (city specified)', 'In-person (city specified)'],
    defaultValue: 'Fully remote (anywhere)',
  },
];

const jdPrompt = `You are helping a professional write a job description for their first hire.

**Role:** {{role}} ({{roleType}})
**Company context:** {{companyContext}}
**Why this role, why now:** {{whyThisRole}}
**Top responsibilities:** {{topResponsibilities}}
**Must-have skills:** {{mustHaveSkills}}
**Nice-to-have skills:** {{niceToHave}}
**Compensation:** {{compensation}}
**Location:** {{workLocation}}

Write a job description that:

1. **Doesn't sound like a corporate job posting.** This is a professional's first hire. The tone should be honest, specific, and a little bit personal — like a professional pitching the role over coffee, not an HR document.
2. **Starts with the company story** — why this exists, what it does, who it's for. 2-3 short paragraphs max.
3. **Explains why this role exists** — what's broken without it, what the professional is trying to accomplish by hiring.
4. **Lists responsibilities** clearly but doesn't overdo the bullet points. The reader should be able to picture what their week will look like.
5. **Lists must-haves and nice-to-haves separately** — and is honest that the nice-to-haves are nice-to-haves.
6. **Is upfront about compensation.** Don't hide the salary range. Hiding it attracts mismatched candidates and wastes everyone's time.
7. **Describes what this person will get from the role** — equity, learning, autonomy, the chance to shape something early. The pitch.
8. **Includes "How to apply"** — a simple, low-friction process. Not a 5-step ATS form.
9. **Avoids cliches** — no "rockstar", no "ninja", no "fast-paced environment", no "we're not just a company, we're a family". Specific over generic, always.

Output format: Markdown, suitable for posting on a job board, the company website, or sharing as a Notion page.`;

const rubricPrompt = `You are helping a professional build a structured interview rubric for the {{role}} hire.

Top responsibilities: {{topResponsibilities}}
Must-have skills: {{mustHaveSkills}}

Generate an interview rubric that includes:

1. **# Interview Rubric: {{role}}**
2. **Interview process overview** — what the stages are (e.g., screening call, take-home or live exercise, in-depth interview with the principal, reference check). For each stage, what's being evaluated and how long it takes.
3. **For each interview stage, a structured question list** — 5-8 questions per stage, each tagged with what it's testing for (skill, judgment, culture, motivation, communication)
4. **A scoring scale** for each dimension (1 = clear no, 5 = strong yes). Be specific about what each score level means — don't just say "1-5", say what behaviors map to each score.
5. **Red flags to watch for** — at least 5 things that should trigger a "no" or a deep dive in the next stage
6. **Green flags that mean a strong yes** — at least 5 things that mean this person is exceptional

Format as Markdown. Be concrete and specific to the role, not generic.`;

const onboardingPrompt = `You are helping a professional design an onboarding plan for their first hire ({{role}}).

Top responsibilities: {{topResponsibilities}}
Company context: {{companyContext}}

Generate a 30/60/90 day onboarding plan in Markdown with:

1. **# Onboarding Plan: {{role}}**
2. **Pre-start (week before they begin)** — what the professional needs to do: hardware setup, accounts created, intro emails, first-day prep
3. **Day 1** — concrete schedule for the first day. What they read, who they meet (likely just the professional if it's first hire), what they ship by end of day (a small win matters).
4. **Week 1** — what they ship, what they learn, what 1:1s look like
5. **Days 1-30** — goals, deliverables, learning targets. End-of-month review checklist.
6. **Days 31-60** — what changes once they're past onboarding. Shift toward independent ownership.
7. **Days 61-90** — full ownership. End-of-90-day review: are they working out? What needs to change?
8. **The 30/60/90 review questions** — specific things to evaluate at each milestone.

Make it specific to a small company (1-3 people including the new hire). Don't write a 200-employee corporate onboarding plan.`;

export const FirstHirePlaybook: WorkflowTemplate = {
  id: 'first-hire-playbook',
  name: 'First Hire Playbook',
  description: 'Generate the full hiring kit for your first hire: job description, structured interview rubric, and 30/60/90 onboarding plan.',
  version: '1.0.0',
  category: 'planning',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Hiring Interview',
      description: 'Answer questions about the role, the company, and what success looks like',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-jd',
      type: 'generate',
      name: 'Generate Job Description',
      description: 'Draft the JD',
      config: {
        outputFile: 'hiring/{{role}}/job-description.md',
        promptTemplate: jdPrompt,
        systemPrompt: 'You are an experienced practice-building advisor. You have helped many solo practitioners and small firms make their first hire. You know what works (specific, honest, direct job descriptions) and what doesn\'t (cliches, hidden salary, corporate language).',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-rubric',
      type: 'generate',
      name: 'Generate Interview Rubric',
      description: 'Draft the structured interview rubric and scoring system',
      config: {
        outputFile: 'hiring/{{role}}/interview-rubric.md',
        promptTemplate: rubricPrompt,
        systemPrompt: 'You are a hiring manager who has interviewed hundreds of candidates and helped solo practitioners and small firms build structured interview processes. You believe in rubrics over gut feel.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-onboarding',
      type: 'generate',
      name: 'Generate 30/60/90 Onboarding Plan',
      description: 'Draft the onboarding plan for the new hire',
      config: {
        outputFile: 'hiring/{{role}}/onboarding-plan.md',
        promptTemplate: onboardingPrompt,
        systemPrompt: 'You are an onboarding designer who has helped many small companies onboard their first few employees. You know what makes the difference between a hire who lasts 6 months and one who becomes a long-term team member.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: [
    'hiring/{{role}}/job-description.md',
    'hiring/{{role}}/interview-rubric.md',
    'hiring/{{role}}/onboarding-plan.md',
  ],
};

export default FirstHirePlaybook;
