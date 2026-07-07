import '@/i18n';
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAsk } from './useAsk';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

beforeEach(() => {
  localStorage.clear();
  useAIChatStore.getState().clearAllSessions();
  useWorkspaceStore.setState({ rootPath: null });
  useMatterStore.setState({
    matters: [],
    activeMatterId: null,
    clientMapHubId: null,
  });
});

describe('useAsk scope normalization', () => {
  it('normalizes a stale whole-practice scope before exposing Ask state without an active client', () => {
    const { result } = renderHook(() => useAsk({}));

    expect(result.current.askScope).toBe('all-matters');

    act(() => {
      result.current.setAskScope('whole-practice');
    });

    expect(result.current.askScope).toBe('all-matters');
  });

  it('normalizes a stale whole-practice scope before exposing Ask state with an active client', () => {
    const matter = useMatterStore.getState().createMatter({
      id: 'matter_scope_normalization',
      name: 'Scope Normalization',
      client: 'Scope Normalization',
      folderPaths: [],
    });
    useMatterStore.getState().setActiveMatter(matter.id);

    const { result } = renderHook(() => useAsk({}));

    expect(result.current.askScope).toBe('this-matter');

    act(() => {
      result.current.setAskScope('whole-practice');
    });

    expect(result.current.askScope).toBe('this-matter');
  });
});
