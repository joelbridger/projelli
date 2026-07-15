import { MailGmailConnect } from './MailGmailConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
const render = () => <MailGmailConnect />;
export const gmailConnectionCard: ConnectionCardDescriptor = {
  id: 'gmail-mail',
  labelKey: 'connectors.gmail',
  placement: 'connections',
  order: 30,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
