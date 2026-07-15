import { WealthboxConnect } from './WealthboxConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
const render = () => <WealthboxConnect />;
export const wealthboxConnectionCard: ConnectionCardDescriptor = {
  id: 'wealthbox',
  labelKey: 'connectors.wealthbox',
  placement: 'connections',
  order: 60,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
