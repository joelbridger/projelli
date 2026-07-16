import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAppSurfaceDescriptor,
} from '@/app/shell/registry/appSurfaceRegistry';
import type { AppSurfaceRuntime } from '@/app/shell/runtime/AppSurfaceRuntime';

const { renderV1Home, useFlagMock } = vi.hoisted(() => ({
  renderV1Home: vi.fn(),
  useFlagMock: vi.fn<() => boolean>(),
}));

vi.mock('@/platform/flags', () => ({
  useFlag: useFlagMock,
}));

vi.mock('@/features/home/HomeOrientationSurface', () => ({
  HomeOrientationSurface: () => {
    renderV1Home();
    return <div data-testid="home-v1-descriptor-child" />;
  },
}));

function runtimeWithLegacy(
  legacyHome: () => ReactNode
): AppSurfaceRuntime {
  return {
    legacy: { home: legacyHome },
  } as AppSurfaceRuntime;
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
    expect(renderV1Home).not.toHaveBeenCalled();
  });

  it('uses the same Home descriptor to render the v1 Home when home-surface-v1 is on', () => {
    useFlagMock.mockReturnValue(true);
    const legacyHome = vi.fn(() => <div data-testid="legacy-home-descriptor" />);

    render(homeDescriptor().render(runtimeWithLegacy(legacyHome)));

    expect(screen.getByTestId('home-v1-descriptor-child')).toBeInTheDocument();
    expect(renderV1Home).toHaveBeenCalledOnce();
    expect(legacyHome).not.toHaveBeenCalled();
  });
});
