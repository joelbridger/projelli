// Component test — PluginSettingsPage + PluginsSettings.
//
// Coverage:
//  - PluginSettingsPage renders one row per schema field
//  - field types render the right control
//  - PluginsSettings nav lists every registered settings page and switching
//    pages renders the correct one
//  - installed-plugin status badge reflects manager store state

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { PluginSettingsPage } from '@/components/plugins/PluginSettingsPage';
import { PluginsSettings } from '@/components/settings/PluginsSettings';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';
import { usePluginManagerStore } from '@/stores/pluginManagerStore';
import type { PluginInstance, PluginManifest } from '@/types/plugin';

function resetStores() {
  usePluginRegistryStore.setState({
    commands: new Map(),
    toolbar: [],
    sidebar: [],
    settingsPages: [],
  });
  usePluginManagerStore.setState({
    installedPlugins: [],
    statusByPluginId: {},
    errorsByPluginId: {},
  });
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
}

function fakeManifest(id: string, name: string): PluginManifest {
  return {
    id,
    name,
    version: '1.0.0',
    apiVersion: '1.0.0',
    author: { name: 'Tester' },
    description: 'fixture',
    main: 'index.js',
    permissions: [],
    minProjelliVersion: '0.0.0',
    category: 'test',
    tags: [],
  };
}

function fakeInstance(id: string, name: string): PluginInstance {
  return {
    manifest: fakeManifest(id, name),
    status: 'enabled',
    installPath: `/test/${id}`,
    lastError: null,
    installedAt: '2026-05-03T00:00:00.000Z',
    enabledAt: '2026-05-03T00:00:00.000Z',
  };
}

describe('PluginSettingsPage', () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    cleanup();
    resetStores();
  });

  it('renders one row per schema field', () => {
    render(
      <PluginSettingsPage
        page={{
          id: 'wc-page',
          pluginId: 'word-counter',
          title: 'Word Counter',
          schema: {
            includeMarkdown: { type: 'boolean', default: true, label: 'Include markdown' },
            wordsPerLine: { type: 'number', default: 10, label: 'Words per line' },
          },
        }}
      />,
    );
    expect(screen.getByTestId('plugin-setting-row-includeMarkdown')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-setting-row-wordsPerLine')).toBeInTheDocument();
  });

  it('renders a select control with choices when type is select', () => {
    render(
      <PluginSettingsPage
        page={{
          id: 'tr-page',
          pluginId: 'translator',
          title: 'Translator',
          schema: {
            language: {
              type: 'select',
              default: 'en',
              label: 'Language',
              choices: ['en', 'fr', 'de'],
            },
          },
        }}
      />,
    );
    const select = screen.getByTestId('plugin-setting-control-language') as HTMLSelectElement;
    expect(select.tagName.toLowerCase()).toBe('select');
    expect(select.value).toBe('en');
    expect(select.querySelectorAll('option')).toHaveLength(3);
  });
});

describe('PluginsSettings', () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    cleanup();
    resetStores();
  });

  it('renders an empty installed list when no plugins are installed', () => {
    render(<PluginsSettings />);
    expect(screen.getByTestId('plugins-installed-list')).toBeInTheDocument();
    expect(screen.queryByTestId('plugins-settings-pages')).not.toBeInTheDocument();
  });

  it('renders one row per installed plugin with a status badge', () => {
    usePluginManagerStore.setState({
      installedPlugins: [fakeInstance('word-counter', 'Word Counter')],
      statusByPluginId: { 'word-counter': 'enabled' },
      errorsByPluginId: {},
    });
    render(<PluginsSettings />);
    expect(screen.getByTestId('plugin-installed-word-counter')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-status-word-counter').textContent).toBe('enabled');
  });

  it('lists each plugin settings page and switching pages renders the right one', () => {
    usePluginRegistryStore.getState().addSettingsPage('word-counter', {
      id: 'wc-page',
      title: 'Word Counter',
      schema: {
        includeMarkdown: { type: 'boolean', default: true, label: 'Include markdown' },
      },
    });
    usePluginRegistryStore.getState().addSettingsPage('translator', {
      id: 'tr-page',
      title: 'Translator',
      schema: {
        language: { type: 'string', default: 'en', label: 'Language' },
      },
    });

    render(<PluginsSettings />);
    expect(screen.getByTestId('plugins-settings-nav-wc-page')).toBeInTheDocument();
    expect(screen.getByTestId('plugins-settings-nav-tr-page')).toBeInTheDocument();

    // No active page until the user clicks.
    expect(screen.queryByTestId('plugin-settings-page')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('plugins-settings-nav-tr-page'));
    const page = screen.getByTestId('plugin-settings-page');
    expect(page.getAttribute('data-page-id')).toBe('tr-page');
    expect(page.getAttribute('data-plugin-id')).toBe('translator');
  });
});
