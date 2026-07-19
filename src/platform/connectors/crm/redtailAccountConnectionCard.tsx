import { RedtailConnect } from './RedtailConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { crmIsConnected } from '@/platform/utils/wealthbox-commands';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    redtail: true;
  }
}
const render = () => <RedtailConnect />;
export const redtailConnectionCard: ConnectionCardDescriptor = {
  id: 'redtail',
  labelKey: 'connectors.redtail',
  displayName: 'Redtail',
  placement: 'connections',
  order: 150,
  render,
  isConnected: () => crmIsConnected('redtail'),
};
