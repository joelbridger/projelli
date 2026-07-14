import { describe, expect, it, vi } from 'vitest';
import { createFlagRouter, DEV_OVERRIDE_STORAGE_KEY } from './router';
import type { FlagDescriptor } from './registry';

const flags = [
  {
    id: 'new-client-map',
    description: 'test',
    ownerLane: 'P0-T',
    createdAt: '2026-07-14',
    expiresAt: '2026-08-14',
    defaultEnabled: false,
  },
] as const satisfies readonly FlagDescriptor[];

describe('flag router', () => {
  it('is dark by default, including the all-pending-off fallback', () => {
    const router = createFlagRouter({
      registry: flags,
      environment: {},
      isDevelopment: false,
    });
    expect(router.isEnabled('new-client-map')).toBe(false);
  });

  it('honors a production build environment value', () => {
    const router = createFlagRouter({
      registry: flags,
      environment: { VITE_FLAG_NEW_CLIENT_MAP: 'true' },
      isDevelopment: false,
    });
    expect(router.isEnabled('new-client-map')).toBe(true);
  });

  it('uses local development overrides and notifies subscribers', () => {
    const storage = window.localStorage;
    storage.clear();
    const router = createFlagRouter({
      registry: flags,
      environment: {},
      isDevelopment: true,
      storage,
    });
    const listener = vi.fn();
    router.subscribe(listener);
    expect(router.isEnabled('new-client-map')).toBe(false);
    router.setDevOverride('new-client-map', true);
    expect(router.isEnabled('new-client-map')).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(
      JSON.parse(storage.getItem(DEV_OVERRIDE_STORAGE_KEY) ?? '{}')
    ).toEqual({ 'new-client-map': true });
  });

  it('ignores local overrides outside development', () => {
    const storage = window.localStorage;
    storage.setItem(
      DEV_OVERRIDE_STORAGE_KEY,
      JSON.stringify({ 'new-client-map': true })
    );
    const router = createFlagRouter({
      registry: flags,
      environment: {},
      isDevelopment: false,
      storage,
    });
    expect(router.getOverride('new-client-map')).toBeUndefined();
    expect(router.isEnabled('new-client-map')).toBe(false);
  });
});
