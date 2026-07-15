import { JotformConnect } from './JotformConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
const render = () => <JotformConnect />;
export const jotformConnectionCard: ConnectionCardDescriptor = {
  id: 'jotform',
  labelKey: 'connectors.jotform',
  placement: 'connections',
  order: 100,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
