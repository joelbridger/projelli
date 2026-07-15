import { DocuSignConnect } from './DocuSignConnect';
import type { ConnectionCardDescriptor } from '@/features/account/accountRegistryTypes';
const render = () => <DocuSignConnect />;
export const docusignConnectionCard: ConnectionCardDescriptor = {
  id: 'docusign',
  labelKey: 'connectors.docusign',
  placement: 'connections',
  order: 80,
  render,
  renderStatus: render,
  renderSafeDisconnect: render,
};
