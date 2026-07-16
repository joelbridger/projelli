/**
 * The write-provider adapter registry — the appendable surface for adding a
 * provider that can write. Append an adapter here and nothing else in the
 * orchestrator changes; the paved path is `./SKILL.md`.
 *
 * ICS is deliberately absent and can never be added: `CalendarWriteProviderId`
 * excludes it, so an ICS adapter does not type-check. SC-022 keeps the ICS feed
 * read-only, and this registry cannot be the place that changes.
 */
import type { CalendarWriteProviderId } from '../types';
import type { CalendarWriteProviderAdapter } from './types';
import { outlookWriteAdapter } from './outlook';
import { googleWriteAdapter } from './google';

const ADAPTERS: readonly CalendarWriteProviderAdapter[] = [
  outlookWriteAdapter,
  googleWriteAdapter,
];

const BY_PROVIDER: ReadonlyMap<CalendarWriteProviderId, CalendarWriteProviderAdapter> = new Map(
  ADAPTERS.map((adapter) => [adapter.provider, adapter]),
);

/**
 * The adapter for a provider, or `undefined` if none is registered. A caller
 * that gets `undefined` must refuse the write — an unregistered provider has no
 * declared egress operation, so it fails closed.
 */
export function getWriteAdapter(
  provider: CalendarWriteProviderId,
): CalendarWriteProviderAdapter | undefined {
  return BY_PROVIDER.get(provider);
}

/** All registered write adapters (registry order). */
export function listWriteAdapters(): readonly CalendarWriteProviderAdapter[] {
  return ADAPTERS;
}
