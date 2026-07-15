import { ZocksConnect } from './ZocksConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
const render = () => <ZocksConnect />;
export const zocksConnectionCard: ConnectionCardDescriptor = {
  id: 'zocks',
  labelKey: 'connectors.zocks',
  placement: 'connections',
  order: 110,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
