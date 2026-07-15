import { AddeparConnect } from './AddeparConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
const render = () => <AddeparConnect />;
export const addeparConnectionCard: ConnectionCardDescriptor = {
  id: 'addepar',
  labelKey: 'connectors.addepar',
  placement: 'connections',
  order: 70,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
