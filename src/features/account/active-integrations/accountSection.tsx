import { createElement } from 'react';
import { isEnabled } from '@/platform/flags';
import type { AccountSectionDescriptor } from '@/features/account';
import { ActiveIntegrationsSection } from './ActiveIntegrationsSection';

declare module '@/platform/types/account' {
  interface AccountSectionIdMap {
    'active-integrations': true;
  }
}

export const activeIntegrationsAccountSection: AccountSectionDescriptor = {
  id: 'active-integrations',
  labelKey: 'active-integrations.title',
  legacyLabel: 'Integrations',
  placement: 'tab',
  order: 50,
  render: () => createElement(ActiveIntegrationsSection),
};

/** The Account host receives no descriptor while this feature is dark. */
export function getActiveIntegrationsAccountSections(): readonly AccountSectionDescriptor[] {
  return isEnabled('active-integrations')
    ? [activeIntegrationsAccountSection]
    : [];
}
