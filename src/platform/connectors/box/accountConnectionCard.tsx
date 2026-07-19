import { BoxConnect } from './BoxConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { boxIsConnected } from '@/platform/utils/box-commands';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    box: true;
  }
}
const render = () => <BoxConnect />;
export const boxConnectionCard: ConnectionCardDescriptor = {
  id: 'box',
  labelKey: 'connectors.box',
  displayName: 'Box',
  placement: 'connections',
  order: 50,
  render,
  isConnected: boxIsConnected,
};
