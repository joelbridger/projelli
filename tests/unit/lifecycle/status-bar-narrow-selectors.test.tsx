/**
 * Perf (P1.2) — StatusBar's exact-data-only selectors.
 *
 * Before this change, StatusBar destructured from bare `useWorkspaceStore()`
 * / `useEditorStore()` calls with no selector, which subscribes to the
 * ENTIRE store. Because `updateContent` replaces the whole `openTabs` array
 * on every keystroke, StatusBar re-rendered on every keystroke in ANY open
 * tab — not just the active one it actually displays.
 *
 * This test edits a background (non-active) tab's content and asserts
 * StatusBar does NOT commit, then edits the ACTIVE tab and asserts it DOES
 * (so the fix narrows re-renders without breaking the dirty indicator).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { StatusBar } from '@/app/shell/layout/StatusBar';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';

const ROOT = '/ws/statusbar-perf-test';
const ACTIVE_PATH = `${ROOT}/active.md`;
const BACKGROUND_PATH = `${ROOT}/background.md`;

describe('StatusBar — narrow selectors (Perf P1.2)', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    useSettingsStore.setState({ values: {} });
    useMatterStore.setState({ matters: [], activeMatterId: null });
    useEditorStore.getState().clearTabState();
    useEditorStore.getState().openFile(BACKGROUND_PATH, 'background.md', 'bg v0');
    useEditorStore.getState().openFile(ACTIVE_PATH, 'active.md', 'active v0');
    useEditorStore.setState({ activeTabPath: ACTIVE_PATH });
    useWorkspaceStore.setState({ rootPath: ROOT });
  });

  it('does not re-render when a background (non-active) tab is edited', () => {
    let commits = 0;
    const onRender: ProfilerOnRenderCallback = () => { commits++; };

    render(
      <Profiler id="status-bar-perf" onRender={onRender}>
        <StatusBar />
      </Profiler>,
    );
    commits = 0;

    act(() => {
      useEditorStore.getState().updateContent(BACKGROUND_PATH, 'bg v1 — an unrelated tab being typed into');
      useEditorStore.getState().updateContent(BACKGROUND_PATH, 'bg v2');
      useEditorStore.getState().updateContent(BACKGROUND_PATH, 'bg v3');
    });

    expect(commits).toBe(0);
  });

  it('still re-renders when the ACTIVE tab is edited (dirty indicator stays live)', () => {
    let commits = 0;
    const onRender: ProfilerOnRenderCallback = () => { commits++; };

    render(
      <Profiler id="status-bar-perf-active" onRender={onRender}>
        <StatusBar />
      </Profiler>,
    );
    commits = 0;

    act(() => {
      useEditorStore.getState().updateContent(ACTIVE_PATH, 'active v1 — user is typing here');
    });

    expect(commits).toBeGreaterThan(0);
  });
});
