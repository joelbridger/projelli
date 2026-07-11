import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
let mockProviderId: 'ollama' | 'anthropic' = 'ollama';
vi.mock('@/platform/matter/matterAtAGlance', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/platform/matter/matterAtAGlance')>();
  return {
    ...mod,
    buildResolvedProviderForGlance: vi.fn(() => ({
      provider: { sendMessage: sendMessageMock, getMetadata: () => ({ model: 'test-model' }) },
      providerId: mockProviderId,
      model: 'test-model',
    })),
  };
});
vi.mock('@/platform/privacy/localOnlyGuard', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/platform/privacy/localOnlyGuard')>();
  return { ...mod, assertLocalOnlyAllowsSend: vi.fn() };
});

import { runWholePracticeAsk, WholePracticeConsentRequiredError } from './wholePracticeAsk';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { Matter } from '@/platform/types/matter';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { SECRET_SCRUB_FIXTURES } from '@/platform/privacy/promptPreparation.fixtures';
import { setPromptDecisionBroker } from '@/platform/privacy/promptPreparation';

function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected index ${String(i)} to exist`);
  return v;
}

const CHAT_ID = 'ask-global';

beforeEach(() => {
  retrieveMock.mockReset();
  invokeMock.mockReset();
  sendMessageMock.mockReset();
  mockProviderId = 'ollama';
  useAIChatStore.setState({ fileAccessConsent: {} });
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

afterEach(() => { setPromptDecisionBroker(); });

describe('runWholePracticeAsk', () => {
  it('answers from summaries and NEVER calls retrieval or rag_retrieve', async () => {
    sendMessageMock.mockResolvedValue({
      content: '{"answer":"Alvarez mentions a 529.","matches":[{"matterId":"m1","factItemIds":["m1-i0"]}]}',
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, cost: 0,
    });
    const r = await runWholePracticeAsk('which clients mention 529 plans?', CHAT_ID);
    expect(at(r.matches, 0).label).toBe('Alvarez');
    expect(r.model).toBe('test-model');
    expect(retrieveMock).not.toHaveBeenCalled();
    expect(invokeMock.mock.calls.every(([cmd]) => cmd !== 'rag_retrieve')).toBe(true);
  });
  it('returns an empty result without a model call when no maps are built', async () => {
    useClientMapStore.setState({ maps: {} });
    const r = await runWholePracticeAsk('anything', CHAT_ID);
    expect(r.matches).toHaveLength(0);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
  it('uses sample Client Map facts when the sample is the only visible client', async () => {
    const sample = {
      id: 'sample',
      name: 'Sample',
      client: 'Sample Household',
      folderPaths: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      isSample: true,
    } as Matter;
    const sampleMap = emptyClientMap('sample');
    sampleMap.lastBuiltAt = '2026-07-01T00:00:00.000Z';
    at(sampleMap.sections, 1).items = [{
      id: 'sample-i0', text: '529 for grandkids', origin: 'ai', isAssumption: false,
      sources: [{ kind: 'document', ref: '/w/sample/plan.pdf', snippet: '529 for grandkids' }],
      updatedAt: '2026-06-01T00:00:00.000Z',
    }];
    useMatterStore.setState({ matters: [sample] });
    useClientMapStore.setState({ maps: { sample: sampleMap } });
    sendMessageMock.mockResolvedValue({
      content: '{"answer":"Sample Household mentions a 529.","matches":[{"matterId":"sample","factItemIds":["sample-i0"]}]}',
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, cost: 0,
    });
    const r = await runWholePracticeAsk('which clients mention 529 plans?', CHAT_ID);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(at(r.matches, 0).label).toBe('Sample Household - Sample');
  });

  it('sends only a redacted copy and records its secret category', async () => {
    const audit = vi.fn();
    sendMessageMock.mockResolvedValue({
      content: '{"answer":"Safe answer","matches":[]}',
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, cost: 0,
    });
    setPromptDecisionBroker(() => Promise.resolve('send_redacted_copy'));

    await runWholePracticeAsk(SECRET_SCRUB_FIXTURES.urls, CHAT_ID, { onAuditLog: audit });

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls[0]?.[0]).not.toContain('intake-secret');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'prompt_preparation',
      metadata: expect.objectContaining({
        decision: 'redacted_by_user',
        categories: expect.arrayContaining([expect.objectContaining({ kind: 'intake_link_secret', count: 1 })]),
      }),
    }));
  });

  it('does not send when the advisor cancels the private-link review', async () => {
    setPromptDecisionBroker(() => Promise.resolve('cancel'));

    await expect(runWholePracticeAsk(SECRET_SCRUB_FIXTURES.urls, CHAT_ID)).rejects.toThrow('prompt_send_cancelled');

    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  describe('file-access consent gate (cloud provider)', () => {
    beforeEach(() => {
      mockProviderId = 'anthropic';
    });
    it('refuses to send every client summary to a cloud provider without all-clients consent', async () => {
      await expect(runWholePracticeAsk('which clients mention 529 plans?', CHAT_ID)).rejects.toThrow(
        WholePracticeConsentRequiredError,
      );
      expect(sendMessageMock).not.toHaveBeenCalled();
    });
    it('sends once all-clients file access is granted for the conversation', async () => {
      useAIChatStore.getState().setFileAccessConsent(CHAT_ID, { state: 'granted', grantedScope: { kind: 'allMatters' } });
      sendMessageMock.mockResolvedValue({
        content: '{"answer":"Alvarez mentions a 529.","matches":[{"matterId":"m1","factItemIds":["m1-i0"]}]}',
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, cost: 0,
      });
      const r = await runWholePracticeAsk('which clients mention 529 plans?', CHAT_ID);
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
      expect(at(r.matches, 0).label).toBe('Alvarez');
    });
    it('a single-client grant does NOT cover the whole-practice send', async () => {
      useAIChatStore.getState().setFileAccessConsent(CHAT_ID, { state: 'granted', grantedScope: { kind: 'matter', matterId: 'm1' } });
      await expect(runWholePracticeAsk('which clients mention 529 plans?', CHAT_ID)).rejects.toThrow(
        WholePracticeConsentRequiredError,
      );
      expect(sendMessageMock).not.toHaveBeenCalled();
    });
  });
});
