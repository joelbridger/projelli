import '@/i18n';
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAsk } from './useAsk';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import {
  issueMatterScopeSelection,
  rehydrateSelectionHint,
  requestClearClientSelection,
  requestMatterScopeSelection,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';

beforeEach(() => {
  localStorage.clear();
  useAIChatStore.getState().clearAllSessions();
  useWorkspaceStore.setState({ rootPath: null });
  useMatterStore.setState({
    matters: [],
    activeMatterId: null,
    clientMapHubId: null,
  });
  setDevFlagOverride('selection-authority-boot-gate', false);
  requestClearClientSelection();
  setDevFlagOverride('selection-authority-boot-gate', true);
  rehydrateSelectionHint({
    kind: 'persisted-hint',
    value: { version: 1, source: 'explicit-all-matters' },
  });
});

describe('useAsk scope normalization', () => {
  it('keeps whole-practice scope visible without an active client', () => {
    const { result } = renderHook(() => useAsk({}));

    expect(result.current.askScope).toBe('all-matters');

    act(() => {
      result.current.setAskScope('whole-practice');
    });

    expect(result.current.askScope).toBe('whole-practice');
  });

  it('keeps whole-practice scope visible with an active client', async () => {
    const matter = useMatterStore.getState().createMatter({
      id: 'matter_scope_normalization',
      name: 'Scope Normalization',
      client: 'Scope Normalization',
      folderPaths: [],
    });
    await requestMatterScopeSelection(issueMatterScopeSelection(matter.id));
    await waitFor(() => expect(useMatterStore.getState().activeMatterId).toBe(matter.id));

    const { result } = renderHook(() => useAsk({}));

    expect(result.current.askScope).toBe('this-matter');

    act(() => {
      result.current.setAskScope('whole-practice');
    });

    expect(result.current.askScope).toBe('whole-practice');
  });

  it('refuses and surfaces a blocked source selection before Ask retrieves or sends', async () => {
    rehydrateSelectionHint({
      kind: 'persisted-hint',
      value: { version: 1, source: 'blocked/refused' },
    });
    const { result } = renderHook(() => useAsk({}));

    act(() => result.current.setQuestion('What changed?'));
    await act(async () => result.current.handleAsk());

    expect(result.current.status).toBe('error');
    expect(result.current.errorMsg).toContain('still unresolved');
    expect(result.current.streamingTurn).toBeNull();
  });

  it('refuses and surfaces forced source/follower disagreement before Ask retrieves or sends', async () => {
    const matter = useMatterStore.getState().createMatter({
      id: 'matter_scope_disagreement',
      name: 'Scope Disagreement',
      client: 'Scope Disagreement',
      folderPaths: [],
    });
    await requestMatterScopeSelection(issueMatterScopeSelection(matter.id));
    await waitFor(() => expect(useMatterStore.getState().activeMatterId).toBe(matter.id));
    useMatterStore.setState({ activeMatterId: null });
    const { result } = renderHook(() => useAsk({}));

    act(() => result.current.setQuestion('What changed?'));
    await act(async () => result.current.handleAsk());

    expect(result.current.status).toBe('error');
    expect(result.current.errorMsg).toContain('still catching up');
    expect(result.current.streamingTurn).toBeNull();
  });
});
