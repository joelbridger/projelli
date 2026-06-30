// tests/unit/clientMap/customSection.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';
const retrieveMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/rag/MemoryService', () => ({ MemoryService: { retrieve: retrieveMock }, isMemoryEnabled: () => true }));
vi.mock('@/platform/rag/workspaceCommand', () => ({ buildWorkspaceContextBlock: (h: RagHit[]) => (h.length ? '<workspace_context>c</workspace_context>' : '') }));
vi.mock('@/features/matters/clientMap/provider', () => ({
  buildResolvedProviderForClientMap: async () => ({
    provider: { sendMessage: sendMock, getMetadata: () => ({ model: 't', providerId: 'ollama' }) },
    providerId: 'ollama',
    model: 't',
  }),
}));
import { buildCustomSection } from '@/features/matters/clientMap/customSection';

beforeEach(() => { retrieveMock.mockReset(); sendMock.mockReset(); });

describe('buildCustomSection', () => {
  it('retrieves matter-scoped using the prompt and returns a sourced custom section', async () => {
    retrieveMock.mockResolvedValue([{ path: '/policy.pdf', sourceId: '/policy.pdf', chunkText: 'limit 1M', score: 1, paragraphIndex: 0, id: 'c1' } as RagHit]);
    sendMock.mockResolvedValue({ content: JSON.stringify({ items: [{ text: 'Coverage limit is 1M', sourceNumbers: [1], assumption: false }] }) });
    const sec = await buildCustomSection('m1', 'sec-uuid', 'Insurance coverage', 'track the insurance coverage limits');
    expect((retrieveMock.mock.calls[0][2] as RetrievalScope)).toEqual({ kind: 'matter', matterId: 'm1' });
    expect(sec.kind).toBe('custom');
    expect(sec.title).toBe('Insurance coverage');
    expect(sec.items[0].sources[0].ref).toBe('/policy.pdf');
  });

  it('returns an empty section when no content is indexed', async () => {
    retrieveMock.mockResolvedValue([]);
    const sec = await buildCustomSection('m1', 'sec-uuid', 'Insurance coverage', 'track insurance');
    expect(sec.kind).toBe('custom');
    expect(sec.items).toEqual([]);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
