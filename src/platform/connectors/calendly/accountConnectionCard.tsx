import { CalendlyConnect } from './CalendlyConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    calendly: true;
  }
}
const render = () => <CalendlyConnect />;
export const calendlyConnectionCard: ConnectionCardDescriptor = {
  id: 'calendly',
  labelKey: 'connectors.calendly',
  placement: 'connections',
  order: 120,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
