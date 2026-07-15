import { addeparConnectionCard } from '@/platform/connectors/addepar/accountConnectionCard';
import { createElement } from 'react';
import { boxConnectionCard } from '@/platform/connectors/box/accountConnectionCard';
import { calendarConnectionCard } from '@/platform/connectors/calendar/accountConnectionCard';
import { calendlyConnectionCard } from '@/platform/connectors/calendly/accountConnectionCard';
import { redtailConnectionCard } from '@/platform/connectors/crm/redtailAccountConnectionCard';
import { salesforceConnectionCard } from '@/platform/connectors/crm/salesforceAccountConnectionCard';
import { wealthboxConnectionCard } from '@/platform/connectors/crm/wealthboxAccountConnectionCard';
import { docusignConnectionCard } from '@/platform/connectors/docusign/accountConnectionCard';
import { gmailConnectionCard } from '@/platform/connectors/email/gmailAccountConnectionCard';
import { imapConnectionCard } from '@/platform/connectors/email/imapAccountConnectionCard';
import { microsoft365ConnectionCard } from '@/platform/connectors/email/microsoft365AccountConnectionCard';
import { jotformConnectionCard } from '@/platform/connectors/jotform/accountConnectionCard';
import { oneDriveConnectionCard } from '@/platform/connectors/onedrive/accountConnectionCard';
import { shareFileConnectionCard } from '@/platform/connectors/sharefile/accountConnectionCard';
import { zocksConnectionCard } from '@/platform/connectors/zocks/accountConnectionCard';
import { McpSettingsSection, OllamaSettingsSection } from '@/features/settings';
import type {
  ConnectionCardDescriptor,
  ConnectionCardPlacement,
} from './accountRegistryTypes';

/** The only Account mount list for connector cards. Existing order is stable. */
export const connectionCardRegistry: readonly ConnectionCardDescriptor[] = [
  microsoft365ConnectionCard,
  imapConnectionCard,
  gmailConnectionCard,
  oneDriveConnectionCard,
  boxConnectionCard,
  wealthboxConnectionCard,
  addeparConnectionCard,
  docusignConnectionCard,
  shareFileConnectionCard,
  jotformConnectionCard,
  zocksConnectionCard,
  calendlyConnectionCard,
  calendarConnectionCard,
  salesforceConnectionCard,
  redtailConnectionCard,
  {
    id: 'ollama',
    labelKey: 'connectors.ollama',
    placement: 'connections',
    order: 160,
    render: () => createElement(OllamaSettingsSection),
    renderStatus: () => createElement(OllamaSettingsSection),
    renderSafeDisconnect: () => createElement(OllamaSettingsSection),
  },
  {
    id: 'mcp',
    labelKey: 'connectors.mcp',
    placement: 'developer-tools',
    order: 10,
    render: () => createElement(McpSettingsSection),
    renderStatus: () => createElement(McpSettingsSection),
    renderSafeDisconnect: () => createElement(McpSettingsSection),
  },
];

export function validateConnectionCardDescriptors(
  descriptors: readonly ConnectionCardDescriptor[]
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new Error(
        `[connectionCardRegistry] duplicate card id: ${descriptor.id}`
      );
    }
    ids.add(descriptor.id);
    if (!descriptor.labelKey.includes('.')) {
      throw new Error(
        `[connectionCardRegistry] labelKey must include a namespace: ${descriptor.id}`
      );
    }
  }
}

export function getConnectionCardDescriptors(
  placement: ConnectionCardPlacement,
  descriptors: readonly ConnectionCardDescriptor[] = connectionCardRegistry
): readonly ConnectionCardDescriptor[] {
  validateConnectionCardDescriptors(descriptors);
  return descriptors
    .filter((descriptor) => descriptor.placement === placement)
    .slice()
    .sort((a, b) => a.order - b.order);
}
