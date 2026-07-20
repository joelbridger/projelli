import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDevFlagOverride } from '@/platform/flags/router';
import type { RehydratedSelectionInput } from '@/platform/client-context/selectionTypes';

/**
 * Module-initialisation regression for the selection-authority boot gate.
 *
 * The bug: with the flag ON, a returning user's persisted matter data makes
 * `matterStore` hydrate during its own module evaluation and QUEUE a selection
 * rehydration through the retired-writer bridge (`rehydrateSelectionFromData`,
 * before `clientContextStore` has loaded so no handler is registered yet).
 * When `clientContextStore` then evaluates, its top-level
 * `registerSelectionWriterBridge(...)` FLUSHES that queued rehydration
 * synchronously — and the flush read `useClientContextStore` while that `const`
 * was still in the temporal dead zone (declared at the bottom of the file,
 * below the registration). Result: `Cannot access 'useClientContextStore'
 * before initialization` at boot, in the dev server AND the production bundle,
 * for any returning user booting with the flag on.
 *
 * This test reproduces that exact seam deterministically: it queues a
 * rehydration through a freshly-imported bridge (standing in for matterStore's
 * persist hydration), then imports the client-context barrel so its
 * registration flushes the queue during module evaluation. It FAILS at the
 * buggy base (the barrel import rejects with the TDZ ReferenceError) and passes
 * once the `useClientContextStore` declaration is hoisted above the
 * registration. The flag is set EXPLICITLY through `setDevFlagOverride`
 * (persisted to storage, read by the freshly-imported router) — never ambient.
 */

const PHANTOM_HINT: RehydratedSelectionInput = {
  kind: 'persisted-hint',
  value: {
    version: 1,
    source: 'specific-matter',
    matterId: 'matter-phantom-not-live',
  },
};

/**
 * Boot the real module graph fresh with a rehydration already queued through
 * the retired-writer bridge — the state matterStore leaves for a returning
 * user before the client-context store loads.
 *
 * Order is load-bearing and mirrors production: the bridge is imported and the
 * rehydration queued (no handler yet) BEFORE the client-context barrel, whose
 * `registerSelectionWriterBridge` flushes the queue during evaluation.
 */
async function bootWithQueuedRehydration(
  flag: boolean,
  input: RehydratedSelectionInput
) {
  setDevFlagOverride('selection-authority-boot-gate', flag);
  vi.resetModules();
  const bridge = await import('@/platform/client-context/selectionWriterBridge');
  // Flag ON => queues (no handler registered yet). Flag OFF => inert no-op.
  bridge.rehydrateSelectionFromData(input);
  // Loading the barrel evaluates clientContextStore, whose top-level bridge
  // registration flushes any queued rehydration. At the buggy base this throws
  // the TDZ ReferenceError here.
  return import('@/platform/client-context');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  setDevFlagOverride('selection-authority-boot-gate', undefined);
  localStorage.clear();
  vi.resetModules();
});

describe('boot gate module initialisation (TDZ regression)', () => {
  it('(a) boots without a temporal-dead-zone error when a rehydration is queued and the flag is on at module init', async () => {
    // At the buggy base this import REJECTS with
    // "Cannot access 'useClientContextStore' before initialization".
    const barrel = await bootWithQueuedRehydration(true, {
      kind: 'legacy-follower',
      activeMatterId: null,
    });

    // The store is usable and the queued rehydration was consumed at boot (null
    // follower => safe All-matters) — proving the boot path RAN, not merely
    // "no throw".
    expect(typeof barrel.useClientContextStore.getState).toBe('function');
    expect(barrel.useClientContextStore.getState().scope).toEqual({
      kind: 'all-matters',
    });
  });

  it('(b) fail-closed: a queued persisted specific-matter hint with no live matter boots to BLOCKED, never the phantom selection, routed through the retired-writer bridge', async () => {
    // The persisted hint names a matter that is not live (empty matter store).
    const barrel = await bootWithQueuedRehydration(true, PHANTOM_HINT);

    // The bridge flush consumed the persisted hint at boot (the only path from
    // persisted data into the store when the flag is on). Because the matter is
    // not live, the classifier fails closed to blocked-unresolved (BLOCKED): it
    // never silently selects the phantom matter or proceeds with a bogus id.
    expect(barrel.useClientContextStore.getState().scope).toEqual({
      kind: 'blocked-unresolved',
    });
    expect(barrel.readAuthoritativeMatterScope()).toEqual({
      kind: 'blocked-unresolved',
    });
  });

  it('(c) flag-OFF control: the same queued input leaves the dark path untouched — no throw, no rehydrated selection', async () => {
    const barrel = await bootWithQueuedRehydration(false, PHANTOM_HINT);

    // Dark: rehydrateSelectionFromData is inert when the flag is off, so nothing
    // is queued or consumed; the store keeps its inert All-matters boot scope
    // and there is no phantom selection.
    expect(barrel.useClientContextStore.getState().scope).toEqual({
      kind: 'all-matters',
    });
    expect(barrel.readAuthoritativeMatterScope()).toEqual({ kind: 'all-matters' });
  });
});
