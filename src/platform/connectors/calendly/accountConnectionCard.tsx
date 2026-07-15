import { CalendlyConnect } from './CalendlyConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
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
