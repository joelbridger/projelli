import { getMatters } from '@/platform/matter/matterStore';
import {
  buildCrmMatterMap,
  filterCrmMatterMapForProvider,
} from '@/platform/rag/matterResolver';
import {
  createCrmRunId,
  crmIsConnected,
  crmRebuildStore,
  crmSyncAll,
  type CrmProvider,
} from '@/platform/utils/wealthbox-commands';

const CRM_PROVIDERS: readonly CrmProvider[] = [
  'wealthbox',
  'salesforce',
  'redtail',
];

const PROVIDER_LABELS: Record<CrmProvider, string> = {
  wealthbox: 'Wealthbox',
  salesforce: 'Salesforce',
  redtail: 'Redtail',
};

/**
 * Replaces the unreadable shared CRM cache, then refills every connector that
 * is still signed in. Rebuilding only the connector whose button was clicked
 * would leave the other connectors missing from search.
 */
export async function rebuildConnectedCrmImports(): Promise<void> {
  const connectionChecks = await Promise.all(
    CRM_PROVIDERS.map(async (provider) => ({
      provider,
      connected: await crmIsConnected(provider),
    })),
  );
  const connectedProviders = connectionChecks
    .filter(({ connected }) => connected)
    .map(({ provider }) => provider);

  if (connectedProviders.length === 0) {
    throw new Error('Connect a CRM account before rebuilding its local copy.');
  }

  await crmRebuildStore();

  const allMatterMappings = buildCrmMatterMap(getMatters());
  const failures: string[] = [];
  for (const provider of connectedProviders) {
    try {
      await crmSyncAll(
        filterCrmMatterMapForProvider(allMatterMappings, provider),
        createCrmRunId(),
        provider,
      );
    } catch {
      // Keep going. One provider being offline must not stop the other
      // connected providers from restoring their searchable local copies.
      failures.push(PROVIDER_LABELS[provider]);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `The local CRM copy was rebuilt, but ${failures.join(' and ')} could not be re-synced. Use Sync now on ${failures.length === 1 ? 'that connector' : 'those connectors'} to finish.`,
    );
  }
}
