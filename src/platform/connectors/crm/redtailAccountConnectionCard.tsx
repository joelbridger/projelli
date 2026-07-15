import { RedtailConnect } from './RedtailConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
const render = () => <RedtailConnect />;
export const redtailConnectionCard: ConnectionCardDescriptor = {
  id: 'redtail',
  labelKey: 'connectors.redtail',
  placement: 'connections',
  order: 150,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
