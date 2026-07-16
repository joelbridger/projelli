import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeSurfaceFlagGate } from './HomeSurfaceFlagGate';
import type { HomeSurfaceRuntime } from './types';

const { mountV1DataSurface, useFlagMock } = vi.hoisted(() => ({
  mountV1DataSurface: vi.fn(),
  useFlagMock: vi.fn<() => boolean>(),
}));

vi.mock('@/platform/flags', () => ({
  useFlag: useFlagMock,
}));

vi.mock('./HomeOrientationSurface', () => ({
  HomeOrientationSurface: () => {
    mountV1DataSurface();
    return <div data-testid="home-v1-data-surface" />;
  },
}));

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
  });

  it('uses the legacy renderer and mounts no v1 data child while the flag is off', () => {
    useFlagMock.mockReturnValue(false);
    const legacyHome = vi.fn(() => <div data-testid="legacy-home" />);

    render(
      <HomeSurfaceFlagGate
        runtime={runtime()}
        renderLegacy={legacyHome}
      />
    );

    expect(legacyHome).toHaveBeenCalledOnce();
    expect(screen.getByTestId('legacy-home')).toBeInTheDocument();
    expect(screen.queryByTestId('home-v1-data-surface')).not.toBeInTheDocument();
    expect(mountV1DataSurface).not.toHaveBeenCalled();
  });

  it('mounts the v1 child while the flag is on', () => {
    useFlagMock.mockReturnValue(true);
    const legacyHome = vi.fn(() => <div data-testid="legacy-home" />);

    render(
      <HomeSurfaceFlagGate
        runtime={runtime()}
        renderLegacy={legacyHome}
      />
    );

    expect(screen.getByTestId('home-v1-data-surface')).toBeInTheDocument();
    expect(mountV1DataSurface).toHaveBeenCalledOnce();
    expect(legacyHome).not.toHaveBeenCalled();
  });
});
