import {
  requestClearClientSelection,
  type SharedClientContextAdapter,
} from '@/platform/client-context';

export type MeetingsSharedClientContext =
  | { filter: 'all' }
  | { filter: 'client'; householdId: string };

export const meetingsSharedClientContextAdapter = {
  id: 'meetings',
  derive: (client): MeetingsSharedClientContext =>
    client
      ? { filter: 'client', householdId: client.householdId }
      : { filter: 'all' },
  showAllMeetings: (): void => {
    requestClearClientSelection();
  },
} satisfies SharedClientContextAdapter<MeetingsSharedClientContext> & {
  showAllMeetings: () => void;
};
