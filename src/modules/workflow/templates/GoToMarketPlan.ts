// Go-To-Market Plan Workflow Template
// Helps founders plan their product launch

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'productName',
    question: 'What is your product name?',
    description: 'The name of your product or service',
    type: 'text',
    required: true,
    placeholder: 'e.g., TaskFlow Pro',
  },
  {
    id: 'productDescription',
    question: 'Describe your product in 2-3 sentences',
    description: 'What it does and who it helps',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., TaskFlow Pro is an AI-powered project management tool that helps remote teams collaborate more effectively.',
  },
  {
    id: 'targetAudience',
    question: 'Who is your primary target audience?',
    description: 'Be specific about the segment you are targeting first',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Engineering managers at remote-first startups with 20-100 employees',
  },
  {
    id: 'launchStage',
    question: 'What stage is your launch?',
    description: 'Where you are in the launch process',
    type: 'select',
    required: true,
    options: ['Pre-launch (building hype)', 'Beta launch (limited users)', 'Public launch (general availability)', 'Re-launch (major update)'],
    defaultValue: 'Public launch (general availability)',
  },
  {
    id: 'launchDate',
    question: 'When do you plan to launch?',
    description: 'Target launch date or timeframe',
    type: 'text',
    required: true,
    placeholder: 'e.g., March 15, 2026 or Q2 2026',
  },
  {
    id: 'budget',
    question: 'What is your marketing budget?',
    description: 'Available budget for launch activities',
    type: 'select',
    required: true,
    options: ['$0 (bootstrapped)', '$1-500', '$500-2,000', '$2,000-10,000', '$10,000+'],
    defaultValue: '$0 (bootstrapped)',
  },
  {
    id: 'channels',
    question: 'What channels do you plan to use?',
    description: 'Marketing and distribution channels',
    type: 'multiselect',
    required: true,
    options: ['Product Hunt', 'Hacker News', 'Twitter/X', 'LinkedIn', 'Reddit', 'Email list', 'Content/SEO', 'Paid ads', 'Partnerships', 'PR/Press'],
  },
  {
    id: 'uniqueAngle',
    question: 'What is your unique launch angle or hook?',
    description: 'The story or angle that makes your launch newsworthy',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Built by a solo founder who managed 50-person teams at Google, frustrated with existing tools',
  },
  {
    id: 'successMetrics',
    question: 'How will you measure launch success?',
    description: 'Key metrics for your launch',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 500 signups in first week, top 5 on Product Hunt, 50 paying customers in 30 days',
  },
];

const gtmPlanPrompt = `You are helping a solo founder create a Go-To-Market plan.

Based on the following information:

**Product Name:** {{productName}}
**Product Description:** {{productDescription}}
**Target Audience:** {{targetAudience}}
**Launch Stage:** {{launchStage}}
**Launch Date:** {{launchDate}}
**Budget:** {{budget}}
**Channels:** {{channels}}
**Unique Angle:** {{uniqueAngle}}
**Success Metrics:** {{successMetrics}}

Generate a comprehensive Go-To-Market Plan in Markdown format:

# Go-To-Market Plan: {{productName}}

## Executive Summary
[2-3 paragraph overview of the launch strategy]

## Launch Goals

### Primary Objectives
1. [Goal 1 with specific metric]
2. [Goal 2 with specific metric]
3. [Goal 3 with specific metric]

### Success Metrics Dashboard
| Metric | Target | Stretch Goal |
|--------|--------|--------------|
| [Metric 1] | | |
| [Metric 2] | | |
| [Metric 3] | | |

## Target Audience

### Primary Segment
- Who: [Detailed description]
- Where they are: [Channels/communities]
- What they care about: [Key concerns]

### Secondary Segment
- Who: [Detailed description]
- Where they are: [Channels/communities]
- What they care about: [Key concerns]

## Positioning & Messaging

### Positioning Statement
For [target audience] who [need], {{productName}} is a [category] that [key benefit]. Unlike [alternatives], we [differentiator].

### Key Messages
1. Primary message: [Message]
2. Supporting message 1: [Message]
3. Supporting message 2: [Message]

### Elevator Pitch (30 seconds)
[Write the pitch]

## Channel Strategy

### Channel Mix
| Channel | Priority | Budget | Expected Results |
|---------|----------|--------|-----------------|
| [Channel 1] | High/Med/Low | $X | [Results] |
| [Channel 2] | High/Med/Low | $X | [Results] |

### Channel-Specific Tactics
[For each selected channel, provide specific tactics]

## Launch Timeline

### Pre-Launch (4 weeks before)
- Week -4: [Activities]
- Week -3: [Activities]
- Week -2: [Activities]
- Week -1: [Activities]

### Launch Week
- Day 1: [Detailed hour-by-hour for launch day]
- Day 2-3: [Activities]
- Day 4-7: [Activities]

### Post-Launch (4 weeks after)
- Week +1: [Activities]
- Week +2: [Activities]
- Week +3-4: [Activities]

## Content & Assets Needed

### Before Launch
- [ ] Landing page
- [ ] Demo video
- [ ] Social media graphics
- [ ] Email sequences
- [ ] Press kit
- [ ] [Other assets]

### Launch Day
- [ ] Launch post/announcement
- [ ] Social media content calendar
- [ ] Community engagement plan

## Budget Allocation
| Category | Amount | % of Budget |
|----------|--------|-------------|
| [Category] | $X | X% |
| [Category] | $X | X% |
| Total | $X | 100% |

## Risk Mitigation

### Potential Risks
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| [Risk 1] | H/M/L | H/M/L | [Plan] |
| [Risk 2] | H/M/L | H/M/L | [Plan] |

## Team & Responsibilities
[Who does what, even if it is just the founder]

## Post-Launch Optimization
- How to gather feedback
- Iteration plan
- When to pivot strategy`;

const launchChecklistPrompt = `You are helping a solo founder create a launch checklist.

Based on:
**Product Name:** {{productName}}
**Launch Date:** {{launchDate}}
**Channels:** {{channels}}
**Budget:** {{budget}}

Generate a detailed Launch Checklist in Markdown format:

# {{productName}} Launch Checklist

## 4 Weeks Before Launch

### Product Readiness
- [ ] Core features complete and tested
- [ ] Onboarding flow finalized
- [ ] Payment/billing system working
- [ ] Error tracking set up
- [ ] Analytics implemented
- [ ] Performance optimized

### Marketing Assets
- [ ] Landing page live and tested
- [ ] Product screenshots/images (5-10)
- [ ] Demo video (60-90 seconds)
- [ ] Product Hunt assets prepared
- [ ] Social media graphics created
- [ ] Email templates written

### Content
- [ ] Launch blog post drafted
- [ ] Social media posts scheduled
- [ ] Email announcement ready
- [ ] Press release drafted (if applicable)

## 2 Weeks Before Launch

### Community Building
- [ ] Email waitlist warmed up
- [ ] Social media teaser posts published
- [ ] Influencer/partner outreach started
- [ ] Community members notified

### Technical
- [ ] Load testing completed
- [ ] Backup systems verified
- [ ] Support channels ready
- [ ] Monitoring alerts configured

### Logistics
- [ ] Launch day schedule finalized
- [ ] Team roles assigned
- [ ] Communication channels set up
- [ ] Response templates prepared

## 1 Week Before Launch

### Final Prep
- [ ] Landing page final review
- [ ] All copy proofread
- [ ] Links verified
- [ ] Mobile experience tested
- [ ] Payment flow end-to-end tested

### Promotion
- [ ] Product Hunt scheduled
- [ ] Social media queue loaded
- [ ] Email sequence activated
- [ ] Partners ready to amplify

## Launch Day

### Morning (Your Timezone)
- [ ] Product Hunt goes live (12:01 AM PT)
- [ ] Social media announcement posted
- [ ] Email blast sent
- [ ] Monitor for immediate issues

### Throughout Day
- [ ] Respond to Product Hunt comments
- [ ] Engage on social media
- [ ] Answer support questions
- [ ] Track metrics in real-time
- [ ] Share updates/milestones

### Evening
- [ ] Thank early supporters
- [ ] Share day 1 results
- [ ] Document learnings
- [ ] Plan day 2 activities

## Week After Launch

### Days 2-3
- [ ] Follow up with engaged users
- [ ] Gather feedback
- [ ] Fix critical bugs
- [ ] Continue social engagement

### Days 4-7
- [ ] Analyze launch metrics
- [ ] Write launch retrospective
- [ ] Plan ongoing marketing
- [ ] Reach out to press/bloggers

## Post-Launch Review
- [ ] Document what worked
- [ ] Document what didn't
- [ ] Update strategy based on learnings
- [ ] Set 30/60/90 day goals`;

export const GoToMarketPlan: WorkflowTemplate = {
  id: 'go-to-market-plan',
  name: 'Go-To-Market Plan',
  description: 'Create a comprehensive launch plan with timeline, channel strategy, and detailed checklist.',
  version: '1.0.0',
  category: 'planning',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Launch Planning Interview',
      description: 'Gather information about your launch plans',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-plan',
      type: 'generate',
      name: 'Generate GTM Plan',
      description: 'Create a comprehensive go-to-market plan',
      config: {
        outputFile: 'GTM_PLAN.md',
        promptTemplate: gtmPlanPrompt,
        systemPrompt: 'You are a growth marketing expert helping founders plan successful product launches. Be specific and tactical.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-checklist',
      type: 'generate',
      name: 'Generate Launch Checklist',
      description: 'Create a detailed launch checklist',
      config: {
        outputFile: 'LAUNCH_CHECKLIST.md',
        promptTemplate: launchChecklistPrompt,
        systemPrompt: 'You are a launch specialist creating actionable checklists. Be comprehensive and practical.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['GTM_PLAN.md', 'LAUNCH_CHECKLIST.md'],
};

export default GoToMarketPlan;
