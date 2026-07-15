import {
  useClientContextStore,
  type SharedClientContextAdapter,
  type SharedClientIdentity,
} from '@/platform/client-context';

export type CrmClientsSharedContext =
  | { mode: 'directory' }
  | { mode: 'household'; householdId: string };

export const crmClientsSharedClientContextAdapter = {
  id: 'crm-clients',
  derive: (client): CrmClientsSharedContext =>
    client
      ? { mode: 'household', householdId: client.householdId }
      : { mode: 'directory' },
  selectHousehold: (client: SharedClientIdentity): void => {
    useClientContextStore.getState().setClient(client);
  },
} satisfies SharedClientContextAdapter<CrmClientsSharedContext> & {
  selectHousehold: (client: SharedClientIdentity) => void;
};
