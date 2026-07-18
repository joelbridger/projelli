import {
  issueSharedClientSelection,
  replaceCanonicalHouseholdDirectory,
  requestSharedClientSelection,
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
    replaceCanonicalHouseholdDirectory(client.provider, [client]);
    const request = issueSharedClientSelection(client);
    void requestSharedClientSelection(request).catch((error: unknown) => {
      console.error('[CRM clients] Shared client selection failed.', error);
    });
  },
} satisfies SharedClientContextAdapter<CrmClientsSharedContext> & {
  selectHousehold: (client: SharedClientIdentity) => void;
};
