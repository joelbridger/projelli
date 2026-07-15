import { MailImapConnect } from './MailImapConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
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
