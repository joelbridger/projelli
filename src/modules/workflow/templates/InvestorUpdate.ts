// Investor Update Workflow Template
// Generates a monthly investor update doc for founders running a periodic
// communication cadence with investors, advisors, or interested parties.
// @deprecated — Retiring in v2.1. Founder-ICP template not relevant to legal/tax/consulting audience.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'period',
    question: 'What period does this update cover?',
    description: 'e.g., "March 2026" or "Q1 2026"',
    type: 'text',
    required: true,
    placeholder: 'March 2026',
  },
  {
    id: 'tldr',
    question: 'TL;DR — one or two sentences',
    description: 'The most important takeaway from this period. If your investors only read one sentence, what should it be?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., We crossed $10K MRR this month, signed our first enterprise deal, and started recruiting our second engineer.',
  },
  {
    id: 'wins',
    question: 'What went well this period?',
    description: 'Top 3-5 wins. Be specific — numbers and proper nouns matter.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 1) Revenue grew 40% MoM, 2) Closed $12K ACV deal with Acme Corp, 3) Shipped onboarding redesign that lifted activation 2x',
  },
  {
    id: 'challenges',
    question: 'What were the challenges or losses?',
    description: 'Be honest. Investors trust founders who tell it straight more than founders who only share wins.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Lost two key customers to a competitor; hired a senior engineer who didn\'t work out and we let them go after 30 days',
  },
  {
    id: 'metrics',
    question: 'Key metrics for this period',
    description: 'Whatever your North Star metrics are. Include the previous period for comparison.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., MRR: $10,200 (+38% MoM); New customers: 18; Churn: 2.1%; Cash on hand: $145K; Runway: 11 months',
  },
  {
    id: 'asks',
    question: 'What do you need help with?',
    description: 'Specific asks investors can act on. Intros, hires, intros to specific people, advice on a decision.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Looking for intros to VPs of Engineering at Series A B2B SaaS companies; need a recommendation for a fractional CFO',
  },
  {
    id: 'nextPeriod',
    question: 'What\'s the focus for next period?',
    description: 'The 1-3 things you\'re going to do next. Concrete, not aspirational.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 1) Close 5 new customers from the current pipeline, 2) Ship the API integration, 3) Hire a customer success manager',
  },
  {
    id: 'audience',
    question: 'Audience',
    description: 'Who is this update for?',
    type: 'select',
    required: true,
    options: ['Investors only', 'Investors + advisors', 'Investors + advisors + close friends', 'Public update'],
    defaultValue: 'Investors + advisors',
  },
];

const investorUpdatePrompt = `You are helping a founder draft a monthly investor update.

The audience is: {{audience}}

Source material from the founder for this period ({{period}}):

**TL;DR (founder's words):** {{tldr}}

**Wins:** {{wins}}

**Challenges:** {{challenges}}

**Metrics:** {{metrics}}

**Asks:** {{asks}}

**Next period focus:** {{nextPeriod}}

Write a professional, well-structured investor update in Markdown format. The update should:

1. Start with a clear header: "# {{period}} Update"
2. Open with the TL;DR (1-2 sentences max, the most important thing first)
3. **Headline metrics** — a clean bullet list of the most important numbers, with comparisons to the previous period where relevant
4. **What worked** — the wins, framed concretely with numbers and names where the founder provided them
5. **What didn't** — the challenges, presented honestly (not minimized, not catastrophized)
6. **Asks** — explicit, actionable requests. Bullet list. Each ask should be specific enough that the reader knows immediately whether they can help.
7. **Looking ahead** — the focus for next period, framed as concrete commitments rather than aspirations
8. A short closing — one sentence, professional but warm

Tone guidelines:
- Direct and confident, not promotional or hyped
- Specific over vague (numbers, names, dates)
- Honest about losses (investors detect spin)
- Brief — investors are busy, the whole update should be readable in under 3 minutes
- No corporate jargon ("synergize", "leverage", "circle back")
- No filler phrases ("exciting times ahead", "stay tuned", "we're crushing it")

If the audience is "Public update," lean slightly more upbeat and less detailed on financials. If "Investors only," include all financial details.`;

export const InvestorUpdate: WorkflowTemplate = {
  id: 'investor-update',
  name: 'Investor Update',
  description: 'Generate a monthly or quarterly update for investors and advisors. Headlines, metrics, wins, losses, asks, next focus.',
  version: '1.0.0',
  category: 'planning',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Period Interview',
      description: 'Answer questions about this update period',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-update',
      type: 'generate',
      name: 'Generate Investor Update',
      description: 'Draft the update doc',
      config: {
        outputFile: 'updates/{{period}}-update.md',
        promptTemplate: investorUpdatePrompt,
        systemPrompt: 'You are an experienced founder communicator. You have written hundreds of investor updates and know what investors actually want to read: numbers, honesty, brevity, and clear asks. You never use marketing speak.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['updates/{{period}}-update.md'],
};

export default InvestorUpdate;
