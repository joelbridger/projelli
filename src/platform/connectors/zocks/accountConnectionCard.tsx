import { ZocksConnect } from './ZocksConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    zocks: true;
  }
}
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
