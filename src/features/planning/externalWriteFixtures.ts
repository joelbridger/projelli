import type { RightCapitalIncomeProposal } from '@/platform/state/externalWriteQueueStore';

export const RIGHTCAPITAL_INCOME_FIXTURE: RightCapitalIncomeProposal = {
  target: 'rightcapital',
  kind: 'income',
  matterId: 'fixture-matter',
  rightCapitalHouseholdId: 'rc-household-fixture',
  existing: {
    incomeId: 'income-1',
    incomeType: 'Salary',
    owner: 'Robert Henderson',
    amount: 125000,
    frequency: 'annual',
    notes: 'Current salary in plan.',
  },
  fromSource: {
    incomeType: 'Salary',
    owner: 'Robert Henderson',
    amount: 185000,
    frequency: 'annual',
    confidence: 'high',
    quote: 'My salary is now $185,000.',
  },
  final: {
    incomeId: 'income-1',
    incomeType: 'Salary',
    owner: 'Robert Henderson',
    amount: 185000,
    frequency: 'annual',
    notes: 'Updated from advisor-approved meeting fact.',
  },
  sourceRef: 'meeting:fixture#00:18:42',
};
