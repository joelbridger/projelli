import { ShareFileConnect } from './ShareFileConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
const render = () => <ShareFileConnect />;
export const shareFileConnectionCard: ConnectionCardDescriptor = {
  id: 'sharefile',
  labelKey: 'connectors.sharefile',
  placement: 'connections',
  order: 90,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
