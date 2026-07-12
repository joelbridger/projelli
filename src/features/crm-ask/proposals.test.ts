import { describe, expect, it } from 'vitest';
import { createCrmAskProposal } from './proposals';

const citedAnswer = {
  question: 'What needs doing?',
  answer: 'Call the client. {1}',
  citations: [{
    n: 1,
    label: 'Call note',
    excerpt: 'Call the client after the review.',
    path: 'crm:note:note-1',
    locator: 'CRM note',
    verified: true,
    grounded: true,
    sourceType: 'crm' as const,
    matterId: 'household-1',
  }],
  sources: [],
};

describe('CRM Ask proposals', () => {
  it('prepares a task as a pending approval instead of writing a task', () => {
    const proposal = createCrmAskProposal({
      kind: 'task_create',
      text: 'Call the client after the review',
      householdId: 'household-1',
      answer: citedAnswer,
      now: '2026-07-12T10:00:00.000Z',
    });

    expect(proposal).toMatchObject({
      kind: 'proposalRecord',
      matterId: 'household-1',
      proposalKind: 'task_create',
      state: 'pending',
      proposedMutation: {
        kind: 'task_create',
        task: { title: 'Call the client after the review' },
      },
      contextRefs: [{ kind: 'note', id: 'note-1', matterId: 'household-1' }],
    });
  });

  it('requires a household so a proposal cannot be written into an all-client void', () => {
    expect(() => createCrmAskProposal({
      kind: 'fact_add',
      text: 'Client prefers annual reviews',
      householdId: null,
      answer: citedAnswer,
    })).toThrow('Open a household');
  });
});
