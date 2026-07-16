import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeSurfaceFlagGate, type HomeSurfaceRuntime } from '@/features/home';
import type { PlatformFlagsMockState } from '@/testing/platform-flags';

const { mockPlatformFlags, resetPlatformFlagsOverrides, setPlatformFlagsOverrides } =
  await vi.hoisted(async () => import('@/testing/platform-flags'));

const { flagsMock, useFlagMock } = vi.hoisted(() => {
  const useFlagMock = vi.fn<() => boolean>();
  return {
    flagsMock: { overrides: { useFlag: useFlagMock } } as PlatformFlagsMockState,
    useFlagMock,
  };
});

vi.mock('@/platform/flags', async (importOriginal) =>
  mockPlatformFlags(importOriginal, flagsMock)
);

function runtime(): HomeSurfaceRuntime {
  return {
    navigation: { setSurface: vi.fn() },
    settings: { open: vi.fn() },
    workspace: { activeMatter: null, rootPath: '/workspace' },
  };
}

describe('HomeSurfaceFlagGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPlatformFlagsOverrides(flagsMock);
    setPlatformFlagsOverrides(flagsMock, { useFlag: useFlagMock });
  });

  it('uses the legacy renderer and mounts no v1 data child while the flag is off', () => {
    useFlagMock.mockReturnValue(false);
    const legacyHome = vi.fn(() => <div data-testid="legacy-home" />);

    render(
      <HomeSurfaceFlagGate runtime={runtime()} renderLegacy={legacyHome} />
    );

    expect(legacyHome).toHaveBeenCalledOnce();
    expect(screen.getByTestId('legacy-home')).toBeInTheDocument();
    expect(screen.queryByTestId('home-v1-surface')).not.toBeInTheDocument();
  });

  it('mounts the v1 child while the flag is on', () => {
    useFlagMock.mockReturnValue(true);
    const legacyHome = vi.fn(() => <div data-testid="legacy-home" />);

    render(
      <HomeSurfaceFlagGate runtime={runtime()} renderLegacy={legacyHome} />
    );

    expect(screen.getByTestId('home-v1-surface')).toBeInTheDocument();
    expect(legacyHome).not.toHaveBeenCalled();
  });
});
