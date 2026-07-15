import { ShareFileConnect } from './ShareFileConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    sharefile: true;
  }
}
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
