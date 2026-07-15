import { MailImapConnect } from './MailImapConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    'imap-mail': true;
  }
}
const render = () => <MailImapConnect />;
export const imapConnectionCard: ConnectionCardDescriptor = {
  id: 'imap-mail',
  labelKey: 'connectors.imap',
  placement: 'connections',
  order: 20,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
