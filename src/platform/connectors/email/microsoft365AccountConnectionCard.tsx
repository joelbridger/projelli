import { MailConnect } from './MailConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { mailIsConnected } from '@/platform/utils/mail-commands';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    'microsoft-365-mail': true;
  }
}
const render = () => <MailConnect />;
export const microsoft365ConnectionCard: ConnectionCardDescriptor = {
  id: 'microsoft-365-mail',
  labelKey: 'connectors.microsoft365',
  displayName: 'Microsoft 365',
  placement: 'connections',
  order: 10,
  render,
  isConnected: mailIsConnected,
};
