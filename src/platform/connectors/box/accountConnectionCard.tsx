import { BoxConnect } from './BoxConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
const render = () => <BoxConnect />;
export const boxConnectionCard: ConnectionCardDescriptor = {
  id: 'box',
  labelKey: 'connectors.box',
  placement: 'connections',
  order: 50,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
