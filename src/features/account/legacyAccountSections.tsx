import { LicenseSettings } from '@/features/settings';
import { CostMetrics } from '@/platform/analysis/ui/CostMetrics';
import {
  ConnectionsSection,
  FirmSection,
} from './legacyAccountSectionRenderers';
import type { AccountSectionDescriptor } from './accountRegistryTypes';

declare module '@/platform/types/account' {
  interface AccountSectionIdMap {
    account: true;
    firm: true;
    usage: true;
    connections: true;
  }
}

export const legacyAccountSections: readonly AccountSectionDescriptor[] = [
  {
    id: 'account',
    labelKey: 'account.sections.account',
    legacyLabel: 'Account',
    placement: 'tab',
    order: 10,
    render: () => <LicenseSettings />,
  },
  {
    id: 'firm',
    labelKey: 'account.sections.firm',
    legacyLabel: 'Firm',
    placement: 'tab',
    order: 20,
    render: () => <FirmSection />,
  },
  {
    id: 'usage',
    labelKey: 'account.sections.usage',
    legacyLabel: 'Usage',
    placement: 'tab',
    order: 30,
    render: ({ auditEntries }) => <CostMetrics entries={auditEntries ?? []} />,
  },
  {
    id: 'connections',
    labelKey: 'account.sections.connections',
    legacyLabel: 'Connections',
    placement: 'tab',
    order: 40,
    render: () => <ConnectionsSection />,
  },
];
