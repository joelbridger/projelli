// Pitch Deck Workflow Template
// Helps founders create investor pitch deck content

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'companyName',
    question: 'What is your company name?',
    description: 'The name of your startup',
    type: 'text',
    required: true,
    placeholder: 'e.g., TaskFlow',
  },
  {
    id: 'tagline',
    question: 'What is your one-line description?',
    description: 'A single sentence that explains what you do',
    type: 'text',
    required: true,
    placeholder: 'e.g., AI-powered project management for remote teams',
  },
  {
    id: 'problem',
    question: 'What problem are you solving?',
    description: 'The pain point your customers experience',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Remote teams waste 5+ hours per week on project coordination and status updates',
  },
  {
    id: 'solution',
    question: 'How do you solve it?',
    description: 'Your product/service and how it addresses the problem',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., AI that automatically tracks progress, identifies blockers, and generates status updates',
  },
  {
    id: 'marketSize',
    question: 'How big is the market?',
    description: 'TAM, SAM, SOM or market size estimates',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Project management software market is $6B globally, growing 10% annually',
  },
  {
    id: 'businessModel',
    question: 'How do you make money?',
    description: 'Your revenue model and pricing',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., SaaS subscription at $15/user/month, targeting 100+ employee companies',
  },
  {
    id: 'traction',
    question: 'What traction do you have?',
    description: 'Customers, revenue, growth metrics, waitlist, etc.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 500 beta users, 50 paying customers, $5K MRR, 20% week-over-week growth',
  },
  {
    id: 'competition',
    question: 'Who are your competitors?',
    description: 'Existing alternatives and how you differ',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Asana (enterprise focus), Monday (complex), Basecamp (dated) - we focus on AI automation',
  },
  {
    id: 'team',
    question: 'Who is on your team?',
    description: 'Founders and key team members with relevant experience',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Jane (CEO) - 10 years at Google on productivity tools, John (CTO) - ML lead at Slack',
  },
  {
    id: 'fundraising',
    question: 'What are you raising and what will you use it for?',
    description: 'Amount seeking and use of funds',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Raising $1.5M seed to hire 3 engineers and acquire first 500 paying customers',
  },
  {
    id: 'vision',
    question: 'What is your long-term vision?',
    description: 'Where will this company be in 5-10 years?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Become the AI operating system for how teams work together',
  },
];

const pitchDeckPrompt = `You are helping a founder create pitch deck content for investors.

Based on the following information:

**Company:** {{companyName}}
**Tagline:** {{tagline}}
**Problem:** {{problem}}
**Solution:** {{solution}}
**Market Size:** {{marketSize}}
**Business Model:** {{businessModel}}
**Traction:** {{traction}}
**Competition:** {{competition}}
**Team:** {{team}}
**Fundraising:** {{fundraising}}
**Vision:** {{vision}}

Generate comprehensive pitch deck content in Markdown format:

# {{companyName}} Pitch Deck Content

## Slide 1: Title
**Headline:** {{companyName}}
**Tagline:** {{tagline}}
**Contact:** [Founder name and email]

---

## Slide 2: Problem
**Headline:** [Attention-grabbing problem statement]

### Key Points
- [Problem point 1 with stat if possible]
- [Problem point 2 with stat if possible]
- [Problem point 3 with stat if possible]

**Speaker Notes:**
[2-3 sentences to say while presenting this slide]

---

## Slide 3: Solution
**Headline:** [Clear solution statement]

### How It Works
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Key Visual:** [Describe a product screenshot or diagram to include]

**Speaker Notes:**
[2-3 sentences to say while presenting this slide]

---

## Slide 4: Demo/Product
**Headline:** [Product in action]

### Key Features to Highlight
- [Feature 1 with benefit]
- [Feature 2 with benefit]
- [Feature 3 with benefit]

**Key Visual:** [Describe product screenshots or GIFs]

**Speaker Notes:**
[2-3 sentences to say while presenting this slide]

---

## Slide 5: Market Opportunity
**Headline:** [Market opportunity statement]

### Market Size
- **TAM:** $[X]B - [Description]
- **SAM:** $[X]B - [Description]
- **SOM:** $[X]M - [Description]

**Key Visual:** [Describe a market size visual/chart]

**Speaker Notes:**
[2-3 sentences to say while presenting this slide]

---

## Slide 6: Business Model
**Headline:** [How we make money]

### Revenue Model
| Tier | Price | Target Customer |
|------|-------|-----------------|
| [Tier 1] | $X | [Customer] |
| [Tier 2] | $X | [Customer] |

### Unit Economics (or Projected)
- CAC: $X
- LTV: $X
- LTV:CAC: X:1

**Speaker Notes:**
[2-3 sentences to say while presenting this slide]

---

## Slide 7: Traction
**Headline:** [Impressive traction headline]

### Key Metrics
| Metric | Value | Growth |
|--------|-------|--------|
| [Metric 1] | X | +X% |
| [Metric 2] | X | +X% |

### Milestones
- [Milestone 1]
- [Milestone 2]
- [Milestone 3]

**Key Visual:** [Describe a growth chart]

**Speaker Notes:**
[2-3 sentences to say while presenting this slide]

---

## Slide 8: Competition
**Headline:** [Positioning statement]

### Competitive Landscape
|  | {{companyName}} | [Comp 1] | [Comp 2] | [Comp 3] |
|--|-----------------|----------|----------|----------|
| [Dimension 1] | ✓ | ✗ | ✓ | ✗ |
| [Dimension 2] | ✓ | ✓ | ✗ | ✗ |
| [Dimension 3] | ✓ | ✗ | ✗ | ✓ |

**Key Differentiator:** [Your unfair advantage]

**Speaker Notes:**
[2-3 sentences to say while presenting this slide]

---

## Slide 9: Team
**Headline:** [Team strength statement]

### Founders
**[Name 1] - [Title]**
- [Relevant experience]
- [Key achievement]

**[Name 2] - [Title]**
- [Relevant experience]
- [Key achievement]

### Why This Team
[2-3 sentences on founder-market fit]

**Speaker Notes:**
[2-3 sentences to say while presenting this slide]

---

## Slide 10: The Ask
**Headline:** [What we're raising]

### Use of Funds
| Category | Amount | Purpose |
|----------|--------|---------|
| Engineering | $X | [Purpose] |
| Sales/Marketing | $X | [Purpose] |
| Operations | $X | [Purpose] |

### Milestones This Enables
- [Milestone 1 with timeline]
- [Milestone 2 with timeline]
- [Milestone 3 with timeline]

**Speaker Notes:**
[2-3 sentences to say while presenting this slide]

---

## Slide 11: Vision
**Headline:** [Inspiring vision statement]

### The Future
[2-3 sentences painting a picture of success]

### Why Now
[Why this is the right time for this company]

**Speaker Notes:**
[2-3 sentences to close the pitch]

---

## Appendix Slides (If Needed)

### Detailed Financials
[Financial projections and assumptions]

### Technical Architecture
[Technology overview if relevant]

### Customer Testimonials
[Quotes from customers]

### Additional Traction Details
[More detailed metrics]`;

const pitchScriptPrompt = `You are helping a founder write a pitch script.

Based on:
**Company:** {{companyName}}
**Tagline:** {{tagline}}
**Problem:** {{problem}}
**Solution:** {{solution}}
**Traction:** {{traction}}
**Team:** {{team}}
**Fundraising:** {{fundraising}}

Generate pitch scripts in Markdown format:

# {{companyName}} Pitch Scripts

## 30-Second Elevator Pitch
[Write a compelling 30-second pitch - about 75 words]

---

## 60-Second Pitch
[Write a more detailed 60-second pitch - about 150 words]

---

## 3-Minute Pitch
[Write a comprehensive 3-minute pitch - about 400 words covering:
- Hook/problem
- Solution
- Traction
- Team
- Ask]

---

## 10-Minute Full Pitch Script

### Opening Hook (30 seconds)
[Write the opening]

### Problem (1 minute)
[Write the problem section]

### Solution (2 minutes)
[Write the solution section with demo talking points]

### Market Opportunity (1 minute)
[Write the market section]

### Business Model (1 minute)
[Write the business model section]

### Traction (1.5 minutes)
[Write the traction section]

### Competition (1 minute)
[Write the competitive positioning section]

### Team (1 minute)
[Write the team section]

### The Ask (30 seconds)
[Write the fundraising ask]

### Close (30 seconds)
[Write the closing/vision]

---

## Q&A Preparation

### Expected Questions & Answers

**Q: What's your competitive moat?**
A: [Answer]

**Q: How did you get your first customers?**
A: [Answer]

**Q: What's your customer acquisition cost?**
A: [Answer]

**Q: Why hasn't [competitor] built this?**
A: [Answer]

**Q: What's your biggest risk?**
A: [Answer]

**Q: Why this team?**
A: [Answer]

**Q: What's your path to profitability?**
A: [Answer]

**Q: How will you use the funds?**
A: [Answer]

**Q: What milestones will this raise enable?**
A: [Answer]

**Q: What happens if you don't hit your targets?**
A: [Answer]`;

export const PitchDeck: WorkflowTemplate = {
  id: 'pitch-deck',
  name: 'Investor Pitch Deck',
  description: 'Create comprehensive pitch deck content and scripts for investor presentations.',
  version: '1.0.0',
  category: 'planning',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Pitch Content Interview',
      description: 'Gather information about your company and fundraise',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-deck',
      type: 'generate',
      name: 'Generate Pitch Deck Content',
      description: 'Create slide-by-slide pitch deck content',
      config: {
        outputFile: 'PITCH_DECK_CONTENT.md',
        promptTemplate: pitchDeckPrompt,
        systemPrompt: 'You are an experienced pitch coach who has helped founders raise millions. Create compelling, investor-ready content.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-script',
      type: 'generate',
      name: 'Generate Pitch Scripts',
      description: 'Create various length pitch scripts',
      config: {
        outputFile: 'PITCH_SCRIPTS.md',
        promptTemplate: pitchScriptPrompt,
        systemPrompt: 'You are a pitch coach helping founders deliver compelling presentations. Write conversational, authentic scripts.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['PITCH_DECK_CONTENT.md', 'PITCH_SCRIPTS.md'],
};

export default PitchDeck;
