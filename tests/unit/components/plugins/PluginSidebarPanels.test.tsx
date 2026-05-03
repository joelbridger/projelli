// Component test — PluginSidebarPanels.
//
// Coverage:
//  - empty registry renders the "no panels installed" placeholder
//  - single registered panel renders inside a sandboxed iframe
//  - the iframe's srcDoc contains the plugin-supplied HTML
//  - sandbox attribute is empty (the fully-locked-down policy)
//  - multiple panels render a tab strip and switch on click
//  - removing the active panel falls back to the first remaining one

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

import { PluginSidebarPanels } from '@/components/plugins/PluginSidebarPanels';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';

function resetRegistry() {
  usePluginRegistryStore.setState({
    commands: new Map(),
    toolbar: [],
    sidebar: [],
    settingsPages: [],
  });
}

describe('PluginSidebarPanels', () => {
  beforeEach(() => {
    resetRegistry();
  });

  afterEach(() => {
    cleanup();
    resetRegistry();
  });

  it('renders the empty placeholder when no panels are registered', () => {
    render(<PluginSidebarPanels />);
    expect(screen.getByTestId('plugin-sidebar-empty')).toBeInTheDocument();
  });

  it('renders a sandboxed iframe with the plugin-supplied html', () => {
    usePluginRegistryStore.getState().addSidebarPanel('word-counter', {
      id: 'wc-panel',
      title: 'Word Count',
      html: '<p>Words: 42</p>',
    });

    render(<PluginSidebarPanels />);
    const iframe = screen.getByTestId('plugin-sidebar-iframe') as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    // Sandbox is the fully locked-down empty string policy.
    expect(iframe.getAttribute('sandbox')).toBe('');
    expect(iframe.getAttribute('srcdoc')).toContain('<p>Words: 42</p>');
  });

  it('renders a tab strip when multiple plugin panels are registered', () => {
    usePluginRegistryStore.getState().addSidebarPanel('word-counter', {
      id: 'wc-panel',
      title: 'Word Count',
      html: '<p>wc</p>',
    });
    usePluginRegistryStore.getState().addSidebarPanel('translator', {
      id: 'tr-panel',
      title: 'Translate',
      html: '<p>tr</p>',
    });

    render(<PluginSidebarPanels />);
    expect(screen.getByTestId('plugin-sidebar-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-sidebar-tab-wc-panel')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-sidebar-tab-tr-panel')).toBeInTheDocument();

    // The first registered panel is active by default.
    const activePanel = screen.getByTestId('plugin-sidebar-panel');
    expect(activePanel.getAttribute('data-panel-id')).toBe('wc-panel');

    fireEvent.click(screen.getByTestId('plugin-sidebar-tab-tr-panel'));
    expect(screen.getByTestId('plugin-sidebar-panel').getAttribute('data-panel-id')).toBe(
      'tr-panel',
    );
  });

  it('falls back to the first remaining panel when the active one is removed', () => {
    usePluginRegistryStore.getState().addSidebarPanel('word-counter', {
      id: 'wc-panel',
      title: 'Word Count',
      html: '<p>wc</p>',
    });
    usePluginRegistryStore.getState().addSidebarPanel('translator', {
      id: 'tr-panel',
      title: 'Translate',
      html: '<p>tr</p>',
    });

    render(<PluginSidebarPanels />);
    fireEvent.click(screen.getByTestId('plugin-sidebar-tab-tr-panel'));
    expect(screen.getByTestId('plugin-sidebar-panel').getAttribute('data-panel-id')).toBe(
      'tr-panel',
    );

    act(() => {
      usePluginRegistryStore.getState().removeSidebarPanel('tr-panel');
    });
    expect(screen.getByTestId('plugin-sidebar-panel').getAttribute('data-panel-id')).toBe(
      'wc-panel',
    );
  });
});
