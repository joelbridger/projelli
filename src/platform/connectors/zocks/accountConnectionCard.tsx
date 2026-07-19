import { ZocksConnect } from './ZocksConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { zocksIsConnected } from '@/platform/utils/zocks-commands';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    zocks: true;
  }
}
const render = () => <ZocksConnect />;
export const zocksConnectionCard: ConnectionCardDescriptor = {
  id: 'zocks',
  labelKey: 'connectors.zocks',
  displayName: 'Zocks',
  placement: 'connections',
  order: 110,
  render,
  isConnected: zocksIsConnected,
};
