// New Business Kickoff Workflow Template
// The flagship workflow that interviews the founder and generates core documents

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

/**
 * Interview questions for business kickoff
 */
const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'problem',
    question: 'What problem are you solving?',
    description: 'Describe the pain point or need your business addresses',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Small businesses struggle to manage customer relationships without expensive CRM software',
  },
  {
    id: 'solution',
    question: 'What is your solution?',
    description: 'How does your product or service solve this problem?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., An affordable, easy-to-use CRM designed specifically for small businesses',
  },
  {
    id: 'targetCustomer',
    question: 'Who is your target customer?',
    description: 'Describe your ideal customer in detail',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Small business owners with 5-50 employees, primarily in service industries',
  },
  {
    id: 'uniqueValue',
    question: 'What makes you unique?',
    description: 'What is your competitive advantage or unique value proposition?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., AI-powered contact insights that save 5 hours/week',
  },
  {
    id: 'channels',
    question: 'How will you reach customers?',
    description: 'What channels will you use to acquire customers?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Content marketing, LinkedIn ads, partner referrals',
  },
  {
    id: 'revenueModel',
    question: 'How will you make money?',
    description: 'What is your pricing and revenue model?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., SaaS subscription at $29/month per user',
  },
  {
    id: 'competitors',
    question: 'Who are your competitors?',
    description: 'List existing alternatives and competitors',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Salesforce (enterprise), HubSpot (freemium), spreadsheets (manual)',
  },
  {
    id: 'stage',
    question: 'What stage is your business?',
    description: 'Where are you in your journey?',
    type: 'select',
    required: true,
    options: ['Idea', 'Validation', 'Building MVP', 'Launched', 'Growing'],
    defaultValue: 'Idea',
  },
];

/**
 * Vision document generation prompt
 */
const visionPrompt = `You are helping a solo founder create a Vision document for their business.

Based on the following information from the founder:

**Problem:** {{problem}}

**Solution:** {{solution}}

**Target Customer:** {{targetCustomer}}

**Unique Value:** {{uniqueValue}}

**Stage:** {{stage}}

Generate a comprehensive Vision document in Markdown format that includes:

1. **Executive Summary** - A compelling 2-3 paragraph overview
2. **Problem Statement** - Deep dive into the pain point
3. **Solution Overview** - How the product/service addresses the problem
4. **Target Market** - Detailed customer persona and market size
5. **Unique Value Proposition** - Why customers will choose this over alternatives
6. **Vision Statement** - Where this company will be in 5 years
7. **Success Metrics** - How success will be measured
8. **Key Assumptions** - Explicit assumptions that need validation

Make it specific to this business, not generic. Use concrete numbers and examples where possible.`;

/**
 * PRD generation prompt
 */
const prdPrompt = `You are helping a solo founder create a Product Requirements Document (PRD).

Based on the business information:

**Problem:** {{problem}}
**Solution:** {{solution}}
**Target Customer:** {{targetCustomer}}
**Unique Value:** {{uniqueValue}}
**Revenue Model:** {{revenueModel}}
**Stage:** {{stage}}

Generate a PRD in Markdown format that includes:

1. **Overview** - What we're building and why
2. **Goals and Non-Goals** - What this version will and won't do
3. **User Stories** - At least 10 user stories in "As a [user], I want [feature] so that [benefit]" format
4. **Functional Requirements** - Detailed feature list
5. **Non-Functional Requirements** - Performance, security, scalability needs
6. **Success Criteria** - How we know this is working
7. **Open Questions** - Decisions that still need to be made
8. **Future Considerations** - What might come next

Focus on an MVP scope appropriate for a {{stage}} stage business.`;

/**
 * Lean Canvas generation prompt
 */
const leanCanvasPrompt = `You are helping a solo founder create a Lean Canvas.

Based on the business information:

**Problem:** {{problem}}
**Solution:** {{solution}}
**Target Customer:** {{targetCustomer}}
**Unique Value:** {{uniqueValue}}
**Channels:** {{channels}}
**Revenue Model:** {{revenueModel}}
**Competitors:** {{competitors}}

Generate a Lean Canvas in Markdown table format with all 9 sections:

| Section | Content |
|---------|---------|
| **Problem** | (Top 3 problems) |
| **Customer Segments** | (Target customers and early adopters) |
| **Unique Value Proposition** | (Single, clear, compelling message) |
| **Solution** | (Top 3 features that address the problems) |
| **Channels** | (Path to customers) |
| **Revenue Streams** | (How you make money) |
| **Cost Structure** | (Fixed and variable costs) |
| **Key Metrics** | (Key activities you measure) |
| **Unfair Advantage** | (Can't be easily copied or bought) |

After the table, add a brief narrative explaining the business model in 2-3 paragraphs.`;

/**
 * New Business Kickoff workflow template
 */
export const NewBusinessKickoff: WorkflowTemplate = {
  id: 'new-business-kickoff',
  name: 'New Business Kickoff',
  description: 'Interview-driven workflow that generates Vision, PRD, and Lean Canvas documents for a new business idea.',
  version: '1.0.0',
  category: 'kickoff',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Business Interview',
      description: 'Answer questions about your business idea',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-vision',
      type: 'generate',
      name: 'Generate Vision Document',
      description: 'Create a comprehensive vision document',
      config: {
        outputFile: 'VISION.md',
        promptTemplate: visionPrompt,
        systemPrompt: 'You are an experienced startup advisor helping founders create clear, compelling business documents. Be specific and actionable.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-prd',
      type: 'generate',
      name: 'Generate PRD',
      description: 'Create a product requirements document',
      config: {
        outputFile: 'PRD.md',
        promptTemplate: prdPrompt,
        systemPrompt: 'You are a senior product manager helping founders define their MVP. Be practical and focused on what matters most.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-lean-canvas',
      type: 'generate',
      name: 'Generate Lean Canvas',
      description: 'Create a one-page business model',
      config: {
        outputFile: 'LEAN_CANVAS.md',
        promptTemplate: leanCanvasPrompt,
        systemPrompt: 'You are a business model expert helping founders think through their business systematically.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['VISION.md', 'PRD.md', 'LEAN_CANVAS.md'],
};

export default NewBusinessKickoff;
