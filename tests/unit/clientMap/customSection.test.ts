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
    expect((retrieveMock.mock.calls[0]![2] as RetrievalScope)).toEqual({ kind: 'matter', matterId: 'm1' });
    expect(sec.kind).toBe('custom');
    expect(sec.title).toBe('Insurance coverage');
    expect(sec.items[0]!.sources[0]!.ref).toBe('/policy.pdf');
  });

  it('returns an empty section when no content is indexed', async () => {
    retrieveMock.mockResolvedValue([]);
    const sec = await buildCustomSection('m1', 'sec-uuid', 'Insurance coverage', 'track insurance');
    expect(sec.kind).toBe('custom');
    expect(sec.items).toEqual([]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('logs an egress audit entry BEFORE provider.sendMessage, not only after success', async () => {
    // Trust-fixes finding #1: buildCustomSection previously had NO audit
    // logging at all — a custom Client Map section sent this client's context
    // to a cloud AI provider with nothing recorded in the Activity Log.
    retrieveMock.mockResolvedValue([{ path: '/policy.pdf', sourceId: '/policy.pdf', chunkText: 'limit 1M', score: 1, paragraphIndex: 0, id: 'c1' } as RagHit]);
    const order: string[] = [];
    sendMock.mockImplementation(() => {
      order.push('send');
      return Promise.reject(new Error('simulated timeout'));
    });
    const onAuditLog = vi.fn((entry: { action?: string }) => {
      if (entry.action === 'egress') order.push('egress-audit');
    });
    await expect(
      buildCustomSection('m1', 'sec-uuid', 'Insurance coverage', 'track insurance', { onAuditLog }),
    ).rejects.toThrow('simulated timeout');
    expect(order).toEqual(['egress-audit', 'send']);
  });

  it('logs a model_call audit entry after a successful send', async () => {
    retrieveMock.mockResolvedValue([{ path: '/policy.pdf', sourceId: '/policy.pdf', chunkText: 'limit 1M', score: 1, paragraphIndex: 0, id: 'c1' } as RagHit]);
    sendMock.mockResolvedValue({ content: JSON.stringify({ items: [] }) });
    const onAuditLog = vi.fn();
    await buildCustomSection('m1', 'sec-uuid', 'Insurance coverage', 'track insurance', { onAuditLog });
    const modelCallEntries = onAuditLog.mock.calls
      .map((c) => c[0] as { action?: string })
      .filter((e) => e.action === 'model_call');
    expect(modelCallEntries.length).toBe(1);
  });
});
