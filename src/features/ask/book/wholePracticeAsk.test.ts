import { describe, it, expect, vi, beforeEach } from 'vitest';

// GUARD: whole-practice Ask must never touch retrieval. Mock the two doors
// raw RAG could enter through and assert they stay shut.
const retrieveMock = vi.fn();
vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: (...a: unknown[]): unknown => retrieveMock(...a) },
  isMemoryEnabled: () => true,
}));
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]): unknown => invokeMock(...a) }));

const sendMessageMock = vi.fn();
vi.mock('@/platform/matter/matterAtAGlance', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/platform/matter/matterAtAGlance')>();
  return {
    ...mod,
    buildResolvedProviderForGlance: vi.fn(() => ({
      provider: { sendMessage: sendMessageMock, getMetadata: () => ({ model: 'test-model' }) },
      providerId: 'ollama' as const,
      model: 'test-model',
    })),
  };
});
vi.mock('@/platform/privacy/localOnlyGuard', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/platform/privacy/localOnlyGuard')>();
  return { ...mod, assertLocalOnlyAllowsSend: vi.fn() };
});

import { runWholePracticeAsk } from './wholePracticeAsk';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { Matter } from '@/platform/types/matter';

function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected index ${String(i)} to exist`);
  return v;
}

beforeEach(() => {
  retrieveMock.mockReset();
  invokeMock.mockReset();
  sendMessageMock.mockReset();
  const m = { id: 'm1', name: 'Alvarez', client: 'Alvarez', folderPaths: [], createdAt: '2026-01-01T00:00:00.000Z' } as Matter;
  useMatterStore.setState({ matters: [m] });
  const map = emptyClientMap('m1');
  map.lastBuiltAt = '2026-07-01T00:00:00.000Z';
  at(map.sections, 1).items = [{
    id: 'm1-i0', text: '529 for grandkids', origin: 'ai', isAssumption: false,
    sources: [{ kind: 'document', ref: '/w/plan.pdf', snippet: 's' }], updatedAt: '2026-06-01T00:00:00.000Z',
  }];
  useClientMapStore.setState({ maps: { m1: map } });
});

describe('runWholePracticeAsk', () => {
  it('answers from summaries and NEVER calls retrieval or rag_retrieve', async () => {
    sendMessageMock.mockResolvedValue({
      content: '{"answer":"Alvarez mentions a 529.","matches":[{"matterId":"m1","factItemIds":["m1-i0"]}]}',
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, cost: 0,
    });
    const r = await runWholePracticeAsk('which clients mention 529 plans?');
    expect(at(r.matches, 0).label).toBe('Alvarez');
    expect(r.model).toBe('test-model');
    expect(retrieveMock).not.toHaveBeenCalled();
    expect(invokeMock.mock.calls.every(([cmd]) => cmd !== 'rag_retrieve')).toBe(true);
  });
  it('returns an empty result without a model call when no maps are built', async () => {
    useClientMapStore.setState({ maps: {} });
    const r = await runWholePracticeAsk('anything');
    expect(r.matches).toHaveLength(0);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});
