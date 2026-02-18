// Competitor Analysis Workflow Template
// Helps founders analyze their competitive landscape

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'businessName',
    question: 'What is your business/product name?',
    description: 'The name of your business or product',
    type: 'text',
    required: true,
    placeholder: 'e.g., TaskFlow Pro',
  },
  {
    id: 'industry',
    question: 'What industry are you in?',
    description: 'The market category your business operates in',
    type: 'text',
    required: true,
    placeholder: 'e.g., Project Management Software, E-commerce, FinTech',
  },
  {
    id: 'competitors',
    question: 'Who are your known competitors?',
    description: 'List competitors you already know about (direct and indirect)',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Asana, Monday.com, Trello, Notion (for project management)',
  },
  {
    id: 'yourStrengths',
    question: 'What are your key strengths?',
    description: 'What do you do better than existing solutions?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Simpler UI, lower price, AI-powered features, better mobile app',
  },
  {
    id: 'targetMarket',
    question: 'Who is your target market?',
    description: 'The specific customer segment you are targeting',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Small marketing agencies with 5-20 employees',
  },
  {
    id: 'pricingStrategy',
    question: 'What is your pricing approach?',
    description: 'How do you plan to price compared to competitors?',
    type: 'select',
    required: true,
    options: ['Premium (higher than competitors)', 'Competitive (similar to market)', 'Value (lower than competitors)', 'Freemium', 'Usage-based'],
    defaultValue: 'Competitive (similar to market)',
  },
];

const competitorMatrixPrompt = `You are helping a solo founder analyze their competitive landscape.

Based on the following information:

**Business Name:** {{businessName}}
**Industry:** {{industry}}
**Known Competitors:** {{competitors}}
**Your Strengths:** {{yourStrengths}}
**Target Market:** {{targetMarket}}
**Pricing Strategy:** {{pricingStrategy}}

Generate a comprehensive Competitor Analysis document in Markdown format:

1. **Executive Summary** - Key competitive insights in 2-3 paragraphs

2. **Competitor Matrix**
   Create a detailed comparison table:
   | Feature/Aspect | {{businessName}} | [Competitor 1] | [Competitor 2] | [Competitor 3] |
   |----------------|-----------------|----------------|----------------|----------------|
   | Target Audience | | | | |
   | Pricing | | | | |
   | Key Features | | | | |
   | Strengths | | | | |
   | Weaknesses | | | | |

3. **Competitor Deep Dives** - 2-3 paragraph analysis of each major competitor

4. **Market Positioning Map** - Describe where each player sits (visualize with text)

5. **Competitive Advantages** - Your specific advantages over each competitor

6. **Competitive Threats** - Areas where competitors have advantages

7. **Differentiation Strategy** - How to position against each competitor

8. **Actionable Recommendations** - 5-7 specific actions to compete effectively

Be specific and actionable. Identify real weaknesses you can exploit.`;

const battleCardsPrompt = `You are helping a solo founder create sales battle cards against competitors.

Based on the competitive analysis information:

**Business Name:** {{businessName}}
**Industry:** {{industry}}
**Competitors:** {{competitors}}
**Your Strengths:** {{yourStrengths}}
**Target Market:** {{targetMarket}}

Generate a Battle Cards document in Markdown format with a section for each major competitor:

For each competitor, include:

## [Competitor Name] Battle Card

### Quick Facts
- Founded:
- Pricing:
- Target:
- Funding/Size:

### When They Come Up
- Common scenarios where prospects mention them
- Types of customers they appeal to

### Our Advantages
- Key differentiators (bullet points)
- Proof points and evidence

### Their Advantages
- What they do well
- Acknowledge honestly

### Objection Handling
| Objection | Response |
|-----------|----------|
| "They're more established" | [Response] |
| "They have feature X" | [Response] |
| [Other common objection] | [Response] |

### Killer Questions
- Questions that expose their weaknesses
- Questions that highlight your strengths

### Win Themes
- Key messages that resonate when competing against them

Create battle cards for the top 3-4 competitors mentioned.`;

export const CompetitorAnalysis: WorkflowTemplate = {
  id: 'competitor-analysis',
  name: 'Competitor Analysis',
  description: 'Analyze your competitive landscape and create battle cards for sales conversations.',
  version: '1.0.0',
  category: 'research',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Competitive Landscape Interview',
      description: 'Gather information about your market and competitors',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-matrix',
      type: 'generate',
      name: 'Generate Competitor Matrix',
      description: 'Create a detailed competitive analysis',
      config: {
        outputFile: 'COMPETITOR_ANALYSIS.md',
        promptTemplate: competitorMatrixPrompt,
        systemPrompt: 'You are a strategic business analyst helping founders understand their competitive landscape. Be thorough and objective.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-battle-cards',
      type: 'generate',
      name: 'Generate Battle Cards',
      description: 'Create sales battle cards for each competitor',
      config: {
        outputFile: 'BATTLE_CARDS.md',
        promptTemplate: battleCardsPrompt,
        systemPrompt: 'You are a sales enablement expert creating tools for competitive selling. Be practical and persuasive.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['COMPETITOR_ANALYSIS.md', 'BATTLE_CARDS.md'],
};

export default CompetitorAnalysis;
