import { CalendlyConnect } from './CalendlyConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { calendlyIsConnected } from '@/platform/utils/calendly-commands';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    calendly: true;
  }
}
const render = () => <CalendlyConnect />;
export const calendlyConnectionCard: ConnectionCardDescriptor = {
  id: 'calendly',
  labelKey: 'connectors.calendly',
  displayName: 'Calendly',
  placement: 'connections',
  order: 120,
  render,
  isConnected: calendlyIsConnected,
};
