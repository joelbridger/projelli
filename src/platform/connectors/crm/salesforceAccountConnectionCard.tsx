import { SalesforceConnect } from './SalesforceConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
const render = () => <SalesforceConnect />;
export const salesforceConnectionCard: ConnectionCardDescriptor = {
  id: 'salesforce',
  labelKey: 'connectors.salesforce',
  placement: 'connections',
  order: 140,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
