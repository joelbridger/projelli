// Customer Persona Workflow Template
// Helps founders define their ideal customer profiles

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'productDescription',
    question: 'What does your product/service do?',
    description: 'Brief description of what you offer',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., An AI-powered writing assistant for content marketers',
  },
  {
    id: 'currentCustomers',
    question: 'Describe your best customers (or ideal customers if pre-launch)',
    description: 'Who gets the most value from your product?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Content marketing managers at B2B SaaS companies who publish 10+ blog posts per month',
  },
  {
    id: 'customerPains',
    question: 'What problems do your customers face?',
    description: 'The daily frustrations and challenges they experience',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Spending too much time writing, inconsistent brand voice, writer\'s block',
  },
  {
    id: 'customerGoals',
    question: 'What are your customers trying to achieve?',
    description: 'Their professional and personal goals',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Publish more content, improve SEO rankings, get promoted to Director',
  },
  {
    id: 'buyingProcess',
    question: 'How do customers typically find and buy solutions?',
    description: 'Their research and decision-making process',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Google search, peer recommendations, G2 reviews, free trials',
  },
  {
    id: 'objections',
    question: 'What objections or concerns do customers have?',
    description: 'Reasons they hesitate to buy',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Price concerns, worried AI content won\'t sound authentic, need team buy-in',
  },
  {
    id: 'demographics',
    question: 'What are the typical demographics?',
    description: 'Job titles, company size, industry, location',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Marketing Manager/Director, companies with 50-500 employees, B2B tech',
  },
];

const personaDocPrompt = `You are helping a solo founder create detailed customer personas.

Based on the following information:

**Product:** {{productDescription}}
**Best Customers:** {{currentCustomers}}
**Customer Pains:** {{customerPains}}
**Customer Goals:** {{customerGoals}}
**Buying Process:** {{buyingProcess}}
**Objections:** {{objections}}
**Demographics:** {{demographics}}

Generate 2-3 detailed Customer Persona documents in Markdown format.

For EACH persona, include:

## Persona: [Name] - [Title]

### Demographics
- **Name:** [Fictional but realistic name]
- **Age:** [Range]
- **Job Title:** [Specific title]
- **Company Size:** [Employee count]
- **Industry:** [Sector]
- **Location:** [Region/type]
- **Income:** [Range]
- **Education:** [Level]

### Background Story
[2-3 paragraph narrative about their career journey and current situation]

### Goals & Motivations
- Primary Goal: [Most important objective]
- Secondary Goals: [Other objectives]
- Personal Motivations: [What drives them personally]

### Pain Points & Frustrations
1. [Pain #1 with specific example]
2. [Pain #2 with specific example]
3. [Pain #3 with specific example]

### Day in the Life
[Describe a typical workday and where your product fits]

### Buying Behavior
- **Research:** How they learn about solutions
- **Decision Making:** Who else is involved
- **Budget:** Their purchasing power
- **Timeline:** How long they take to decide

### Objections & Concerns
| Objection | How to Address |
|-----------|---------------|
| [Concern 1] | [Response] |
| [Concern 2] | [Response] |

### Messaging That Resonates
- Key phrases that appeal to this persona
- Value propositions that matter most
- Tone and style preferences

### Channels to Reach Them
- Where they spend time online
- What content they consume
- Who influences them

---

Differentiate each persona clearly. They should represent distinct segments of your target market.`;

const icpSummaryPrompt = `You are helping a solo founder create an Ideal Customer Profile (ICP) summary.

Based on the customer research:

**Product:** {{productDescription}}
**Best Customers:** {{currentCustomers}}
**Demographics:** {{demographics}}
**Customer Pains:** {{customerPains}}
**Customer Goals:** {{customerGoals}}

Generate an ICP Summary document in Markdown format:

# Ideal Customer Profile (ICP)

## Executive Summary
[2 paragraph overview of who your ideal customer is]

## ICP Definition

### Company Characteristics
| Attribute | Ideal | Acceptable | Disqualifying |
|-----------|-------|------------|---------------|
| Industry | | | |
| Company Size | | | |
| Revenue | | | |
| Growth Stage | | | |
| Tech Stack | | | |

### Buyer Characteristics
| Attribute | Ideal | Acceptable | Disqualifying |
|-----------|-------|------------|---------------|
| Job Title | | | |
| Department | | | |
| Seniority | | | |
| Budget Authority | | | |

## Qualification Criteria

### Must-Have (Required)
- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

### Nice-to-Have (Preferred)
- [ ] [Criterion 1]
- [ ] [Criterion 2]

### Red Flags (Avoid)
- [ ] [Warning sign 1]
- [ ] [Warning sign 2]

## Customer Scoring Model

| Factor | Weight | Score 1-5 |
|--------|--------|-----------|
| Company Fit | 30% | |
| Pain Intensity | 25% | |
| Budget Available | 20% | |
| Decision Timeline | 15% | |
| Champion Presence | 10% | |

**Score Interpretation:**
- 4.0-5.0: Pursue aggressively
- 3.0-3.9: Qualified lead
- 2.0-2.9: Nurture for later
- Below 2.0: Disqualify

## Anti-Personas
[Describe who is NOT a good fit and why]

## Application
- How to use this ICP in marketing
- How to use this ICP in sales
- How to use this ICP in product development`;

export const CustomerPersona: WorkflowTemplate = {
  id: 'customer-persona',
  name: 'Customer Persona Builder',
  description: 'Create detailed customer personas and an Ideal Customer Profile (ICP) for targeting and messaging.',
  version: '1.0.0',
  category: 'research',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Customer Research Interview',
      description: 'Gather information about your target customers',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-personas',
      type: 'generate',
      name: 'Generate Customer Personas',
      description: 'Create detailed persona profiles',
      config: {
        outputFile: 'CUSTOMER_PERSONAS.md',
        promptTemplate: personaDocPrompt,
        systemPrompt: 'You are a customer research expert helping founders deeply understand their target customers. Be specific and use realistic details.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-icp',
      type: 'generate',
      name: 'Generate ICP Summary',
      description: 'Create an Ideal Customer Profile framework',
      config: {
        outputFile: 'ICP_SUMMARY.md',
        promptTemplate: icpSummaryPrompt,
        systemPrompt: 'You are a sales and marketing strategist helping founders focus on the right customers. Be practical and actionable.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['CUSTOMER_PERSONAS.md', 'ICP_SUMMARY.md'],
};

export default CustomerPersona;
