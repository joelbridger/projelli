import { OneDriveConnect } from './OneDriveConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
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
