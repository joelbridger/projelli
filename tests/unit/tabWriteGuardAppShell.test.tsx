/**
 * QA-15: a blocked browser tab must never mount AppShell at all — not just
 * show an overlay on top of it. App.tsx used to have the gate as an early
 * return INSIDE the same component that declares all of AppShell's hooks;
 * codex-review caught that React still runs every hook/effect declared
 * above an early return regardless of what the component returns, so a
 * "blocked" tab could still run write-capable effects (e.g. the demo-mode
 * auto-open effect, which calls handleWorkspaceSelected on mount with no
 * user interaction). The fix split App into a thin gate component plus a
 * separate AppShell component, so a blocked tab literally never renders
 * AppShell and none of its hooks ever run. This test pins that structural
 * guarantee: with a fresh foreign lock pre-seeded, only the gate's own
 * elements should exist in the DOM — nothing from AppShell.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SK_TAB_LOCK } from '@/config/identity';

const flushAllDirtyTabsSpy = vi.fn(async () => {});
vi.mock('@/app/fileOps/flushDirtyTabs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/fileOps/flushDirtyTabs')>();
  return { ...actual, flushAllDirtyTabs: (...args: unknown[]) => flushAllDirtyTabsSpy(...args) };
});
vi.mock('@/platform/utils/telemetry', () => ({
  sendEvent: vi.fn(async () => {}),
}));
vi.mock('@/platform/utils/openExternal', () => ({
  openExternal: vi.fn(async () => {}),
}));
vi.mock('@/platform/providers/OllamaProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/providers/OllamaProvider')>();
  return { ...actual, detectOllama: vi.fn(async () => ({ reachable: false, models: [] })) };
});
vi.mock('@/platform/providers/KeychainService', () => ({
  createKeychainService: () => ({
    setKey: vi.fn(async () => {}),
    getKey: vi.fn(async () => null),
    deleteKey: vi.fn(async () => {}),
    hasKey: vi.fn(async () => false),
    getMaskedKey: vi.fn(async () => null),
    validateKey: vi.fn(async () => ({ valid: true })),
    isEnvKey: vi.fn(async () => false),
    getStoredKeys: vi.fn(() => []),
  }),
  migrateLocalStorageApiKeysToKeychain: vi.fn(async () => {}),
}));

import App from '@/App';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { __resetTabWriteGuardForTests } from '@/platform/browserGuard/useTabWriteGuard';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useWorkspaceStore.setState({ recentWorkspaces: [], rootPath: null });
  __resetTabWriteGuardForTests();
  flushAllDirtyTabsSpy.mockClear();
});

describe('App tab-write-guard wiring', () => {
  it('never mounts AppShell in a blocked tab — only the gate renders', async () => {
    localStorage.setItem(
      SK_TAB_LOCK,
      JSON.stringify({ tabId: 'another-real-tab', heartbeatAt: Date.now() }),
    );

    render(<App />);

    expect(await screen.findByTestId('tab-write-guard-overlay')).toBeInTheDocument();
    // Nothing AppShell-only should exist — proves AppShell's component
    // function (and therefore every hook/effect it declares) never ran.
    expect(screen.queryByTestId('open-existing-workspace')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-container')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-auto-resume-loading')).not.toBeInTheDocument();
  });

  it('mounts AppShell normally (workspace selector, no gate) when this is the only tab', async () => {
    render(<App />);

    expect(await screen.findByTestId('open-existing-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-write-guard-overlay')).not.toBeInTheDocument();
  });

  it('regression (coordinator P1, round 6): a stale-reclaimed ex-owner does NOT flush on waking up demoted', async () => {
    // This is the involuntary/uncoordinated demotion path: from this tab's
    // point of view, a foreign lock simply appears fresh (indistinguishable
    // here from a coordinated takeover — see the doc comment on App() for
    // why that ambiguity is exactly the point). No flush-request was ever
    // sent to this tab, so — unlike the coordinated flush-and-ack path,
    // covered separately in flushHandoff.test.ts and useTabWriteGuard's own
    // tests — nothing here should trigger a flush of this tab's buffer.
    //
    // Why this matters: an earlier version flushed unconditionally whenever
    // this tab's status became 'blocked'. If this tab had been frozen
    // (backgrounded, throttled) while another tab automatically reclaimed
    // the (by-then-stale) lock, made its own edits, and saved them, this
    // tab waking up and flushing its OWN now-stale buffer would silently
    // overwrite that other tab's newer save — reintroducing exactly the
    // last-write-wins clobber this whole guard exists to prevent.
    render(<App />);
    expect(await screen.findByTestId('open-existing-workspace')).toBeInTheDocument();
    expect(flushAllDirtyTabsSpy).not.toHaveBeenCalled();

    act(() => {
      localStorage.setItem(
        SK_TAB_LOCK,
        JSON.stringify({ tabId: 'took-over-tab', heartbeatAt: Date.now() }),
      );
      window.dispatchEvent(new StorageEvent('storage', { key: SK_TAB_LOCK }));
    });

    expect(await screen.findByTestId('tab-write-guard-overlay')).toBeInTheDocument();
    expect(flushAllDirtyTabsSpy).not.toHaveBeenCalled();
  });
});
