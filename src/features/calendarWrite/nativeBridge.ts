/**
 * The seam to the native layer — deferred, and fail-closed until it lands.
 *
 * Two native capabilities complete a live Part B write: the **native consent
 * port** (a write-scope OAuth exchange plus a persisted, capability-bearing
 * grant) and **native provider-write execution** (the actual HTTPS call through
 * the registered egress operation). Both are a coordinator-reserved follow-up.
 * Until they land, this bridge returns "no grant" and a rejecting provider port,
 * so the whole surface fails closed: with no write grant, `prepare` refuses, and
 * nothing ever reaches egress. This is the own-clients-permissions pattern — the
 * renderer doorway is present and proven, the native enforcement/execution is
 * deferred, and the `calendar-write` flag stays dark until it is proven too.
 *
 * The renderer flow itself is fully built and tested against a synthetic
 * provider (see `./bench`); this file is only the production wiring point the
 * native lane fills in.
 */
import type { CalendarGrant } from '@/platform/calendar/writeConsent';
import type { CalendarWriteProviderId } from './types';
import type { CalendarWriteProviderPort } from './providerPort';

/**
 * Load the persisted write grant for a provider from the native store. Deferred:
 * there is no native consent port yet, so there is no write grant, and the
 * surface stays read-only. When the native port lands it will return the grant
 * through `verifyStoredGrant`, never a raw record.
 */
export function loadNativeWriteGrant(
  _provider: CalendarWriteProviderId,
): Promise<CalendarGrant | null> {
  return Promise.resolve(null);
}

/**
 * A provider port that refuses every call. It exists so the orchestrator can be
 * assembled and the flow exercised in the app shell without a native executor;
 * because it fails closed, a mistaken call while the surface is dark makes no
 * network request and produces no confirmation.
 */
export function createDeferredProviderPort(): CalendarWriteProviderPort {
  const refuse = (): Promise<unknown> =>
    Promise.resolve({ transport: 'rejected', reason: 'internal' });
  return { submitWrite: refuse, verifyWrite: refuse };
}
