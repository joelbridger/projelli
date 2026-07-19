import { ShareFileConnect } from './ShareFileConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { sharefileIsConnected } from '@/platform/utils/sharefile-commands';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    sharefile: true;
  }
}
const render = () => <ShareFileConnect />;
export const shareFileConnectionCard: ConnectionCardDescriptor = {
  id: 'sharefile',
  labelKey: 'connectors.sharefile',
  displayName: 'ShareFile',
  placement: 'connections',
  order: 90,
  render,
  isConnected: sharefileIsConnected,
};
