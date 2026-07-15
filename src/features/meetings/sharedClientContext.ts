import {
  useClientContextStore,
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
    useClientContextStore.getState().clearClient();
  },
} satisfies SharedClientContextAdapter<MeetingsSharedClientContext> & {
  showAllMeetings: () => void;
};
