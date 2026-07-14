import { useEffect, useState } from 'react';
import {
  getCommandDescriptors,
  hasLazyCommandRegistrations,
  resolveCommandRegistry,
} from '@/app/commands/registry/commandRegistry';
import type { CommandDescriptor } from '@/app/commands/registry/types';

export interface CommandRegistryState {
  descriptors: readonly CommandDescriptor[];
  ready: boolean;
  error: Error | null;
}

export function useCommandRegistry(): CommandRegistryState {
  const [state, setState] = useState<CommandRegistryState>(() => ({
    descriptors: getCommandDescriptors(),
    ready: !hasLazyCommandRegistrations(),
    error: null,
  }));

  useEffect(() => {
    if (state.ready) return;
    let active = true;
    void resolveCommandRegistry().then(
      (descriptors) => {
        if (active) setState({ descriptors, ready: true, error: null });
      },
      (reason: unknown) => {
        if (!active) return;
        setState({
          descriptors: getCommandDescriptors(),
          ready: true,
          error:
            reason instanceof Error
              ? reason
              : new Error('Could not load the command registry'),
        });
      }
    );
    return () => {
      active = false;
    };
  }, [state.ready]);

  return state;
}
