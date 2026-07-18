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
import { detectOllama } from '@/platform/providers/OllamaProvider';
import type {
  ConnectionCardDescriptor,
  ConnectionCardPlacement,
} from '@/platform/types/account';

declare module '@/platform/types/account' {
  interface ConnectionCardIdMap {
    ollama: true;
    mcp: true;
  }
}

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
    displayName: 'Ollama',
    placement: 'connections',
    order: 160,
    render: () => createElement(OllamaSettingsSection),
    isConnected: async () => (await detectOllama()).reachable,
  },
  {
    id: 'mcp',
    labelKey: 'connectors.mcp',
    displayName: 'MCP servers',
    placement: 'developer-tools',
    order: 10,
    render: () => createElement(McpSettingsSection),
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
    if (descriptor.displayName.trim().length === 0) {
      throw new Error(
        `[connectionCardRegistry] displayName must not be empty: ${descriptor.id}`
      );
    }
    if (
      descriptor.placement === 'connections' &&
      typeof descriptor.isConnected !== 'function'
    ) {
      throw new Error(
        `[connectionCardRegistry] connection proof is required: ${descriptor.id}`
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
