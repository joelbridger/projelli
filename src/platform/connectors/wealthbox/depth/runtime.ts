import type { WealthboxAskSource } from './types';

/** A small bridge so the app shell can supply its Ask indexer without this
 * connector importing a feature-layer module. */
export interface WealthboxDepthRuntime {
  ingestAskSources: (sources: readonly WealthboxAskSource[]) => Promise<void>;
}

let runtime: WealthboxDepthRuntime | null = null;

export function mountWealthboxDepth(nextRuntime: WealthboxDepthRuntime): void {
  runtime = nextRuntime;
}

export async function ingestWealthboxCustomFieldsForAsk(sources: readonly WealthboxAskSource[]): Promise<void> {
  if (!runtime) {
    throw new Error('Wealthbox depth is not mounted.');
  }
  await runtime.ingestAskSources(sources);
}
