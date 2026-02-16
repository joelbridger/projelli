// Pricing Strategy Workflow Template
// Helps founders develop their pricing model

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'productDescription',
    question: 'What is your product/service?',
    description: 'Brief description of what you offer',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., A project management tool for remote teams',
  },
  {
    id: 'valueDelivered',
    question: 'What value does your product deliver?',
    description: 'Quantifiable benefits customers receive',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Saves 5 hours/week on project coordination, reduces missed deadlines by 40%',
  },
  {
    id: 'competitorPricing',
    question: 'What do competitors charge?',
    description: 'Pricing of similar products in the market',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Asana: $10.99/user/mo, Monday: $9/user/mo, Basecamp: $99/mo flat',
  },
  {
    id: 'costStructure',
    question: 'What are your costs?',
    description: 'Fixed and variable costs to deliver your product',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Hosting: $500/mo, Support: $2000/mo, Development: $8000/mo',
  },
  {
    id: 'targetCustomers',
    question: 'Who are your target customers?',
    description: 'Customer segments and their budget sensitivity',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., SMBs with 10-50 employees, moderate budget sensitivity',
  },
  {
    id: 'businessModel',
    question: 'What business model are you considering?',
    description: 'How you plan to charge customers',
    type: 'select',
    required: true,
    options: ['SaaS Subscription', 'Usage-Based', 'One-Time Purchase', 'Freemium', 'Marketplace/Transaction Fee', 'Hybrid'],
    defaultValue: 'SaaS Subscription',
  },
  {
    id: 'currentPricing',
    question: 'Do you have current pricing? If so, what is it?',
    description: 'Your existing pricing if any',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Currently $19/user/month with annual discount',
  },
  {
    id: 'goals',
    question: 'What are your pricing goals?',
    description: 'What you want to achieve with pricing',
    type: 'multiselect',
    required: true,
    options: ['Maximize revenue', 'Maximize adoption/growth', 'Premium positioning', 'Undercut competitors', 'Simple and transparent'],
  },
];

const pricingStrategyPrompt = `You are helping a solo founder develop a pricing strategy.

Based on the following information:

**Product:** {{productDescription}}
**Value Delivered:** {{valueDelivered}}
**Competitor Pricing:** {{competitorPricing}}
**Cost Structure:** {{costStructure}}
**Target Customers:** {{targetCustomers}}
**Business Model:** {{businessModel}}
**Current Pricing:** {{currentPricing}}
**Goals:** {{goals}}

Generate a comprehensive Pricing Strategy document in Markdown format:

# Pricing Strategy

## Executive Summary
[2-3 paragraph overview of the recommended pricing approach]

## Value Analysis

### Value Quantification
| Value Driver | Quantified Benefit | Customer Segment |
|--------------|-------------------|------------------|
| [Value 1] | [$ or time saved] | [Segment] |
| [Value 2] | [$ or time saved] | [Segment] |

### Value-Based Price Ceiling
[Calculate the maximum price based on value delivered]

## Competitive Analysis

### Market Pricing Landscape
| Competitor | Pricing Model | Price Point | Positioning |
|------------|--------------|-------------|-------------|
| [Comp 1] | | | |
| [Comp 2] | | | |
| [Comp 3] | | | |

### Competitive Positioning
[Where you should position relative to competitors and why]

## Cost Analysis

### Unit Economics
- **Cost to Serve (per customer/month):** $X
- **Customer Acquisition Cost (CAC):** $X
- **Target Gross Margin:** X%
- **Minimum Viable Price:** $X

### Break-Even Analysis
[Calculate break-even at different price points]

## Recommended Pricing Structure

### Pricing Tiers
| Tier | Price | Features | Target Customer |
|------|-------|----------|-----------------|
| Free/Trial | | | |
| Starter | | | |
| Professional | | | |
| Enterprise | | | |

### Packaging Strategy
[What to include in each tier and why]

### Pricing Psychology
- Anchoring strategy
- Decoy options
- Annual vs monthly incentives

## Implementation Plan

### Pricing Page Layout
[Describe the recommended pricing page structure]

### Discounting Strategy
| Scenario | Discount | Terms |
|----------|----------|-------|
| Annual commitment | | |
| Early adopter | | |
| Startup program | | |
| Enterprise deal | | |

### Price Change Protocol
[How to handle future price changes]

## Metrics to Track
- Conversion rate by tier
- Average Revenue Per User (ARPU)
- Upgrade/downgrade rates
- Price sensitivity indicators

## Testing Recommendations
[How to validate pricing before full launch]`;

const pricingPageCopyPrompt = `You are helping a solo founder write pricing page copy.

Based on the business information:

**Product:** {{productDescription}}
**Value Delivered:** {{valueDelivered}}
**Business Model:** {{businessModel}}
**Target Customers:** {{targetCustomers}}

Generate pricing page copy in Markdown format:

# Pricing Page Copy

## Headline Options
1. [Option 1]
2. [Option 2]
3. [Option 3]

## Subheadline Options
1. [Option 1]
2. [Option 2]
3. [Option 3]

## Tier Descriptions

### Free/Trial Tier
**Name suggestions:** [3 options]
**Tagline:** [1 line description]
**Who it's for:** [Target user]
**CTA button text:** [Button text]

### Starter Tier
**Name suggestions:** [3 options]
**Tagline:** [1 line description]
**Who it's for:** [Target user]
**CTA button text:** [Button text]

### Professional Tier (Recommended)
**Name suggestions:** [3 options]
**Tagline:** [1 line description]
**Who it's for:** [Target user]
**CTA button text:** [Button text]
**"Most Popular" badge copy:** [Text]

### Enterprise Tier
**Name suggestions:** [3 options]
**Tagline:** [1 line description]
**Who it's for:** [Target user]
**CTA button text:** [Button text]

## Feature Comparison Table Copy
[How to describe features in the comparison]

## FAQ Section

### Common Pricing Questions
1. **Q: [Question about billing]**
   A: [Answer]

2. **Q: [Question about changing plans]**
   A: [Answer]

3. **Q: [Question about enterprise/custom pricing]**
   A: [Answer]

4. **Q: [Question about refunds]**
   A: [Answer]

5. **Q: [Question about discounts]**
   A: [Answer]

## Trust Elements
- Money-back guarantee copy
- Security/compliance badges to include
- Social proof placement recommendations

## Urgency/Scarcity Elements (Optional)
[Ethical urgency copy if applicable]`;

export const PricingStrategy: WorkflowTemplate = {
  id: 'pricing-strategy',
  name: 'Pricing Strategy',
  description: 'Develop a comprehensive pricing strategy and pricing page copy for your product.',
  version: '1.0.0',
  category: 'planning',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Pricing Interview',
      description: 'Gather information about your product value and costs',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-strategy',
      type: 'generate',
      name: 'Generate Pricing Strategy',
      description: 'Create a comprehensive pricing strategy',
      config: {
        outputFile: 'PRICING_STRATEGY.md',
        promptTemplate: pricingStrategyPrompt,
        systemPrompt: 'You are a pricing strategist helping founders optimize their revenue model. Be data-driven and practical.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-copy',
      type: 'generate',
      name: 'Generate Pricing Page Copy',
      description: 'Create copy for your pricing page',
      config: {
        outputFile: 'PRICING_PAGE_COPY.md',
        promptTemplate: pricingPageCopyPrompt,
        systemPrompt: 'You are a conversion copywriter helping founders communicate value. Be clear and persuasive.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['PRICING_STRATEGY.md', 'PRICING_PAGE_COPY.md'],
};

export default PricingStrategy;
