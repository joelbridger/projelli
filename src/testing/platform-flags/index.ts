/**
 * The supported open-world mock plumbing for @/platform/flags tests.
 *
 * Keep the state in vi.hoisted() in the consumer, then pass it through this
 * factory from that file's one vi.mock() call. The factory always begins with
 * the real public module, so a new public export is never accidentally hidden
 * by an old test mock.
 */
export type PlatformFlagsModule = typeof import('@/platform/flags');
export type PlatformFlagsOverrides = {
  [Export in keyof PlatformFlagsModule]?: PlatformFlagsModule[Export] | undefined;
};

export interface PlatformFlagsMockState {
  /**
   * Declare every export this file may override with `undefined` in its
   * vi.hoisted state. The factory installs stable forwarding functions for
   * those keys, so per-test setup can safely change their implementation.
   */
  overrides: PlatformFlagsOverrides;
}

type ImportOriginal = () => Promise<PlatformFlagsModule>;

/** Configure exactly the public flag exports a test needs to replace. */
export function setPlatformFlagsOverrides(
  state: PlatformFlagsMockState,
  overrides: PlatformFlagsOverrides
): void {
  for (const [key, override] of Object.entries(overrides)) {
    if (!Object.hasOwn(state.overrides, key)) {
      throw new Error(
        `Declare ${key} as undefined in PlatformFlagsMockState before configuring it.`
      );
    }
    (state.overrides as Record<string, unknown>)[key] = override;
  }
}

/** Restore the empty override state during test cleanup. */
export function resetPlatformFlagsOverrides(
  state: PlatformFlagsMockState
): void {
  for (const key of Object.keys(state.overrides)) {
    (state.overrides as Record<string, unknown>)[key] = undefined;
  }
}

/**
 * Canonical Vitest factory body: preserve every real public export first, then
 * apply this test's intentional overrides.
 */
export async function mockPlatformFlags(
  importOriginal: ImportOriginal,
  state: PlatformFlagsMockState
): Promise<PlatformFlagsModule> {
  const original = await importOriginal();
  const mocked = { ...original } as Record<string, unknown>;

  for (const key of Object.keys(state.overrides)) {
    const originalExport = mocked[key];
    if (typeof originalExport !== 'function') {
      throw new Error(
        `PlatformFlagsMockState may only override callable public exports; ${key} is not callable.`
      );
    }
    mocked[key] = (...args: unknown[]) => {
      const override = (state.overrides as Record<string, unknown>)[key];
      return typeof override === 'function'
        ? (Reflect.apply(override, undefined, args) as unknown)
        : (Reflect.apply(originalExport, undefined, args) as unknown);
    };
  }

  return mocked as PlatformFlagsModule;
}
