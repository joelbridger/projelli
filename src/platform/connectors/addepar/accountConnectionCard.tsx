import { AddeparConnect } from './AddeparConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { addeparIsConnected } from '@/platform/utils/addepar-commands';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    addepar: true;
  }
}
const render = () => <AddeparConnect />;
export const addeparConnectionCard: ConnectionCardDescriptor = {
  id: 'addepar',
  labelKey: 'connectors.addepar',
  displayName: 'Addepar',
  placement: 'connections',
  order: 70,
  render,
  isConnected: addeparIsConnected,
};
