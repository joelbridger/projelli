import { RedtailConnect } from './RedtailConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    redtail: true;
  }
}
const render = () => <RedtailConnect />;
export const redtailConnectionCard: ConnectionCardDescriptor = {
  id: 'redtail',
  labelKey: 'connectors.redtail',
  placement: 'connections',
  order: 150,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
