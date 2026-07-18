import { CalendarConnect } from './CalendarConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { calendarIsConnected } from '@/platform/calendar';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    calendar: true;
  }
}
const render = () => <CalendarConnect />;
const isConnected = async () =>
  (
    await Promise.all(
      (['outlook', 'google', 'ics'] as const).map((provider) =>
        calendarIsConnected(provider)
      )
    )
  ).some(Boolean);
export const calendarConnectionCard: ConnectionCardDescriptor = {
  id: 'calendar',
  labelKey: 'connectors.calendar',
  displayName: 'Calendar',
  placement: 'connections',
  order: 130,
  render,
  isConnected,
};
