import type { SharedClientContextAdapter } from '@/platform/client-context';

export type AskSharedClientContext =
  | { scope: 'whole-firm' }
  | { scope: 'client'; householdId: string };

export const askSharedClientContextAdapter = {
  id: 'ask',
  derive: (client): AskSharedClientContext =>
    client
      ? { scope: 'client', householdId: client.householdId }
      : { scope: 'whole-firm' },
} satisfies SharedClientContextAdapter<AskSharedClientContext>;
