/**
 * Product-owned starting points, not user records. A card only becomes a
 * saved workflow after someone chooses it, and can then be edited normally.
 */
export type StarterWorkflow = {
  id: string;
  name: string;
  description: string;
  steps: readonly string[];
};

export const STARTER_WORKFLOWS: readonly StarterWorkflow[] = [
  {
    id: 'client-onboarding',
    name: 'Client onboarding',
    description: 'Bring a new household on board without losing the small details.',
    steps: ['Confirm household details', 'Open accounts', 'Send welcome packet'],
  },
  {
    id: 'annual-review',
    name: 'Annual review',
    description: 'Prepare, hold, and follow through on a client review.',
    steps: ['Prepare review', 'Hold client meeting', 'Send follow-up summary'],
  },
  {
    id: 'life-event',
    name: 'Life event follow-up',
    description: 'Give a household a clear response when life changes.',
    steps: ['Understand the change', 'Review the plan', 'Confirm next steps'],
  },
  {
    id: 'trade-request',
    name: 'Trade request',
    description: 'Review, approve, and document a requested trade.',
    steps: ['Review request', 'Get approval', 'Confirm completion'],
  },
];
