import { CalendarConnect } from './CalendarConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    calendar: true;
  }
}
const render = () => <CalendarConnect />;
export const calendarConnectionCard: ConnectionCardDescriptor = {
  id: 'calendar',
  labelKey: 'connectors.calendar',
  placement: 'connections',
  order: 130,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
