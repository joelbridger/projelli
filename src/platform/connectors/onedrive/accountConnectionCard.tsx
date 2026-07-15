import { OneDriveConnect } from './OneDriveConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    onedrive: true;
  }
}
const render = () => <OneDriveConnect />;
export const oneDriveConnectionCard: ConnectionCardDescriptor = {
  id: 'onedrive',
  labelKey: 'connectors.onedrive',
  placement: 'connections',
  order: 40,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
