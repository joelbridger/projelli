import { OneDriveConnect } from './OneDriveConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { oneDriveIsConnected } from '@/platform/utils/onedrive-commands';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    onedrive: true;
  }
}
const render = () => <OneDriveConnect />;
export const oneDriveConnectionCard: ConnectionCardDescriptor = {
  id: 'onedrive',
  labelKey: 'connectors.onedrive',
  displayName: 'OneDrive',
  placement: 'connections',
  order: 40,
  render,
  isConnected: oneDriveIsConnected,
};
