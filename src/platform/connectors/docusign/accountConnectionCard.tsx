import { DocuSignConnect } from './DocuSignConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    docusign: true;
  }
}
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
