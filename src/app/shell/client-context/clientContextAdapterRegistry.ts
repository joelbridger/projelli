import { askSharedClientContextAdapter } from '@/features/ask';
import { crmClientsSharedClientContextAdapter } from '@/features/crm-clients';
import { meetingsSharedClientContextAdapter } from '@/features/meetings';
import type { SharedClientContextAdapter } from '@/platform/client-context';

/**
 * Feature-owned adapters mounted through their public entry points. The shell
 * knows only their ids; each feature owns its derived context behavior.
 */
export const clientContextAdapterRegistry = [
  crmClientsSharedClientContextAdapter,
  askSharedClientContextAdapter,
  meetingsSharedClientContextAdapter,
] as const satisfies readonly SharedClientContextAdapter<unknown>[];

export function validateClientContextAdapters(
  adapters: readonly SharedClientContextAdapter<unknown>[]
): void {
  const ids = new Set<string>();
  for (const adapter of adapters) {
    if (ids.has(adapter.id)) {
      throw new Error(
        `[clientContextAdapterRegistry] duplicate adapter id: ${adapter.id}`
      );
    }
    ids.add(adapter.id);
  }
}

validateClientContextAdapters(clientContextAdapterRegistry);
