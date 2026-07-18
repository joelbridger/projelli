import { MailImapConnect } from './MailImapConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { mailImapIsConnected } from '@/platform/utils/mail-commands';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    'imap-mail': true;
  }
}
const render = () => <MailImapConnect />;
export const imapConnectionCard: ConnectionCardDescriptor = {
  id: 'imap-mail',
  labelKey: 'connectors.imap',
  displayName: 'Other email (IMAP)',
  placement: 'connections',
  order: 20,
  render,
  isConnected: mailImapIsConnected,
};
