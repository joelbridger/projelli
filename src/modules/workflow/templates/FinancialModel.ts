// Financial Model Workflow Template
// Helps professionals create basic financial projections

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'businessType',
    question: 'What type of practice or business are you modeling?',
    description: 'Your practice model and profession',
    type: 'select',
    required: true,
    options: ['Law firm / Legal practice', 'Accounting / Tax / CPA firm', 'Independent consulting', 'Boutique agency', 'Financial advisory', 'Other professional services'],
    defaultValue: 'Law firm / Legal practice',
  },
  {
    id: 'revenueModel',
    question: 'How do you bill for your services?',
    description: 'Your billing structure and engagement types',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Hourly billing at $350/hr for litigation matters, flat-fee for estate planning documents, monthly retainer for ongoing advisory clients',
  },
  {
    id: 'pricing',
    question: 'What are your rates and fees?',
    description: 'Specific rates, flat fees, or retainer amounts',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Hourly rate: $350, Standard will package: $1,500 flat, Monthly advisory retainer: $2,500/mo',
  },
  {
    id: 'currentNumbers',
    question: 'What are your current numbers (if any)?',
    description: 'Current revenue, active client matters, and monthly costs',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., 38 active client matters, $15K/mo billable, $8K/mo overhead, 3 retainer clients at $2,500/mo each',
  },
  {
    id: 'acquisitionChannels',
    question: 'How do you bring in new clients?',
    description: 'Your main client development channels',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Referrals from past clients, bar association networking, LinkedIn, co-counsel relationships',
  },
  {
    id: 'clientAcquisitionCost',
    question: 'What does it cost to bring in a new client?',
    description: 'Estimated cost per new client (or your best guess)',
    type: 'text',
    required: true,
    placeholder: 'e.g., ~$200 in networking/event costs, or "mostly referrals, hard to quantify"',
  },
  {
    id: 'fixedCosts',
    question: 'What are your fixed monthly costs?',
    description: 'Overhead that does not change with client volume',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Office/rent: $1,200, Malpractice insurance: $400, Software/tools: $300, Bar dues (amortized): $150',
  },
  {
    id: 'variableCosts',
    question: 'What are your variable costs per engagement?',
    description: 'Costs that scale with client matters',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Filing fees, court reporter, expert witnesses, subcontractor costs, payment processing (2.9%)',
  },
  {
    id: 'teamPlans',
    question: 'What are your staffing plans?',
    description: 'When and who you plan to hire',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Solo for now; plan to bring on a paralegal when billing exceeds $20K/mo, then a junior associate in year 2',
  },
  {
    id: 'fundingPlans',
    question: 'How is the practice funded?',
    description: 'Self-funded, line of credit, or other',
    type: 'select',
    required: true,
    options: ['Self-funded / operating cash flow', 'Business line of credit', 'SBA loan', 'Partner capital contributions', 'Undecided'],
    defaultValue: 'Self-funded / operating cash flow',
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

const financialModelPrompt = `You are helping a professional service provider create financial projections for their practice.

Based on the following information:

**Practice Type:** {{businessType}}
**Billing Model:** {{revenueModel}}
**Rates & Fees:** {{pricing}}
**Current Numbers:** {{currentNumbers}}
**Client Development Channels:** {{acquisitionChannels}}
**Client Acquisition Cost:** {{clientAcquisitionCost}}
**Fixed Costs:** {{fixedCosts}}
**Variable Costs:** {{variableCosts}}
**Staffing Plans:** {{teamPlans}}
**Funding:** {{fundingPlans}}
**Time Horizon:** {{timeHorizon}}

Generate a Financial Model document in Markdown format:

# Financial Model

## Executive Summary
[2-3 paragraph overview of the financial projections for this practice]

## Assumptions

### Revenue Assumptions
| Assumption | Value | Rationale |
|------------|-------|-----------|
| Average Revenue per Matter / Engagement | $X | [Based on billing mix] |
| Retainer vs. Project Mix | X% retainer | [Estimate or current mix] |
| Billable Hours per Week | X hrs | [Realistic capacity] |
| Realization Rate | X% | [Billed vs. worked hours] |
| Client Retention Rate | X% annually | [Estimate or historical] |

### Growth Assumptions
| Assumption | Value | Rationale |
|------------|-------|-----------|
| Active Matters / Engagements (Month 1) | X | [Starting point] |
| New Client Growth Rate (Months 1-6) | X/mo | [Early growth] |
| New Client Growth Rate (Months 7-12) | X/mo | [Maturing growth] |
| New Client Growth Rate (Year 2) | X/mo | [Scaled growth] |

### Cost Assumptions
| Category | Amount | Notes |
|----------|--------|-------|
| Fixed Overhead | $X/mo | [Breakdown] |
| Variable Cost per Engagement | $X | [Filing fees, etc.] |
| Client Development Cost | $X/mo | [Networking, marketing] |

## Revenue Projections

### Billable Revenue

#### Year 1 (Monthly)
| Month | New Clients | Active Matters | Billable Revenue | Collected Revenue |
|-------|-------------|----------------|-----------------|-------------------|
| 1 | | | $ | $ |
| 2 | | | $ | $ |
| 3 | | | $ | $ |
| 4 | | | $ | $ |
| 5 | | | $ | $ |
| 6 | | | $ | $ |
| 7 | | | $ | $ |
| 8 | | | $ | $ |
| 9 | | | $ | $ |
| 10 | | | $ | $ |
| 11 | | | $ | $ |
| 12 | | | $ | $ |

**Year 1 Summary:**
- Total Revenue Collected: $X
- Active Client Matters (end of year): X
- Annualized Run Rate: $X

#### Year 2 (Quarterly)
| Quarter | New Clients | Active Matters | Billable Revenue | Collected Revenue |
|---------|-------------|----------------|-----------------|-------------------|
| Q1 | | | $ | $ |
| Q2 | | | $ | $ |
| Q3 | | | $ | $ |
| Q4 | | | $ | $ |

**Year 2 Summary:**
- Total Revenue Collected: $X
- Active Client Matters (end of year): X
- Annualized Run Rate: $X

[Add Year 3 if time horizon extends]

## Cost Projections

### Operating Expenses

#### Year 1 (Monthly)
| Month | Fixed Overhead | Variable Costs | Client Development | Salaries | Total |
|-------|----------------|----------------|--------------------|----------|-------|
| 1-3 avg | $ | $ | $ | $ | $ |
| 4-6 avg | $ | $ | $ | $ | $ |
| 7-9 avg | $ | $ | $ | $ | $ |
| 10-12 avg | $ | $ | $ | $ | $ |

#### Year 2 (Quarterly)
| Quarter | Fixed Overhead | Variable Costs | Client Development | Salaries | Total |
|---------|----------------|----------------|--------------------|----------|-------|
| Q1 | $ | $ | $ | $ | $ |
| Q2 | $ | $ | $ | $ | $ |
| Q3 | $ | $ | $ | $ | $ |
| Q4 | $ | $ | $ | $ | $ |

### Staffing Plan
| Role | When | Monthly Cost | Annual Cost |
|------|------|--------------|-------------|
| [Role 1] | [Month/Quarter] | $ | $ |
| [Role 2] | [Month/Quarter] | $ | $ |

## Profitability Analysis

### Monthly P&L Summary

| Metric | Month 6 | Month 12 | Month 18 | Month 24 |
|--------|---------|----------|----------|----------|
| Billable Revenue | $ | $ | $ | $ |
| Collected Revenue | $ | $ | $ | $ |
| Direct Costs | $ | $ | $ | $ |
| Gross Profit | $ | $ | $ | $ |
| Gross Margin | X% | X% | X% | X% |
| Operating Expenses | $ | $ | $ | $ |
| Net Profit/Loss | $ | $ | $ | $ |
| Net Margin | X% | X% | X% | X% |

### Break-Even Analysis
- **Monthly Break-Even Revenue:** $X
- **Active Matters Needed for Break-Even:** X
- **Projected Break-Even Date:** [Month/Quarter]

## Practice Economics

### Key Performance Indicators (Current or Projected)
| Metric | Value | Benchmark |
|--------|-------|-----------|
| Revenue per Matter (avg) | $X | [Practice area norm] |
| Realization Rate | X% | [Target: >90%] |
| Utilization Rate | X% | [Target: >75% of capacity] |
| Client Retention Rate | X% | [Target: >85% annually] |
| Client Development Cost | $X | [Cost per new client] |
| Revenue per Matter vs. Cost to Serve | $X / $X | [Track margin] |

### Revenue per Matter Calculation
- Average hourly rate or flat fee: $X
- Average hours per matter (if hourly): X hrs
- Average revenue per matter: $X
- Direct costs per matter: $X
- **Gross profit per matter: $X**

## Cash Flow

### Cash Flow Projection

| Month | Revenue | Expenses | Net Cash Flow | Cash Balance |
|-------|---------|----------|---------------|--------------|
| Start | | | | $X (starting) |
| 3 | $ | $ | $ | $ |
| 6 | $ | $ | $ | $ |
| 9 | $ | $ | $ | $ |
| 12 | $ | $ | $ | $ |

### Cash Management Notes
- **Average days to collect:** X days
- **Monthly operating reserve target:** $X (X months of overhead)
- **Current cash position:** $X

### Funding Scenarios
**Self-funded / Operating cash flow:**
- Time to consistent profitability: X months
- Operating reserve needed: $X

**With line of credit or capital:**
- Amount: $X
- Purpose: [Staffing, equipment, etc.]
- Milestones achievable: [List]

## Key Metrics Dashboard

### Metrics to Track Monthly
| Metric | Definition | Target |
|--------|------------|--------|
| Billable Revenue | Total invoiced for the month | Growth |
| Collected Revenue | Cash received | Track vs. billed |
| Realization Rate | Collected / Billed | >90% |
| Utilization Rate | Billable hrs / Available hrs | >75% |
| Revenue per Matter | Revenue / Active matters | Track trend |
| Client Retention Rate | Returning clients / Prior clients | >85% |

## Scenario Analysis

### Conservative Case
[Assumptions and outcomes if client growth is slower than projected]

### Base Case
[Your main projections]

### Optimistic Case
[Assumptions and outcomes if referrals accelerate or major matters close]

## Risks & Sensitivities

| Risk | Impact on Model | Mitigation |
|------|----------------|------------|
| Key client departure | [Impact] | [Plan] |
| Lower utilization | [Impact] | [Plan] |
| Slow collections | [Impact] | [Plan] |
| Delayed new engagements | [Impact] | [Plan] |`;

const metricsTrackerPrompt = `You are helping a professional service provider set up financial metrics tracking for their practice.

Based on:
**Practice Type:** {{businessType}}
**Billing Model:** {{revenueModel}}
**Rates & Fees:** {{pricing}}

Generate a Metrics Tracking Guide in Markdown format:

# Financial Metrics Tracking Guide

## Weekly Metrics (Track Every Week)

### Revenue & Billing
| Metric | How to Calculate | Where to Find | Target |
|--------|-----------------|---------------|--------|
| Hours billed | Sum of billable hours logged | Time tracking system | Track vs. capacity |
| New invoices sent | Total invoiced this week | Billing system | Track trend |
| Payments received | Cash collected | Bank / payment processor | Track vs. invoiced |
| New client inquiries | Leads / consultations | CRM / intake log | Track trend |

### Cash Metrics
| Metric | How to Calculate | Where to Find | Target |
|--------|-----------------|---------------|--------|
| Cash Balance | Current bank balance | Bank account | 2-3 months of overhead |
| Outstanding invoices (A/R) | Sum of unpaid invoices | Billing system | <45 days avg |

## Monthly Metrics (Track Monthly)

### Revenue & Productivity
| Metric | Formula | Target |
|--------|---------|--------|
| Billable Revenue | Total invoiced for the month | Track growth |
| Collected Revenue | Cash received | Track vs. billed |
| Realization Rate | Collected / Billed | >90% |
| Utilization Rate | Billable hrs / Available hrs | >75% of capacity |
| Revenue per Matter | Total revenue / Active matters | Track trend |
| Avg days to collect | Days from invoice to payment | <30 days |

### Client Metrics
| Metric | Formula | Target |
|--------|---------|--------|
| Active Client Matters | Count of open matters/engagements | Track growth |
| New Clients | New clients added this month | Track growth |
| Closed Matters | Matters completed or closed | Track |
| Client Retention Rate | Returning clients / Prior-period clients | >85% annually |

### Profitability
| Metric | Formula | Target |
|--------|---------|--------|
| Gross Revenue | Total collected | Track growth |
| Direct Costs | Costs tied to specific matters | Track % of revenue |
| Gross Profit | Revenue - Direct Costs | Track growth |
| Gross Margin % | Gross Profit / Revenue | >65% for most practices |
| Operating Expenses | Fixed overhead + salaries | Track trend |
| Net Profit/Loss | Gross Profit - OpEx | Path to consistent profitability |
| Monthly Operating Surplus | Net Profit (if positive) | Build 3-month reserve |

## Quarterly Metrics (Track Quarterly)

### Practice Health
| Metric | Formula | Target |
|--------|---------|--------|
| Realization Rate (QoQ) | Collected / Billed for quarter | >90% |
| Client Retention (Annual) | Clients retained / Prior year count | >85% |
| Revenue per Matter | Total revenue / Matters handled | Track trend |
| New Client Revenue | Revenue from clients acquired this quarter | Growing |
| Revenue Concentration | Top client % of total revenue | <30% from any single client |

### Efficiency
| Metric | Formula | Target |
|--------|---------|--------|
| Revenue per Available Hour | Monthly revenue / Available billable hours | Track trend |
| Overhead as % of Revenue | Total overhead / Revenue | <40% for healthy practice |
| Collection Efficiency | Collected / Invoiced (90-day rolling) | >95% |

## Tracking Template

### Weekly Check-In (15 min)

**Week of:** [Date]

**Billing & Revenue:**
- Hours billed: ___ hrs
- New invoices sent: $___
- Payments received: $___
- Outstanding A/R: $___

**Clients:**
- New inquiries: ___
- New matters opened: ___
- Matters closed: ___
- Active matters total: ___

**Cash:**
- Balance: $___
- Weekly spend: $___

**Notes:**
- What went well:
- What needs attention:

### Monthly Review (1 hour)

**Month:** [Month]

**Key Metrics:**
- Billable Revenue: $___  (___% vs last month)
- Collected Revenue: $___
- Realization Rate: ___%
- Utilization Rate: ___%
- Active Matters: ___ (net +___)
- New Clients: ___
- Avg Days to Collect: ___ days
- Gross Margin: ___%
- Net Profit/Loss: $___
- Cash Balance: $___
- Operating Reserve: ___ months

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
- **Wave / FreshBooks**: Invoicing + basic P&L
- **Bank Account**: Cash tracking

### Paid Tools (When Ready)
- **Clio Manage**: Legal practice management + billing
- **QuickBooks**: Accounting + P&L reporting
- **PracticePanther / MyCase**: Matter management + time tracking

## Red Flags to Watch

### Immediate Action Needed
- Realization rate below 80% for 2+ months
- A/R aging beyond 60 days on major invoices
- Cash balance below 1 month of overhead
- Single client representing more than 40% of revenue

### Warning Signs
- Utilization rate trending below 65% without a clear reason
- New client inquiries declining month over month
- Collection time increasing without explanation
- Gross margin declining despite stable pricing`;

export const FinancialModel: WorkflowTemplate = {
  id: 'financial-model',
  name: 'Financial Projections',
  description: 'Create financial projections and a metrics tracking framework for your professional practice.',
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
        systemPrompt: 'You are a financial advisor for professional service firms helping practitioners create realistic projections. Be conservative in estimates and clear about assumptions.',
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
        systemPrompt: 'You are a practice management advisor helping professionals track what matters for a healthy practice. Be practical about what a solo or small-firm practitioner can realistically track.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['FINANCIAL_MODEL.md', 'METRICS_TRACKER.md'],
};

export default FinancialModel;
