// Financial Model Workflow Template
// Helps founders create basic financial projections

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'businessType',
    question: 'What type of business are you building?',
    description: 'The business model and industry',
    type: 'select',
    required: true,
    options: ['SaaS/Subscription', 'E-commerce', 'Marketplace', 'Service/Consulting', 'Mobile App', 'Hardware', 'Other'],
    defaultValue: 'SaaS/Subscription',
  },
  {
    id: 'revenueModel',
    question: 'How will you make money?',
    description: 'Your pricing and revenue structure',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Monthly subscription at $29/user, with annual discount. Targeting small businesses.',
  },
  {
    id: 'pricing',
    question: 'What is your pricing?',
    description: 'Specific prices for your tiers/products',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Starter: $19/mo, Pro: $49/mo, Team: $99/mo (up to 5 users)',
  },
  {
    id: 'currentNumbers',
    question: 'What are your current numbers (if any)?',
    description: 'Current revenue, customers, costs',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., $2K MRR, 50 paying customers, $3K/mo expenses',
  },
  {
    id: 'acquisitionChannels',
    question: 'How will you acquire customers?',
    description: 'Your main customer acquisition channels',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Content marketing, paid ads ($500/mo budget), partnerships, product-led growth',
  },
  {
    id: 'estimatedCAC',
    question: 'What do you estimate customer acquisition will cost?',
    description: 'Cost to acquire one customer (or your best guess)',
    type: 'text',
    required: true,
    placeholder: 'e.g., $50 per customer, or "I don\'t know"',
  },
  {
    id: 'fixedCosts',
    question: 'What are your fixed monthly costs?',
    description: 'Costs that don\'t change with customers',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Hosting: $100, Tools: $200, Insurance: $100, My salary: $0 (bootstrapping)',
  },
  {
    id: 'variableCosts',
    question: 'What are your variable costs per customer?',
    description: 'Costs that scale with customers',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Payment processing: 3%, Server costs: $0.50/user, Support: $2/user',
  },
  {
    id: 'teamPlans',
    question: 'What are your hiring/team plans?',
    description: 'When you plan to hire and who',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Solo for first year, hire first engineer at $10K MRR, marketer at $25K MRR',
  },
  {
    id: 'fundingPlans',
    question: 'What are your funding plans?',
    description: 'Bootstrapped, raising, or other',
    type: 'select',
    required: true,
    options: ['Bootstrapping', 'Planning to raise seed ($250K-$2M)', 'Planning to raise Series A', 'Already raised funding', 'Undecided'],
    defaultValue: 'Bootstrapping',
  },
  {
    id: 'timeHorizon',
    question: 'What time horizon do you need projections for?',
    description: 'How far into the future',
    type: 'select',
    required: true,
    options: ['12 months', '24 months', '36 months', '5 years'],
    defaultValue: '24 months',
  },
];

const financialModelPrompt = `You are helping a solo founder create financial projections.

Based on the following information:

**Business Type:** {{businessType}}
**Revenue Model:** {{revenueModel}}
**Pricing:** {{pricing}}
**Current Numbers:** {{currentNumbers}}
**Acquisition Channels:** {{acquisitionChannels}}
**Estimated CAC:** {{estimatedCAC}}
**Fixed Costs:** {{fixedCosts}}
**Variable Costs:** {{variableCosts}}
**Team Plans:** {{teamPlans}}
**Funding Plans:** {{fundingPlans}}
**Time Horizon:** {{timeHorizon}}

Generate a Financial Model document in Markdown format:

# Financial Model

## Executive Summary
[2-3 paragraph overview of the financial projections]

## Assumptions

### Revenue Assumptions
| Assumption | Value | Rationale |
|------------|-------|-----------|
| Average Revenue Per User (ARPU) | $X/mo | [Based on pricing mix] |
| Annual vs Monthly Mix | X% annual | [Industry standard or estimate] |
| Annual Discount | X% | [If applicable] |
| Churn Rate | X%/mo | [Industry benchmark or estimate] |
| Expansion Revenue | X%/mo | [Upgrades, upsells] |

### Growth Assumptions
| Assumption | Value | Rationale |
|------------|-------|-----------|
| Month 1 Customers | X | [Starting point] |
| Monthly Growth Rate (Months 1-6) | X% | [Early growth] |
| Monthly Growth Rate (Months 7-12) | X% | [Maturing growth] |
| Monthly Growth Rate (Year 2) | X% | [Scaled growth] |

### Cost Assumptions
| Category | Amount | Notes |
|----------|--------|-------|
| Fixed Costs | $X/mo | [Breakdown] |
| Variable Cost per Customer | $X | [Breakdown] |
| Customer Acquisition Cost | $X | [Based on channels] |

## Revenue Projections

### Monthly Recurring Revenue (MRR)

#### Year 1 (Monthly)
| Month | New Customers | Churned | Total Customers | MRR |
|-------|--------------|---------|-----------------|-----|
| 1 | | | | $ |
| 2 | | | | $ |
| 3 | | | | $ |
| 4 | | | | $ |
| 5 | | | | $ |
| 6 | | | | $ |
| 7 | | | | $ |
| 8 | | | | $ |
| 9 | | | | $ |
| 10 | | | | $ |
| 11 | | | | $ |
| 12 | | | | $ |

**Year 1 Summary:**
- Ending MRR: $X
- Total Customers: X
- Annual Recurring Revenue (ARR): $X

#### Year 2 (Quarterly)
| Quarter | New Customers | Churned | Total Customers | MRR |
|---------|--------------|---------|-----------------|-----|
| Q1 | | | | $ |
| Q2 | | | | $ |
| Q3 | | | | $ |
| Q4 | | | | $ |

**Year 2 Summary:**
- Ending MRR: $X
- Total Customers: X
- ARR: $X

[Add Year 3 if time horizon extends]

## Cost Projections

### Operating Expenses

#### Year 1 (Monthly)
| Month | Fixed Costs | Variable Costs | Marketing | Salaries | Total |
|-------|-------------|----------------|-----------|----------|-------|
| 1-3 avg | $ | $ | $ | $ | $ |
| 4-6 avg | $ | $ | $ | $ | $ |
| 7-9 avg | $ | $ | $ | $ | $ |
| 10-12 avg | $ | $ | $ | $ | $ |

#### Year 2 (Quarterly)
| Quarter | Fixed Costs | Variable Costs | Marketing | Salaries | Total |
|---------|-------------|----------------|-----------|----------|-------|
| Q1 | $ | $ | $ | $ | $ |
| Q2 | $ | $ | $ | $ | $ |
| Q3 | $ | $ | $ | $ | $ |
| Q4 | $ | $ | $ | $ | $ |

### Hiring Plan
| Role | When | Monthly Cost | Annual Cost |
|------|------|--------------|-------------|
| [Role 1] | [Month/Quarter] | $ | $ |
| [Role 2] | [Month/Quarter] | $ | $ |

## Profitability Analysis

### Monthly P&L Summary

| Metric | Month 6 | Month 12 | Month 18 | Month 24 |
|--------|---------|----------|----------|----------|
| MRR | $ | $ | $ | $ |
| Total Revenue | $ | $ | $ | $ |
| COGS | $ | $ | $ | $ |
| Gross Profit | $ | $ | $ | $ |
| Gross Margin | X% | X% | X% | X% |
| Operating Expenses | $ | $ | $ | $ |
| Net Profit/Loss | $ | $ | $ | $ |
| Net Margin | X% | X% | X% | X% |

### Break-Even Analysis
- **Monthly Break-Even Revenue:** $X
- **Customers Needed for Break-Even:** X
- **Projected Break-Even Date:** [Month/Quarter]

## Unit Economics

### Current State (or Projected)
| Metric | Value | Benchmark |
|--------|-------|-----------|
| Customer Acquisition Cost (CAC) | $X | [Industry: $X] |
| Lifetime Value (LTV) | $X | [Calculation below] |
| LTV:CAC Ratio | X:1 | [Target: 3:1+] |
| Payback Period | X months | [Target: <12 mo] |

### LTV Calculation
- ARPU: $X/month
- Gross Margin: X%
- Churn Rate: X%/month
- Average Customer Lifetime: X months
- **LTV = ARPU × Gross Margin × Lifetime = $X**

## Cash Flow & Runway

### Cash Flow Projection

| Month | Revenue | Expenses | Net Cash Flow | Cash Balance |
|-------|---------|----------|---------------|--------------|
| Start | | | | $X (starting) |
| 3 | $ | $ | $ | $ |
| 6 | $ | $ | $ | $ |
| 9 | $ | $ | $ | $ |
| 12 | $ | $ | $ | $ |

### Runway Analysis
- **Starting Cash:** $X
- **Monthly Burn Rate (Current):** $X
- **Runway:** X months

### Funding Scenarios
**If Bootstrapping:**
- Time to profitability: X months
- Cash needed: $X

**If Raising Seed:**
- Amount needed: $X
- Runway provided: X months
- Milestones achievable: [List]

## Key Metrics Dashboard

### Metrics to Track Monthly
| Metric | Definition | Target |
|--------|------------|--------|
| MRR | Monthly Recurring Revenue | Growth |
| MRR Growth | Month-over-month change | >10% early |
| Net Revenue Retention | Expansion - Churn | >100% |
| Gross Margin | (Revenue - COGS) / Revenue | >70% |
| CAC Payback | CAC / (ARPU × Gross Margin) | <12 months |
| Burn Multiple | Net Burn / Net New ARR | <2x |

## Scenario Analysis

### Conservative Case
[Assumptions and outcomes if things go slower]

### Base Case
[Your main projections]

### Optimistic Case
[Assumptions and outcomes if things go better]

## Risks & Sensitivities

| Risk | Impact on Model | Mitigation |
|------|----------------|------------|
| Higher churn | [Impact] | [Plan] |
| Lower conversion | [Impact] | [Plan] |
| Higher CAC | [Impact] | [Plan] |
| Delayed revenue | [Impact] | [Plan] |`;

const metricsTrackerPrompt = `You are helping a solo founder set up financial metrics tracking.

Based on:
**Business Type:** {{businessType}}
**Revenue Model:** {{revenueModel}}
**Pricing:** {{pricing}}

Generate a Metrics Tracking Guide in Markdown format:

# Financial Metrics Tracking Guide

## Weekly Metrics (Track Every Week)

### Revenue Metrics
| Metric | How to Calculate | Where to Find | Target |
|--------|-----------------|---------------|--------|
| New MRR | Sum of new subscription revenue | Payment processor | Track trend |
| Churned MRR | Revenue from cancellations | Payment processor | <5% of MRR |
| Net New MRR | New - Churned | Calculation | Positive |
| Trial Starts | New trial signups | App database | Track trend |
| Trial Conversions | Trials → Paid | App database | >15% |

### Cash Metrics
| Metric | How to Calculate | Where to Find | Target |
|--------|-----------------|---------------|--------|
| Cash Balance | Current bank balance | Bank account | Know your runway |
| Weekly Burn | Outflows this week | Bank account | Track trend |

## Monthly Metrics (Track Monthly)

### Revenue & Growth
| Metric | Formula | Target |
|--------|---------|--------|
| MRR | Sum of all recurring revenue | Track growth |
| ARR | MRR × 12 | Track growth |
| MRR Growth Rate | (MRR - Last Month) / Last Month | >10% early stage |
| Revenue per Customer | MRR / Customers | Track trend |

### Customer Metrics
| Metric | Formula | Target |
|--------|---------|--------|
| Total Customers | Count of paying customers | Track growth |
| New Customers | Customers added this month | Track growth |
| Churned Customers | Customers lost this month | <5% monthly |
| Net Customer Growth | New - Churned | Positive |
| Logo Churn Rate | Churned / Start of Month | <5% |

### Unit Economics
| Metric | Formula | Target |
|--------|---------|--------|
| ARPU | MRR / Customers | Track trend |
| CAC | Marketing Spend / New Customers | Decreasing |
| LTV | ARPU × Avg Lifetime × Gross Margin | >3× CAC |
| LTV:CAC | LTV / CAC | >3:1 |
| Payback Period | CAC / (ARPU × Gross Margin) | <12 months |

### Profitability
| Metric | Formula | Target |
|--------|---------|--------|
| Gross Revenue | Total revenue collected | Track growth |
| COGS | Direct costs of delivery | Track % |
| Gross Profit | Revenue - COGS | Track growth |
| Gross Margin % | Gross Profit / Revenue | >70% for SaaS |
| Operating Expenses | All other costs | Track trend |
| Net Profit/Loss | Gross Profit - OpEx | Path to positive |
| Burn Rate | Monthly cash decrease | Track runway |
| Runway | Cash / Burn Rate | >12 months |

## Quarterly Metrics (Track Quarterly)

### Retention & Expansion
| Metric | Formula | Target |
|--------|---------|--------|
| Net Revenue Retention | (Start MRR + Expansion - Churn - Contraction) / Start MRR | >100% |
| Gross Revenue Retention | (Start MRR - Churn - Contraction) / Start MRR | >90% |
| Expansion Revenue | Upgrades + Add-ons | Growing |
| Customer Lifetime (Avg) | 1 / Monthly Churn Rate | >24 months |

### Efficiency
| Metric | Formula | Target |
|--------|---------|--------|
| Burn Multiple | Net Burn / Net New ARR | <2x |
| Magic Number | Net New ARR / Sales & Marketing Spend | >0.75 |
| Rule of 40 | Revenue Growth % + Profit Margin % | >40% |

## Tracking Template

### Weekly Check-In (15 min)

**Week of:** [Date]

**Revenue:**
- New MRR: $___
- Churned MRR: $___
- Net New MRR: $___
- Running MRR: $___

**Customers:**
- New: ___
- Churned: ___
- Total: ___

**Cash:**
- Balance: $___
- Weekly spend: $___

**Notes:**
- What went well:
- What needs attention:

### Monthly Review (1 hour)

**Month:** [Month]

**Key Metrics:**
- MRR: $___  (___% growth)
- Customers: ___ (net +___)
- Churn Rate: ___%
- ARPU: $___
- CAC: $___
- LTV:CAC: ___:1
- Gross Margin: ___%
- Net Profit/Loss: $___
- Cash Balance: $___
- Runway: ___ months

**Highlights:**
1.
2.
3.

**Concerns:**
1.
2.

**Next Month Focus:**
1.
2.
3.

## Tools Recommendations

### Free/Low Cost
- **Spreadsheet**: Google Sheets for basic tracking
- **Stripe Dashboard**: Built-in MRR tracking
- **Bank Account**: Cash tracking

### Paid Tools (When Ready)
- **Baremetrics**: SaaS metrics ($50+/mo)
- **ChartMogul**: Revenue analytics ($100+/mo)
- **ProfitWell**: Free MRR tracking

## Red Flags to Watch

### Immediate Action Needed
- 🚨 Churn rate >10% monthly
- 🚨 LTV:CAC <1:1
- 🚨 Runway <3 months
- 🚨 Negative net MRR growth for 3+ months

### Warning Signs
- ⚠️ Churn rate increasing month over month
- ⚠️ CAC increasing without explanation
- ⚠️ Gross margin declining
- ⚠️ Expansion revenue flat`;

export const FinancialModel: WorkflowTemplate = {
  id: 'financial-model',
  name: 'Financial Projections',
  description: 'Create financial projections and a metrics tracking framework for your startup.',
  version: '1.0.0',
  category: 'planning',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Financial Planning Interview',
      description: 'Gather information about your business model and costs',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-model',
      type: 'generate',
      name: 'Generate Financial Model',
      description: 'Create financial projections',
      config: {
        outputFile: 'FINANCIAL_MODEL.md',
        promptTemplate: financialModelPrompt,
        systemPrompt: 'You are a startup financial advisor helping founders create realistic projections. Be conservative in estimates and clear about assumptions.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-tracker',
      type: 'generate',
      name: 'Generate Metrics Tracker',
      description: 'Create a metrics tracking framework',
      config: {
        outputFile: 'METRICS_TRACKER.md',
        promptTemplate: metricsTrackerPrompt,
        systemPrompt: 'You are a startup metrics expert helping founders track what matters. Be practical about what a solo founder can realistically track.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['FINANCIAL_MODEL.md', 'METRICS_TRACKER.md'],
};

export default FinancialModel;
