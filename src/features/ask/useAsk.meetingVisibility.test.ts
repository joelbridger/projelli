import '@/i18n';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RagHit } from '@/platform/utils/tauri-commands';
import type { AskTurn } from './askHelpers';
import { SK_ASK_FILES_ONLY } from '@/config/identity';

const {
  buildResolvedAskProviderMock,
  retrieveMock,
  visibilityState,
} = vi.hoisted(() => ({
  buildResolvedAskProviderMock: vi.fn<() => Promise<unknown>>(),
  retrieveMock: vi.fn<(...args: unknown[]) => Promise<RagHit[]>>(),
  visibilityState: { allowed: true },
}));

vi.mock('@/platform/rag/MemoryService', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('@/platform/rag/MemoryService')
  >();
  return {
    ...original,
    isMemoryEnabled: () => true,
    MemoryService: {
      ...original.MemoryService,
      retrieve: (...args: unknown[]): Promise<RagHit[]> => retrieveMock(...args),
      filterMeetingFileVisibilityHits: (hits: readonly RagHit[]) =>
        Promise.resolve(visibilityState.allowed ? [...hits] : []),
    },
  };
});

vi.mock('./askHelpers', async (importOriginal) => {
  const original = await importOriginal<typeof import('./askHelpers')>();
  return {
    ...original,
    buildResolvedAskProvider: (): Promise<unknown> =>
      buildResolvedAskProviderMock(),
  };
});

vi.mock('./useStillImporting', async (importOriginal) => {
  const original = await importOriginal<typeof import('./useStillImporting')>();
  return { ...original, useStillImporting: () => 'idle' as const };
});
import {
  filterAskMeetingVisibilityHits,
  filterPersistedAskMessagesForMeetingVisibility,
  filterPersistedAskTurnsForMeetingVisibility,
  useAsk,
} from './useAsk';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { useFirmStore } from '@/platform/firm/firmStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(SK_ASK_FILES_ONLY, '0');
  useAIChatStore.getState().clearAllSessions();
  useFirmStore.setState({ session: null });
  visibilityState.allowed = true;
  retrieveMock.mockReset();
  buildResolvedAskProviderMock.mockReset();
});

function hit(path: string, text: string): RagHit {
  return {
    path,
    sourceId: path,
    chunkText: text,
    score: 1,
    paragraphIndex: 0,
    matterId: 'matter-1',
  };
}

describe('Ask meeting visibility backstop', () => {
  it('removes hidden meeting text before the prompt input is built', async () => {
    const hidden = hit(
      '/ws/client/Meetings/private/notes.docx',
      'secret promised follow-up'
    );
    const visible = hit('/ws/client/tax.pdf', 'public tax fact');
    const filtered = await filterAskMeetingVisibilityHits(
      [hidden, visible],
      (hits) =>
        Promise.resolve(
          hits.filter((candidate) => candidate.path !== hidden.path)
        )
    );

    expect(filtered.map((candidate) => candidate.chunkText)).toEqual([
      'public tax fact',
    ]);
    expect(JSON.stringify(filtered)).not.toContain('secret promised follow-up');
  });

  it('removes an entire saved answer when its private meeting source is no longer visible', async () => {
    const hiddenPath = '/ws/client/Meetings/private/transcript.json';
    const privateTurn: AskTurn = {
      question: 'What did they promise?',
      answer: 'They promised the secret transfer. {1}',
      citations: [
        {
          n: 1,
          label: 'Private transcript',
          excerpt: 'secret transfer',
          path: hiddenPath,
          locator: 'paragraph 1',
          verified: true,
        },
      ],
      sources: [hit(hiddenPath, 'secret transfer')],
      groundedFromFiles: true,
    };
    const generalTurn: AskTurn = {
      question: 'Draft a greeting',
      answer: 'Hello!',
      citations: [],
      sources: [],
      groundedFromFiles: false,
    };

    const visible = await filterPersistedAskTurnsForMeetingVisibility(
      [privateTurn, generalTurn],
      () => Promise.resolve([])
    );

    expect(visible).toEqual([generalTurn]);
    expect(JSON.stringify(visible)).not.toContain('secret transfer');
    expect(JSON.stringify(visible)).not.toContain('Private transcript');
  });

  it('fails closed for old grounded answers that have no resolvable saved source', async () => {
    const legacy: AskTurn = {
      question: 'Old question',
      answer: 'Old private answer',
      citations: [],
      sources: [],
    };
    await expect(
      filterPersistedAskTurnsForMeetingVisibility([legacy], () =>
        Promise.resolve([])
      )
    ).resolves.toEqual([]);
  });

  it('removes saved prose when only its complete read receipt reveals a hidden meeting source', async () => {
    const hiddenPath = '/ws/client/Meetings/private/notes.docx';
    const messages = [
      { role: 'user' as const, content: 'What changed?', timestamp: 't1' },
      {
        role: 'assistant' as const,
        content: 'A private change happened.',
        timestamp: 't2',
        askGroundedFromFiles: true,
        askSources: [],
        askReadSources: [
          {
            id: hiddenPath,
            label: 'Private meeting notes',
            sourceType: 'meeting',
            path: hiddenPath,
            matterId: 'matter-1',
            chunkCount: 1,
          },
        ],
      },
    ];
    await expect(
      filterPersistedAskMessagesForMeetingVisibility(messages, () =>
        Promise.resolve([])
      )
    ).resolves.toEqual([]);
  });

  it('does not render or persist a private answer when the viewer is revoked during the real provider await', async () => {
    const privatePath = '/ws/client/Meetings/private/transcript.json';
    retrieveMock.mockResolvedValue([
      {
        ...hit(privatePath, 'secret retirement promise'),
        sourceType: 'meeting',
      },
    ]);
    const response = deferred<{
      content: string;
      usage: { inputTokens: number; outputTokens: number; totalTokens: number };
      cost: number;
      latency: number;
      model: string;
      stopReason: string;
    }>();
    const sendMessage = vi.fn(() => response.promise);
    buildResolvedAskProviderMock.mockResolvedValue({
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
    useFirmStore.setState({
      session: {
        userId: 'advisor-1',
        email: 'advisor-1@example.com',
        role: 'member',
        org: null,
        seatId: 'seat-1',
        tier: 'practice',
        packs: [],
        seats: 1,
        lastValidatedAt: null,
        activated: true,
      },
    });

    const { result } = renderHook(() => useAsk({}));
    act(() => {
      // eslint-disable-next-line lantern-async/no-silent-failure -- handleAsk owns its error state; the test observes the hook result
      void result.current.handleAsk('What private promise was made?');
    });
    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    visibilityState.allowed = false;
    act(() => {
      useFirmStore.setState((state) => ({
        session: state.session
          ? { ...state.session, userId: 'advisor-2' }
          : null,
      }));
    });
    act(() => {
      response.resolve({
        content: 'The secret retirement promise was approved.',
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        cost: 0,
        latency: 1,
        model: 'test-local',
        stopReason: 'stop',
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    expect(JSON.stringify(result.current.turns)).not.toContain('secret');
    expect(JSON.stringify(result.current.streamingTurn)).not.toContain('secret');
    expect(
      JSON.stringify(useAIChatStore.getState().sessions[result.current.chatId])
    ).not.toContain('secret');
  });
});
