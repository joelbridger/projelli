import '@/i18n';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RagHit } from '@/platform/utils/tauri-commands';
import { EV_MATTER_LAUNCH } from '@/config/identity';

const { providerMock, retrieveMock } = vi.hoisted(() => ({
  providerMock: vi.fn<() => Promise<unknown>>(),
  retrieveMock: vi.fn<(...args: unknown[]) => Promise<RagHit[]>>(),
}));

vi.mock('@/platform/rag/MemoryService', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/platform/rag/MemoryService')>();
  return {
    ...original,
    isMemoryEnabled: () => true,
    MemoryService: {
      ...original.MemoryService,
      retrieve: (...args: unknown[]): Promise<RagHit[]> => retrieveMock(...args),
      filterMeetingFileVisibilityHits: (hits: readonly RagHit[]) =>
        Promise.resolve([...hits]),
    },
  };
});

vi.mock('@/features/crm-ask/retrieval', () => ({
  retrieveCrmAskHits: async (): Promise<RagHit[]> => [],
}));

vi.mock('@/features/ask/useStillImporting', () => ({
  useStillImporting: () => 'idle' as const,
  isImportStatusUnsettled: () => false,
}));

vi.mock('@/features/ask/askHelpers', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/ask/askHelpers')>();
  return {
    ...original,
    buildResolvedAskProvider: (): Promise<unknown> => providerMock(),
  };
});

import { openAskSource, useAsk } from '@/features/ask';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { setDevFlagOverride } from '@/platform/flags/router';
import { SK_ASK_FILES_ONLY } from '@/config/identity';

function hendricksHit(): RagHit {
  return {
    path: 'hendricks-plan.md',
    sourceId: 'hendricks-plan.md',
    chunkText: 'Hendricks approved the retirement plan.',
    score: 1,
    paragraphIndex: 0,
    matterId: 'hendricks',
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(SK_ASK_FILES_ONLY, '1');
  useAIChatStore.getState().clearAllSessions();
  useMatterStore.setState({
    matters: [],
    activeMatterId: null,
    clientMapHubId: null,
  });
  setDevFlagOverride('selection-authority-boot-gate', false);
  retrieveMock.mockReset();
  providerMock.mockReset();
});

describe('client-scoped cited Ask', () => {
  it('uses the visibly selected Hendricks matter despite a stale hidden global scope, excluding a tempting second client from retrieval and citations', async () => {
    const hendricks = useMatterStore.getState().createMatter({
      id: 'hendricks',
      name: 'Hendricks',
      client: 'Hendricks',
      folderPaths: [],
    });
    useMatterStore.getState().createMatter({
      id: 'other-client',
      name: 'Other Client',
      client: 'Other Client',
      folderPaths: [],
    });
    // This is the old compatibility state: the client bar visibly names
    // Hendricks while the source authority remains on its all-matters arm.
    useMatterStore.setState({ activeMatterId: hendricks.id });

    const temptingOtherClientHit: RagHit = {
      ...hendricksHit(),
      path: 'other-client-secret-plan.md',
      sourceId: 'other-client-secret-plan.md',
      chunkText: 'Other Client made the tempting matching promise.',
      matterId: 'other-client',
    };
    retrieveMock.mockImplementation(async (_query, _topK, scope) => {
      expect(scope).toEqual({ kind: 'matter', matterId: hendricks.id });
      // The adapter would have returned this tempting hit only for a global
      // query. The asserted scope decides which evidence can enter Ask.
      return [hendricksHit()];
    });
    const sendMessage = vi.fn().mockResolvedValue({
      content: 'Hendricks approved the retirement plan [hendricks-plan.md paragraph 0].',
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      cost: 0,
      latency: 1,
      model: 'test-local',
      stopReason: 'stop',
    });
    providerMock.mockResolvedValue({
      provider: {
        isConfigured: () => true,
        sendMessage,
        getMetadata: () => ({
          model: 'test-local',
          capabilities: { maxContextTokens: 16_000 },
        }),
      },
      providerId: 'lantern-local',
      model: 'test-local',
    });

    const { result } = renderHook(() => useAsk({}));
    expect(result.current.activeMatter?.id).toBe(hendricks.id);
    act(() => result.current.setAskScope('all-matters'));
    await act(async () => result.current.handleAsk('What was approved?'));

    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(retrieveMock).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(result.current.turns[0]?.citations).toEqual([
      expect.objectContaining({
        path: 'hendricks-plan.md',
        matterId: hendricks.id,
        grounded: true,
        verified: true,
      }),
    ]);
    expect(JSON.stringify(result.current.turns)).not.toContain(
      temptingOtherClientHit.path,
    );
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain(
      temptingOtherClientHit.chunkText,
    );
  });

  it('does not retrieve or send when no exact live visible client can resolve', async () => {
    useMatterStore.setState({ activeMatterId: 'stale-hendricks' });
    const { result } = renderHook(() => useAsk({}));

    await act(async () => result.current.handleAsk('What changed?'));

    expect(result.current.status).toBe('error');
    expect(result.current.errorMsg).toContain('no longer available');
    expect(retrieveMock).not.toHaveBeenCalled();
    expect(providerMock).not.toHaveBeenCalled();
  });

  it('opens a real meeting citation through its exact authorized meeting route, never the document fallback', () => {
    const opened = vi.fn();
    const documentFallback = vi.fn();
    window.addEventListener(EV_MATTER_LAUNCH, opened);
    try {
      expect(
        openAskSource(
          {
            path: 'meeting:hendricks-review#60000',
            sourceType: 'meeting',
            matterId: 'hendricks',
          },
          { openDocument: documentFallback },
        ),
      ).toBe(true);
      expect(opened).toHaveBeenCalledOnce();
      expect((opened.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
        matterId: 'hendricks',
        surface: 'meetings',
        source: { kind: 'meeting', ref: 'meeting:hendricks-review#60000' },
      });
      expect(documentFallback).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(EV_MATTER_LAUNCH, opened);
    }
  });
});
