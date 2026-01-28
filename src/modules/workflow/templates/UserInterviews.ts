// User Interview Guide Workflow Template
// Helps founders prepare for customer discovery interviews

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'productConcept',
    question: 'What is your product/service concept?',
    description: 'Brief description of what you are building or planning to build',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., An app that helps freelancers track time and invoice clients automatically',
  },
  {
    id: 'targetCustomer',
    question: 'Who are you interviewing?',
    description: 'The type of person you want to talk to',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Freelance designers and developers who invoice at least 3 clients per month',
  },
  {
    id: 'assumptions',
    question: 'What assumptions do you need to validate?',
    description: 'Hypotheses about your customers that you want to test',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Freelancers spend 3+ hours/week on invoicing, they forget to track time, they lose money on scope creep',
  },
  {
    id: 'interviewGoal',
    question: 'What is the main goal of these interviews?',
    description: 'What you are trying to learn',
    type: 'select',
    required: true,
    options: ['Problem validation (do they have this problem?)', 'Solution validation (would they use this solution?)', 'Pricing validation (would they pay for this?)', 'Feature prioritization (what matters most?)', 'General discovery (understand their world)'],
    defaultValue: 'Problem validation (do they have this problem?)',
  },
  {
    id: 'existingBehavior',
    question: 'How do they currently solve this problem?',
    description: 'Current alternatives they might be using',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Spreadsheets, Toggl + Quickbooks, manual invoices in Word, mental estimates',
  },
  {
    id: 'successLooksLike',
    question: 'What would make these interviews successful?',
    description: 'What signals would validate or invalidate your idea',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., At least 7/10 interviewees describe significant pain around tracking and invoicing',
  },
];

const interviewGuidePrompt = `You are helping a solo founder prepare for customer discovery interviews.

Based on the following information:

**Product Concept:** {{productConcept}}
**Target Customer:** {{targetCustomer}}
**Assumptions to Validate:** {{assumptions}}
**Interview Goal:** {{interviewGoal}}
**Current Solutions:** {{existingBehavior}}
**Success Criteria:** {{successLooksLike}}

Generate a comprehensive User Interview Guide in Markdown format:

# Customer Discovery Interview Guide

## Interview Overview

### Goal
{{interviewGoal}}

### Target Interviewees
{{targetCustomer}}

### Key Assumptions to Test
1. [Assumption 1]
2. [Assumption 2]
3. [Assumption 3]

### Success Criteria
{{successLooksLike}}

## Before the Interview

### Recruiting Script
**Cold outreach (LinkedIn/Email):**
"Hi [Name], I'm [Your name], a [your role] working on [brief context]. I'm researching how [target customers] handle [problem area] and would love to learn about your experience. Would you have 20-30 minutes for a chat? No sales pitch - just looking to learn. I'd be happy to [offer - coffee card, share research findings, etc.] as a thank you."

**Warm intro ask:**
"Do you know any [target customers] who [specific behavior]? I'm doing research and would love an intro."

### Interview Setup
- Duration: 30-45 minutes
- Location: Video call or in-person
- Recording: Ask permission to record
- Tools needed: Notes template, recording app

## Interview Script

### Opening (2-3 minutes)
"Thank you so much for taking the time to chat with me. I'm working on [brief context] and I'm trying to understand how [target customers] like yourself handle [problem area]. I'm not trying to sell you anything - I just want to learn about your experience.

Is it okay if I record this so I can focus on our conversation instead of taking notes? The recording is just for me and won't be shared.

Before we dive in, can you tell me a bit about yourself and your [work/role]?"

### Context Questions (5 minutes)
1. "Tell me about your role. What does a typical week look like?"
2. "How long have you been doing [relevant activity]?"
3. "What tools or systems do you currently use for [relevant area]?"

### Problem Exploration (15-20 minutes)

#### Opening the Topic
4. "I'd love to understand more about how you handle [problem area]. Can you walk me through the last time you [relevant task]?"

[Listen actively. Follow up with "Tell me more about that" and "What happened next?"]

#### Going Deeper
5. "What's the hardest part about [relevant task]?"
6. "Can you tell me about a time when [problem] was particularly frustrating?"
7. "How often does this come up? Daily? Weekly?"
8. "What happens when [problem] occurs? What's the impact?"

#### Current Behavior
9. "How do you currently handle [problem]?"
10. "What made you choose that approach?"
11. "What do you like about your current solution?"
12. "What's missing or frustrating about it?"
13. "Have you tried other solutions? What happened?"

#### Measuring Pain
14. "On a scale of 1-10, how painful is [problem] for you?"
15. "If a magic wand could solve this, what would that look like?"
16. "Have you ever looked for a better solution? What happened?"

### Validating Specific Assumptions
[Add 3-5 questions specific to your assumptions]

17. [Question testing assumption 1]
18. [Question testing assumption 2]
19. [Question testing assumption 3]

### Solution Hints (5 minutes)
**Only if appropriate:**
20. "If there was a tool that could [key value prop], how interested would you be?"
21. "What would need to be true for you to try a new solution?"
22. "What would make you skeptical about a solution like that?"

**DO NOT:**
- Describe your product in detail
- Pitch features
- Ask leading questions

### Closing (3-5 minutes)
23. "Is there anything else about [problem area] that I should have asked about?"
24. "Who else should I talk to who deals with [problem]?"
25. "Would you be open to a follow-up conversation once we have something to show?"
26. "What's the best way to stay in touch?"

"Thank you so much for your time. This has been incredibly helpful."

## After the Interview

### Notes Template
Complete within 24 hours of each interview:

**Interviewee:** [Name, role, company]
**Date:** [Date]
**Interview #:** [X of Y]

**Background:**
- [Key context about this person]

**Key Quotes:**
- "[Exact quote 1]"
- "[Exact quote 2]"
- "[Exact quote 3]"

**Problem Severity (1-10):** [Score]

**Current Solution:**
- [What they use now]
- [What they like]
- [What's missing]

**Assumption Validation:**
| Assumption | Validated? | Evidence |
|------------|------------|----------|
| [Assumption 1] | Yes/No/Partial | [Quote/observation] |
| [Assumption 2] | Yes/No/Partial | [Quote/observation] |

**Surprising Insights:**
- [Something unexpected]

**Follow-up:**
- [ ] Asked for intro to others
- [ ] Permission for follow-up
- [ ] Shared research findings

## Analysis Framework

### After 5 Interviews
Look for patterns:
1. How many described the problem as significant (7+/10)?
2. What words do they use to describe the problem?
3. What current solutions are most common?
4. What features matter most?

### Signal vs Noise
**Strong Signals:**
- Specific stories about the problem
- Emotional language ("frustrated", "hate", "nightmare")
- They've actively searched for solutions
- They'd pay for a solution

**Weak Signals:**
- "That would be nice"
- "I guess that's a problem sometimes"
- No concrete examples
- Polite but not engaged

### Pivot Indicators
Consider pivoting if:
- 5+ interviews and no one rates problem above 5/10
- Current solutions work "well enough" for everyone
- No one can articulate the specific pain
- Problem exists but won't pay to solve it`;

const recruitingTemplatesPrompt = `You are helping a solo founder create outreach templates for customer interviews.

Based on:
**Product Concept:** {{productConcept}}
**Target Customer:** {{targetCustomer}}

Generate Interview Recruiting Templates in Markdown format:

# Interview Recruiting Templates

## Where to Find Interviewees

### Online Communities
1. [Relevant subreddit]
2. [Relevant LinkedIn groups]
3. [Relevant Slack communities]
4. [Relevant Discord servers]
5. [Industry forums]

### Personal Network
- Ask for intros on LinkedIn
- Post on personal social media
- Email past colleagues
- Ask customers/users for referrals

### Paid Options
- User Interviews ($X per interview)
- Respondent.io
- UserTesting.com

## Cold Outreach Templates

### LinkedIn Connection Request
"Hi [Name], I'm researching how [target customers] handle [problem area]. Would love to connect and learn about your experience."

### LinkedIn Follow-Up Message
"Thanks for connecting! I'm [Your name], working on [brief context]. I'm doing research on how [target customers] handle [problem area] and would love to learn about your experience.

Would you have 20-30 minutes for a quick chat? No sales pitch - just trying to understand the problem better. Happy to share what I learn and [offer incentive] as a thank you."

### Cold Email
**Subject:** Quick question about [problem area]

Hi [Name],

I found you through [source] and noticed you [relevant context].

I'm doing research on how [target customers] handle [problem area]. I'm not selling anything - just trying to understand the problem better before building a solution.

Would you have 20-30 minutes for a quick call? I'd love to hear about your experience.

As a thank you, I'm happy to [incentive - share research, send gift card, etc.].

Best,
[Your name]

### Twitter/X DM
"Hey! I'm researching how [target customers] handle [problem area]. Would love to hear about your experience - 20 min call, no pitch, just learning. Interested?"

## Warm Intro Request

### To Your Network
"Hey [Friend], I'm working on [brief context] and looking to talk to [target customers] who [specific behavior]. Do you know anyone who fits that description? I'd love an intro."

### LinkedIn Post
"I'm researching how [target customers] handle [problem area] and looking to learn from real experiences.

If you're a [target customer] and have 20-30 minutes to chat, I'd love to hear your story.

No pitch, just research. Happy to share what I learn and [offer] as a thank you.

DM me or comment below if interested!"

## Community Post

### Reddit/Forum Post
"Hey r/[subreddit],

I'm doing research on how [target customers] handle [problem area] and would love to learn from this community.

If you have 20 minutes for a quick call, I'd really appreciate hearing about your experience. No selling - just trying to understand the problem before building anything.

I'm happy to share my research findings afterward and [offer].

Comment below or DM me if you're interested!"

## Screening Questions

Before scheduling, ask:
1. Are you a [target customer description]?
2. Do you currently [relevant behavior]?
3. How often do you deal with [problem area]?

**Good fit:** [Criteria]
**Not a fit:** [Criteria]

## Calendar Scheduling

### Booking Link Message
"Great, thanks for agreeing to chat! Here's my calendar link: [Link]

Pick any time that works for you. Looking forward to learning about your experience!"

### Confirmation Email
"Hi [Name],

Thanks for scheduling time to chat on [date/time].

Just to confirm - this is a casual conversation about your experience with [problem area]. I'm doing research, not selling anything. Our call will be about 30 minutes.

I'll send a video link [X hours] before our call.

Looking forward to it!
[Your name]"

### Reminder (Day Before)
"Hi [Name], just a friendly reminder about our chat tomorrow at [time]. Looking forward to hearing about your experience with [problem area]!

Here's the video link: [Link]"

## Thank You Follow-Ups

### Post-Interview Thank You
"Hi [Name],

Thank you so much for chatting with me yesterday. Your insights about [specific thing they mentioned] were really valuable.

As promised, [deliver incentive].

If you think of anyone else I should talk to, I'd love an intro. And I'll definitely reach out when we have something to show!

Thanks again,
[Your name]"

### Research Summary (After All Interviews)
"Hi [Name],

I wanted to follow up and share what I learned from my research. Based on [X] interviews, here are the key findings:

1. [Finding 1]
2. [Finding 2]
3. [Finding 3]

Based on this, I'm planning to [what you're doing next].

Thanks again for being part of this research. I'll keep you posted on progress!

[Your name]"

## Tracking Spreadsheet Template

| Name | Source | Reached Out | Response | Scheduled | Completed | Notes |
|------|--------|-------------|----------|-----------|-----------|-------|
| | | | | | | |`;

export const UserInterviews: WorkflowTemplate = {
  id: 'user-interviews',
  name: 'Customer Interview Guide',
  description: 'Create interview scripts and recruiting templates for customer discovery conversations.',
  version: '1.0.0',
  category: 'research',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Interview Planning',
      description: 'Define what you want to learn from customers',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-guide',
      type: 'generate',
      name: 'Generate Interview Guide',
      description: 'Create a comprehensive interview script',
      config: {
        outputFile: 'INTERVIEW_GUIDE.md',
        promptTemplate: interviewGuidePrompt,
        systemPrompt: 'You are a customer research expert trained in The Mom Test methodology. Create non-leading questions that reveal real behavior.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-recruiting',
      type: 'generate',
      name: 'Generate Recruiting Templates',
      description: 'Create outreach templates to find interviewees',
      config: {
        outputFile: 'RECRUITING_TEMPLATES.md',
        promptTemplate: recruitingTemplatesPrompt,
        systemPrompt: 'You are an outreach expert helping founders find people to interview. Create templates that are friendly and get responses.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['INTERVIEW_GUIDE.md', 'RECRUITING_TEMPLATES.md'],
};

export default UserInterviews;
