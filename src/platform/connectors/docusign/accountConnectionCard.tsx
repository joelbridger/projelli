import { DocuSignConnect } from './DocuSignConnect';
import type { ConnectionCardDescriptor } from '@/platform/types/account';
import { docusignIsConnected } from '@/platform/utils/docusign-commands';
declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    docusign: true;
  }
}
const render = () => <DocuSignConnect />;
export const docusignConnectionCard: ConnectionCardDescriptor = {
  id: 'docusign',
  labelKey: 'connectors.docusign',
  displayName: 'DocuSign',
  placement: 'connections',
  order: 80,
  render,
  isConnected: docusignIsConnected,
};
