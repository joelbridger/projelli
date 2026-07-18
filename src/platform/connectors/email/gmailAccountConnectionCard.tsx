import { MailGmailConnect } from './MailGmailConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { gmailIsConnected } from '@/platform/utils/mail-commands';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    'gmail-mail': true;
  }
}
const render = () => <MailGmailConnect />;
export const gmailConnectionCard: ConnectionCardDescriptor = {
  id: 'gmail-mail',
  labelKey: 'connectors.gmail',
  displayName: 'Gmail',
  placement: 'connections',
  order: 30,
  render,
  isConnected: gmailIsConnected,
};
