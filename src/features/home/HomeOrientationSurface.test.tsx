import '@/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeOrientationSurface } from './HomeOrientationSurface';
import type { HomeSurfaceRuntime } from './types';

function runtimeFor(
  rootPath: string | null | undefined,
  activeMatter: HomeSurfaceRuntime['workspace']['activeMatter'] = null
) {
  const setSurface = vi.fn();
  const openSettings = vi.fn();
  const runtime = {
    workspace: { rootPath, activeMatter },
    navigation: { setSurface },
    settings: { open: openSettings },
  } as HomeSurfaceRuntime;
  return { runtime, setSurface, openSettings };
}

describe('HomeOrientationSurface', () => {
  it('has a stable loading state before the workspace state is known', () => {
    const { runtime } = runtimeFor(undefined);
    render(<HomeOrientationSurface runtime={runtime} />);

    expect(screen.getByTestId('home-v1-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('home-v1-surface')).not.toBeInTheDocument();
  });

  it('has a stable empty state and opens the existing workspace settings doorway', () => {
    const { runtime, openSettings } = runtimeFor(null);
    render(<HomeOrientationSurface runtime={runtime} />);

    fireEvent.click(screen.getByTestId('home-v1-open-workspace-settings'));

    expect(screen.getByTestId('home-v1-empty')).toBeInTheDocument();
    expect(openSettings).toHaveBeenCalledWith('workspace');
  });

  it('orients a ready workspace and uses shell navigation doorways', () => {
    const { runtime, setSurface } = runtimeFor('/workspace', {
      id: 'foster-household',
      name: 'Foster household',
    } as HomeSurfaceRuntime['workspace']['activeMatter']);
    render(<HomeOrientationSurface runtime={runtime} />);

    expect(screen.getByTestId('home-v1-surface')).toBeInTheDocument();
    expect(screen.getByTestId('home-v1-current-client')).toHaveTextContent(
      'Foster household'
    );
    fireEvent.click(screen.getByTestId('home-v1-open-clients'));
    fireEvent.click(screen.getByTestId('home-v1-open-ask'));
    fireEvent.click(screen.getByTestId('home-v1-open-scheduling'));

    expect(setSurface).toHaveBeenNthCalledWith(1, 'matters');
    expect(setSurface).toHaveBeenNthCalledWith(2, 'search');
    expect(setSurface).toHaveBeenNthCalledWith(3, 'scheduling');
  });
});
