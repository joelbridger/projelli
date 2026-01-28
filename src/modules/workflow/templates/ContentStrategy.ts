// Content Strategy Workflow Template
// Helps founders plan their content marketing

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'businessDescription',
    question: 'What does your business do?',
    description: 'Brief description of your product/service',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., We help small businesses automate their accounting with AI',
  },
  {
    id: 'targetAudience',
    question: 'Who is your target audience?',
    description: 'The people you want to reach with content',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Small business owners and freelancers who hate doing bookkeeping',
  },
  {
    id: 'audiencePains',
    question: 'What problems does your audience have?',
    description: 'Pain points they search for solutions to',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Messy books, tax anxiety, time wasted on manual data entry, missed deductions',
  },
  {
    id: 'contentGoals',
    question: 'What are your content goals?',
    description: 'What you want content to achieve',
    type: 'multiselect',
    required: true,
    options: ['SEO/Organic traffic', 'Thought leadership', 'Lead generation', 'Product education', 'Customer retention', 'Social media growth'],
  },
  {
    id: 'contentTypes',
    question: 'What content types can you realistically produce?',
    description: 'Types of content you have capacity for',
    type: 'multiselect',
    required: true,
    options: ['Blog posts', 'Social media posts', 'Videos', 'Podcasts', 'Email newsletters', 'Case studies', 'Webinars', 'Infographics'],
  },
  {
    id: 'capacity',
    question: 'How much time can you spend on content per week?',
    description: 'Your realistic time commitment',
    type: 'select',
    required: true,
    options: ['1-2 hours', '3-5 hours', '5-10 hours', '10+ hours'],
    defaultValue: '3-5 hours',
  },
  {
    id: 'existingContent',
    question: 'Do you have any existing content or audience?',
    description: 'Current content assets, email list size, social following',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., 500 email subscribers, 2K Twitter followers, 10 blog posts',
  },
  {
    id: 'competitors',
    question: 'Who creates content in your space that you admire?',
    description: 'Competitors or related companies with good content',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Bench.co blog, Wave accounting social media, FreshBooks podcast',
  },
];

const contentStrategyPrompt = `You are helping a solo founder create a content strategy.

Based on the following information:

**Business:** {{businessDescription}}
**Target Audience:** {{targetAudience}}
**Audience Pains:** {{audiencePains}}
**Content Goals:** {{contentGoals}}
**Content Types:** {{contentTypes}}
**Weekly Capacity:** {{capacity}}
**Existing Content:** {{existingContent}}
**Competitors to Learn From:** {{competitors}}

Generate a comprehensive Content Strategy document in Markdown format:

# Content Strategy

## Executive Summary
[2-3 paragraph overview of the content strategy]

## Content Mission Statement
[One sentence describing why you create content and for whom]

## Audience Analysis

### Primary Audience Persona
- **Who:** [Description]
- **Pain Points:** [Key pains]
- **Questions They Ask:** [Common questions]
- **Where They Hang Out:** [Platforms/communities]
- **Content Preferences:** [Formats they prefer]

### Content-Market Fit
| Audience Need | Content That Serves It |
|---------------|----------------------|
| [Need 1] | [Content type/topic] |
| [Need 2] | [Content type/topic] |
| [Need 3] | [Content type/topic] |

## Content Pillars

### Pillar 1: [Name]
- **Topic Area:** [Description]
- **Why It Matters:** [Connection to audience/business]
- **Example Topics:** [3-5 topic ideas]

### Pillar 2: [Name]
- **Topic Area:** [Description]
- **Why It Matters:** [Connection to audience/business]
- **Example Topics:** [3-5 topic ideas]

### Pillar 3: [Name]
- **Topic Area:** [Description]
- **Why It Matters:** [Connection to audience/business]
- **Example Topics:** [3-5 topic ideas]

## Channel Strategy

### Primary Channels
| Channel | Purpose | Frequency | Content Type |
|---------|---------|-----------|--------------|
| [Channel 1] | | | |
| [Channel 2] | | | |

### Channel-Specific Guidelines
[For each selected content type, provide specific tactics]

## Content Funnel

### Top of Funnel (Awareness)
- Content Types: [List]
- Goals: [Traffic, brand awareness]
- Example Topics: [3-5 ideas]

### Middle of Funnel (Consideration)
- Content Types: [List]
- Goals: [Email signups, engagement]
- Example Topics: [3-5 ideas]

### Bottom of Funnel (Decision)
- Content Types: [List]
- Goals: [Trials, demos, purchases]
- Example Topics: [3-5 ideas]

## SEO Strategy

### Target Keywords
| Keyword | Search Volume | Difficulty | Priority |
|---------|--------------|------------|----------|
| [Keyword 1] | Est. volume | Low/Med/High | 1-5 |
| [Keyword 2] | Est. volume | Low/Med/High | 1-5 |
| [Keyword 3] | Est. volume | Low/Med/High | 1-5 |

### Topic Clusters
[Describe pillar pages and supporting content structure]

## Content Calendar Framework

### Weekly Schedule (Based on {{capacity}})
| Day | Activity | Time |
|-----|----------|------|
| [Day 1] | [Activity] | [Hours] |
| [Day 2] | [Activity] | [Hours] |

### Monthly Rhythm
- Week 1: [Focus]
- Week 2: [Focus]
- Week 3: [Focus]
- Week 4: [Focus]

## Metrics & KPIs

### Primary Metrics
| Metric | Current | 3-Month Goal | 6-Month Goal |
|--------|---------|--------------|--------------|
| [Metric 1] | | | |
| [Metric 2] | | | |
| [Metric 3] | | | |

### Content Performance Framework
[How to evaluate if content is working]

## Repurposing Strategy
[How to maximize one piece of content across channels]

## Tools & Resources
[Recommended tools for execution]`;

const contentCalendarPrompt = `You are helping a solo founder create a 30-day content calendar.

Based on:
**Business:** {{businessDescription}}
**Target Audience:** {{targetAudience}}
**Audience Pains:** {{audiencePains}}
**Content Types:** {{contentTypes}}
**Weekly Capacity:** {{capacity}}

Generate a 30-Day Content Calendar in Markdown format:

# 30-Day Content Calendar

## Month Overview
[Brief summary of this month's content theme/focus]

## Week 1

### Day 1 - [Day of Week]
| Platform | Content Type | Topic | Status |
|----------|--------------|-------|--------|
| [Platform] | [Type] | [Topic idea with headline] | ⬜ |

### Day 2 - [Day of Week]
| Platform | Content Type | Topic | Status |
|----------|--------------|-------|--------|
| [Platform] | [Type] | [Topic idea with headline] | ⬜ |

[Continue for all 7 days]

## Week 2
[Repeat structure]

## Week 3
[Repeat structure]

## Week 4
[Repeat structure]

## Content Briefs

### Blog Post #1: [Title]
- **Target Keyword:** [Keyword]
- **Word Count:** [Range]
- **Outline:**
  - H2: [Section 1]
  - H2: [Section 2]
  - H2: [Section 3]
- **CTA:** [Call to action]

### Blog Post #2: [Title]
- **Target Keyword:** [Keyword]
- **Word Count:** [Range]
- **Outline:**
  - H2: [Section 1]
  - H2: [Section 2]
  - H2: [Section 3]
- **CTA:** [Call to action]

## Social Media Post Ideas

### LinkedIn Posts (10 ideas)
1. [Hook + topic]
2. [Hook + topic]
3. [Hook + topic]
4. [Hook + topic]
5. [Hook + topic]
6. [Hook + topic]
7. [Hook + topic]
8. [Hook + topic]
9. [Hook + topic]
10. [Hook + topic]

### Twitter/X Threads (5 ideas)
1. [Thread topic with opening hook]
2. [Thread topic with opening hook]
3. [Thread topic with opening hook]
4. [Thread topic with opening hook]
5. [Thread topic with opening hook]

## Newsletter Ideas (4 issues)
1. **Subject:** [Subject line] - [Brief summary]
2. **Subject:** [Subject line] - [Brief summary]
3. **Subject:** [Subject line] - [Brief summary]
4. **Subject:** [Subject line] - [Brief summary]

## Production Schedule
[Timeline for creating content in advance]`;

export const ContentStrategy: WorkflowTemplate = {
  id: 'content-strategy',
  name: 'Content Strategy',
  description: 'Create a comprehensive content strategy and 30-day content calendar.',
  version: '1.0.0',
  category: 'planning',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Content Strategy Interview',
      description: 'Gather information about your content goals and capacity',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-strategy',
      type: 'generate',
      name: 'Generate Content Strategy',
      description: 'Create a comprehensive content strategy',
      config: {
        outputFile: 'CONTENT_STRATEGY.md',
        promptTemplate: contentStrategyPrompt,
        systemPrompt: 'You are a content marketing strategist helping founders build sustainable content engines. Be practical given limited resources.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-calendar',
      type: 'generate',
      name: 'Generate Content Calendar',
      description: 'Create a 30-day content calendar with briefs',
      config: {
        outputFile: 'CONTENT_CALENDAR.md',
        promptTemplate: contentCalendarPrompt,
        systemPrompt: 'You are a content planner creating actionable calendars. Make topics specific and compelling, not generic.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['CONTENT_STRATEGY.md', 'CONTENT_CALENDAR.md'],
};

export default ContentStrategy;
