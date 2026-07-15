import { JotformConnect } from './JotformConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    jotform: true;
  }
}
const render = () => <JotformConnect />;
export const jotformConnectionCard: ConnectionCardDescriptor = {
  id: 'jotform',
  labelKey: 'connectors.jotform',
  placement: 'connections',
  order: 100,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
