import { SalesforceConnect } from './SalesforceConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { crmIsConnected } from '@/platform/utils/wealthbox-commands';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    salesforce: true;
  }
}
const render = () => <SalesforceConnect />;
export const salesforceConnectionCard: ConnectionCardDescriptor = {
  id: 'salesforce',
  labelKey: 'connectors.salesforce',
  displayName: 'Salesforce',
  placement: 'connections',
  order: 140,
  render,
  isConnected: () => crmIsConnected('salesforce'),
};
