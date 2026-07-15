import { WealthboxConnect } from './WealthboxConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    wealthbox: true;
  }
}
const render = () => <WealthboxConnect />;
export const wealthboxConnectionCard: ConnectionCardDescriptor = {
  id: 'wealthbox',
  labelKey: 'connectors.wealthbox',
  placement: 'connections',
  order: 60,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
