import { useEffect, useState } from 'react';
import {
  getAppSurfaceDescriptors,
  hasLazyAppSurfaceRegistrations,
  resolveAppSurfaceRegistry,
} from '@/app/shell/registry/appSurfaceRegistry';
import type { AppSurfaceDescriptor } from '@/app/shell/registry/types';

export interface AppSurfaceRegistryState {
  descriptors: readonly AppSurfaceDescriptor[];
  ready: boolean;
  error: Error | null;
}

export function useAppSurfaceRegistry(): AppSurfaceRegistryState {
  const [state, setState] = useState<AppSurfaceRegistryState>(() => ({
    descriptors: getAppSurfaceDescriptors(),
    ready: !hasLazyAppSurfaceRegistrations(),
    error: null,
  }));

  useEffect(() => {
    if (state.ready) return;
    let active = true;
    void resolveAppSurfaceRegistry().then(
      (descriptors) => {
        if (active) setState({ descriptors, ready: true, error: null });
      },
      (reason: unknown) => {
        if (!active) return;
        setState({
          descriptors: getAppSurfaceDescriptors(),
          ready: true,
          error:
            reason instanceof Error
              ? reason
              : new Error('Could not load the app surface registry'),
        });
      }
    );
    return () => {
      active = false;
    };
  }, [state.ready]);

  return state;
}
