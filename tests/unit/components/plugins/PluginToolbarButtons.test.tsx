// Component test — PluginToolbarButtons.
//
// Coverage:
//  - renders nothing when the registry has no toolbar contributions
//  - renders one button per registered toolbar entry
//  - click invokes `manager.invokeCommand(pluginId, command)` exactly once
//  - safe when no manager is set (does not throw)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { PluginToolbarButtons } from '@/components/plugins/PluginToolbarButtons';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';
import {
  setActivePluginManager,
  getActivePluginManager,
} from '@/modules/plugins/pluginManagerHolder';
import type { PluginManager } from '@/modules/plugins/PluginManager';

function resetRegistry() {
  usePluginRegistryStore.setState({
    commands: new Map(),
    toolbar: [],
    sidebar: [],
    settingsPages: [],
  });
}

describe('PluginToolbarButtons', () => {
  beforeEach(() => {
    resetRegistry();
    setActivePluginManager(null);
  });

  afterEach(() => {
    cleanup();
    resetRegistry();
    setActivePluginManager(null);
  });

  it('renders nothing when no plugin toolbar buttons are registered', () => {
    const { container } = render(<PluginToolbarButtons />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one button per registered toolbar entry', () => {
    usePluginRegistryStore.getState().addToolbarButton('word-counter', {
      id: 'wc-button',
      icon: 'hash',
      tooltip: 'Count words',
      command: 'word-counter.count',
    });
    usePluginRegistryStore.getState().addToolbarButton('translator', {
      id: 'tr-button',
      icon: 'languages',
      tooltip: 'Translate selection',
      command: 'translator.translate',
    });

    render(<PluginToolbarButtons />);

    expect(screen.getByTestId('plugin-toolbar-section')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-toolbar-button-wc-button')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-toolbar-button-tr-button')).toBeInTheDocument();
  });

  it('click invokes manager.invokeCommand with the right (pluginId, command)', () => {
    usePluginRegistryStore.getState().addToolbarButton('word-counter', {
      id: 'wc-button',
      icon: 'hash',
      tooltip: 'Count words',
      command: 'word-counter.count',
    });

    const invokeCommand = vi.fn(() => Promise.resolve(undefined));
    setActivePluginManager({ invokeCommand } as unknown as PluginManager);

    render(<PluginToolbarButtons />);
    fireEvent.click(screen.getByTestId('plugin-toolbar-button-wc-button'));

    expect(invokeCommand).toHaveBeenCalledTimes(1);
    expect(invokeCommand).toHaveBeenCalledWith('word-counter', 'word-counter.count');
  });

  it('does not throw when no manager is set', () => {
    usePluginRegistryStore.getState().addToolbarButton('word-counter', {
      id: 'wc-button',
      icon: 'hash',
      tooltip: 'Count words',
      command: 'word-counter.count',
    });

    expect(getActivePluginManager()).toBeNull();
    render(<PluginToolbarButtons />);
    expect(() =>
      fireEvent.click(screen.getByTestId('plugin-toolbar-button-wc-button')),
    ).not.toThrow();
  });
});
