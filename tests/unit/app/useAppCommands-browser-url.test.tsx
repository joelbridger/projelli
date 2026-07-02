/**
 * F2.7a — "Open Browser Tab" URL hardening.
 *
 * Before this fix, the prompted URL went straight to handleOpenBrowserTab,
 * which called `new URL(url).hostname` unguarded (see useTabOpening.ts).
 * Typing a bare domain like "example.com" (no scheme) threw an uncaught
 * TypeError. These tests lock in: (1) the pure validate/normalize helpers,
 * and (2) that the command wires them into the prompt + the call to
 * handleOpenBrowserTab.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useAppCommands,
  normalizeBrowserUrl,
  validateBrowserUrl,
  type AppCommandDeps,
} from '@/app/commands/useAppCommands';

function baseDeps(overrides: Partial<AppCommandDeps> = {}): AppCommandDeps {
  return {
    openTabs: [],
    activeTabPath: null,
    handleSaveFile: vi.fn(async () => {}),
    closeTab: vi.fn(),
    toggleOutline: vi.fn(),
    isSplit: false,
    splitPane: vi.fn(),
    closeSplit: vi.fn(),
    handleOpenBrowserTab: vi.fn(),
    handleCreateDefaultDocument: vi.fn(async () => {}),
    sidebarActiveTab: 'files',
    setSidebarCollapsed: vi.fn(),
    setShowWorkspaceSelector: vi.fn(),
    openAIAssistantTab: vi.fn(),
    setShowSettingsModal: vi.fn(),
    prompt: vi.fn(async () => null),
    ...overrides,
  };
}

describe('validateBrowserUrl', () => {
  it('rejects an empty/whitespace value', () => {
    expect(validateBrowserUrl('')).toBe('Enter a URL.');
    expect(validateBrowserUrl('   ')).toBe('Enter a URL.');
  });

  it('rejects unparseable input', () => {
    expect(validateBrowserUrl('not a url')).toBe('Enter a valid URL, e.g. https://example.com.');
  });

  it('accepts a bare domain (normalized before parsing)', () => {
    expect(validateBrowserUrl('example.com')).toBeUndefined();
  });

  it('accepts an absolute URL with an explicit scheme', () => {
    expect(validateBrowserUrl('https://example.com/path')).toBeUndefined();
  });
});

describe('normalizeBrowserUrl', () => {
  it('adds https:// to a bare domain', () => {
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com');
  });

  it('leaves an existing scheme untouched', () => {
    expect(normalizeBrowserUrl('http://example.com')).toBe('http://example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeBrowserUrl('  example.com  ')).toBe('https://example.com');
  });
});

describe('useAppCommands — "Open Browser Tab" command', () => {
  function getBrowserOpenCommand(deps: AppCommandDeps) {
    const { result } = renderHook(() => useAppCommands(deps));
    const command = result.current.find((c) => c.id === 'browser.open');
    if (!command) throw new Error('browser.open command not found');
    return command;
  }

  it('passes validateBrowserUrl to the prompt dialog', async () => {
    const prompt = vi.fn(async () => null);
    const command = getBrowserOpenCommand(baseDeps({ prompt }));

    await command.action();

    expect(prompt).toHaveBeenCalledWith(
      'Enter URL:',
      '',
      expect.objectContaining({ validate: validateBrowserUrl })
    );
  });

  it('normalizes a bare-domain URL before opening the tab', async () => {
    const handleOpenBrowserTab = vi.fn();
    const prompt = vi.fn(async () => 'example.com');
    const command = getBrowserOpenCommand(baseDeps({ prompt, handleOpenBrowserTab }));

    await command.action();

    expect(handleOpenBrowserTab).toHaveBeenCalledWith('https://example.com');
  });

  it('does nothing when the prompt is cancelled', async () => {
    const handleOpenBrowserTab = vi.fn();
    const prompt = vi.fn(async () => null);
    const command = getBrowserOpenCommand(baseDeps({ prompt, handleOpenBrowserTab }));

    await command.action();

    expect(handleOpenBrowserTab).not.toHaveBeenCalled();
  });
});
