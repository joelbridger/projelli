// Tests for Wave3HostRouter.
//
// Coverage:
//  - register adds a host; dispatch routes by handlesMethod
//  - first registered host with handlesMethod=true wins
//  - throws not-found when no host claims the method
//  - setHosts replaces the registered set
//  - dispatch returns sync host result without wrapping
//  - dispatch awaits async host result

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  Wave3HostRouter,
  Wave3RouterError,
  type PluginDispatchHost,
} from '@/modules/plugins/hosts/Wave3HostRouter';

let router: Wave3HostRouter;

beforeEach(() => {
  router = new Wave3HostRouter();
});

function host(methods: string[], handler: (m: string) => unknown): PluginDispatchHost {
  return {
    handlesMethod: (m) => methods.includes(m),
    handle: vi.fn(({ method }) => handler(method)),
  };
}

describe('Wave3HostRouter', () => {
  it('routes a call to the host whose handlesMethod returns true', async () => {
    const a = host(['storage.get'], () => 'A-result');
    const b = host(['network.fetch'], () => 'B-result');
    router.register(a);
    router.register(b);
    expect(await router.dispatch({ pluginId: 'p', method: 'network.fetch', args: [] })).toBe('B-result');
    expect(await router.dispatch({ pluginId: 'p', method: 'storage.get', args: ['k'] })).toBe('A-result');
  });

  it('first registered host with handlesMethod=true wins', async () => {
    const first = host(['x'], () => 'first');
    const second = host(['x'], () => 'second');
    router.register(first);
    router.register(second);
    expect(await router.dispatch({ pluginId: 'p', method: 'x', args: [] })).toBe('first');
  });

  it('throws not-found when no host claims the method', async () => {
    router.register(host(['storage.get'], () => 'A'));
    await expect(
      router.dispatch({ pluginId: 'p', method: 'mystery', args: [] }),
    ).rejects.toThrow(Wave3RouterError);
    await expect(
      router.dispatch({ pluginId: 'p', method: 'mystery', args: [] }),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('setHosts replaces the registered set', async () => {
    router.register(host(['old'], () => 'old'));
    router.setHosts([host(['new'], () => 'new')]);
    await expect(router.dispatch({ pluginId: 'p', method: 'old', args: [] })).rejects.toThrow();
    expect(await router.dispatch({ pluginId: 'p', method: 'new', args: [] })).toBe('new');
  });

  it('awaits async host results', async () => {
    router.register({
      handlesMethod: (m) => m === 'async',
      handle: async () => {
        await new Promise((r) => setTimeout(r, 1));
        return 'async-done';
      },
    });
    expect(await router.dispatch({ pluginId: 'p', method: 'async', args: [] })).toBe('async-done');
  });

  it('dispatch is bound to the router so it can be passed as a callback', async () => {
    const a = host(['x'], () => 'X');
    router.register(a);
    const fn = router.dispatch;
    expect(await fn({ pluginId: 'p', method: 'x', args: [] })).toBe('X');
  });
});
