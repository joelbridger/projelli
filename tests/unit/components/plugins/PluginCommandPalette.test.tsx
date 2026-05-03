// Component test — CommandPalette rendering plugin commands with their
// owning plugin name as context. Shape mirrors how App.tsx synthesizes
// `PaletteCommand` objects from `pluginRegistryStore.commands` plus
// `pluginManagerStore.installedPlugins`.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { CommandPalette, type PaletteCommand } from '@/components/common/CommandPalette';

afterEach(() => {
  cleanup();
});

describe('CommandPalette with plugin commands', () => {
  it('surfaces a plugin command with the plugin name as description', () => {
    const action = vi.fn();
    const commands: PaletteCommand[] = [
      {
        id: 'plugin:word-counter:word-counter.count',
        label: 'Count words',
        description: 'Word Counter',
        category: 'Plugins',
        action,
      },
    ];
    render(
      <CommandPalette open onOpenChange={() => undefined} commands={commands} />,
    );
    expect(screen.getByText('Count words')).toBeInTheDocument();
    // The plugin name surfaces as the row's description (context label).
    expect(screen.getByText('Word Counter')).toBeInTheDocument();
    // Category renders as an uppercased section heading; React Testing
    // Library normalizes case in `getByText` matchers via regex.
    expect(screen.getByText(/plugins/i)).toBeInTheDocument();
  });

  it('invokes the command action when the row is clicked', () => {
    const action = vi.fn();
    const commands: PaletteCommand[] = [
      {
        id: 'plugin:word-counter:word-counter.count',
        label: 'Count words',
        description: 'Word Counter',
        category: 'Plugins',
        action,
      },
    ];
    render(
      <CommandPalette open onOpenChange={() => undefined} commands={commands} />,
    );
    fireEvent.click(screen.getByText('Count words'));
    expect(action).toHaveBeenCalledTimes(1);
  });
});
