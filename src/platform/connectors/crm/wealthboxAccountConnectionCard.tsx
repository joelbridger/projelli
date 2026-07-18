import { WealthboxConnect } from './WealthboxConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { crmIsConnected } from '@/platform/utils/wealthbox-commands';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    wealthbox: true;
  }
}
const render = () => <WealthboxConnect />;
export const wealthboxConnectionCard: ConnectionCardDescriptor = {
  id: 'wealthbox',
  labelKey: 'connectors.wealthbox',
  displayName: 'Wealthbox',
  placement: 'connections',
  order: 60,
  render,
  isConnected: () => crmIsConnected('wealthbox'),
};
