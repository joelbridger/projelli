import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAppSurfaceDescriptor,
} from '@/app/shell/registry/appSurfaceRegistry';
import type { AppSurfaceRuntime } from '@/app/shell/runtime/AppSurfaceRuntime';

// Coordinator-authorized shared-shell integration proof: it exercises the
// existing descriptor swap without reaching into Home implementation files.
const { useFlagMock } = vi.hoisted(() => ({
  useFlagMock: vi.fn<() => boolean>(),
}));

vi.mock('@/platform/flags', () => ({
  useFlag: useFlagMock,
}));

function runtimeWithLegacy(
  legacyHome: () => ReactNode
): AppSurfaceRuntime {
  return {
    legacy: { home: legacyHome },
    navigation: { setSurface: vi.fn() },
    settings: { open: vi.fn() },
    workspace: { activeMatter: null, rootPath: '/workspace' },
  } as unknown as AppSurfaceRuntime;
}

function homeDescriptor() {
  const descriptor = getAppSurfaceDescriptor('home');
  if (!descriptor) throw new Error('Home descriptor is missing');
  return descriptor;
}

describe('existing Home surface descriptor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the unchanged legacy Home reachable when home-surface-v1 is off', () => {
    useFlagMock.mockReturnValue(false);
    const legacyHome = vi.fn(() => <div data-testid="legacy-home-descriptor" />);

    render(homeDescriptor().render(runtimeWithLegacy(legacyHome)));

    expect(screen.getByTestId('legacy-home-descriptor')).toBeInTheDocument();
    expect(screen.queryByTestId('home-v1-surface')).not.toBeInTheDocument();
  });

  it('uses the same Home descriptor to render the v1 Home when home-surface-v1 is on', () => {
    useFlagMock.mockReturnValue(true);
    const legacyHome = vi.fn(() => <div data-testid="legacy-home-descriptor" />);

    render(homeDescriptor().render(runtimeWithLegacy(legacyHome)));

    expect(screen.getByTestId('home-v1-surface')).toBeInTheDocument();
    expect(legacyHome).not.toHaveBeenCalled();
  });
});
