import { JotformConnect } from './JotformConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { jotformIsConnected } from '@/platform/utils/jotform-commands';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    jotform: true;
  }
}
const render = () => <JotformConnect />;
export const jotformConnectionCard: ConnectionCardDescriptor = {
  id: 'jotform',
  labelKey: 'connectors.jotform',
  displayName: 'Jotform',
  placement: 'connections',
  order: 100,
  render,
  isConnected: jotformIsConnected,
};
