// tests/unit/clientMap/generator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';

const retrieveMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: retrieveMock },
  isMemoryEnabled: vi.fn(() => true),
}));
vi.mock('@/platform/rag/workspaceCommand', () => ({
  buildWorkspaceContextBlock: (hits: RagHit[]) => (hits.length === 0 ? '' : '<workspace_context>ctx</workspace_context>'),
}));
vi.mock('@/platform/clientMap/provider', () => ({
  buildProviderForClientMap: async () => ({
    sendMessage: sendMock,
    getMetadata: () => ({ model: 'test' }),
  }),
}));

import { buildClientMap } from '@/platform/clientMap/generator';
import { CLIENT_MAP_SECTION_ITEM_CAP } from '@/platform/clientMap/updater';

const hit = (path: string, text: string): RagHit => ({ path, chunkText: text, score: 0.9, paragraphIndex: 0, id: `${path}#0`, sourceId: path, matterId: 'm1' });
const distinctFacts = [
  'Roth conversion window opens in November.',
  'Susan has a 403b through the school district.',
  'Robert receives consulting income quarterly.',
  'College funding is complete for both children.',
  'The household keeps cash reserves at Ally.',
  'Estate documents were last signed in 2018.',
  'The taxable brokerage account holds concentrated stock.',
  'Umbrella insurance renews every September.',
  'The mortgage rate is fixed at 3.1 percent.',
  'Charitable giving runs through a donor advised fund.',
  'The investment policy statement uses moderate risk.',
  'The next review meeting is scheduled for April.',
  'Beneficiary forms need confirmation after the rollover.',
  'The emergency fund target is nine months.',
  'Long term care coverage was declined in 2021.',
  'The family cabin is owned through an LLC.',
  'The custodial account belongs to Maya.',
  'Tax estimates are paid from the operating account.',
  'The trust names Susan as successor trustee.',
  'The pension election is single life with survivor option.',
];

beforeEach(() => {
  retrieveMock.mockReset();
  sendMock.mockReset();
});

describe('buildClientMap', () => {
  it('retrieves with matter scope only (never allMatters)', async () => {
    retrieveMock.mockResolvedValue([hit('/a.docx', 'fact')]);
    sendMock.mockResolvedValue({ content: JSON.stringify({ items: [{ text: 'Acme case', sourceNumbers: [1], assumption: false }] }) });
    await buildClientMap('m1');
    for (const call of retrieveMock.mock.calls) {
      const scope = call[2] as RetrievalScope;
      expect(scope).toEqual({ kind: 'matter', matterId: 'm1' });
    }
  });

  it('maps source numbers back to RagHit sources and flags unsourced items as assumptions', async () => {
    retrieveMock.mockResolvedValue([hit('/a.docx', 'fact one')]);
    sendMock.mockResolvedValue({
      content: JSON.stringify({ items: [
        { text: 'Sourced fact', sourceNumbers: [1], assumption: false },
        { text: 'Guessed fact', sourceNumbers: [], assumption: false },
      ] }),
    });
    const map = await buildClientMap('m1');
    const items = map.sections.flatMap((s) => s.items);
    const sourced = items.find((i) => i.text === 'Sourced fact')!;
    expect(sourced.sources[0].ref).toBe('/a.docx');
    expect(sourced.isAssumption).toBe(false);
    const guessed = items.find((i) => i.text === 'Guessed fact')!;
    expect(guessed.isAssumption).toBe(true); // no source numbers => assumption
  });

  it('caps generated section items on the first build', async () => {
    retrieveMock.mockResolvedValue([hit('/a.docx', 'fact one')]);
    sendMock.mockImplementation((msg: string, opts?: { systemPrompt?: string }) => {
      const isGapCall = msg.toLowerCase().includes('gap') || (opts?.systemPrompt ?? '').toLowerCase().includes('question');
      if (isGapCall) return Promise.resolve({ content: JSON.stringify({ questions: [] }) });
      return Promise.resolve({
        content: JSON.stringify({
          items: distinctFacts.map((fact) => ({
            text: fact,
            sourceNumbers: [1],
            assumption: false,
          })),
        }),
      });
    });

    const map = await buildClientMap('m1');

    expect(map.sections[0].items).toHaveLength(CLIENT_MAP_SECTION_ITEM_CAP);
  });

  it('returns an empty-but-valid map when nothing is indexed', async () => {
    retrieveMock.mockResolvedValue([]);
    const map = await buildClientMap('m1');
    expect(map.matterId).toBe('m1');
    expect(map.sections.flatMap((s) => s.items)).toEqual([]);
    expect(map.lastBuiltAt).not.toBe('');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('tags gap questions with their target section and defaults unknown sections to standing', async () => {
    retrieveMock.mockResolvedValue([hit('/a.docx', 'fact')]);
    sendMock.mockImplementation((msg: string, opts?: { systemPrompt?: string }) => {
      const isGapCall = msg.toLowerCase().includes('gap') || (opts?.systemPrompt ?? '').toLowerCase().includes('question');
      if (isGapCall) {
        return Promise.resolve({ content: JSON.stringify({ questions: [
          { text: 'What is the filing deadline?', section: 'upcoming' },
          { text: 'Who signed the lease?', section: 'bogus' },
        ] }) });
      }
      return Promise.resolve({ content: JSON.stringify({ items: [] }) });
    });
    const map = await buildClientMap('m1');
    expect(map.completeness.ask).toContainEqual({ text: 'What is the filing deadline?', sectionKey: 'upcoming' });
    // Unknown / invalid section names fall back to 'standing'.
    expect(map.completeness.ask).toContainEqual({ text: 'Who signed the lease?', sectionKey: 'standing' });
  });

  it('still accepts a plain list of gap question strings (defaults them to standing)', async () => {
    retrieveMock.mockResolvedValue([hit('/a.docx', 'fact')]);
    sendMock.mockImplementation((msg: string, opts?: { systemPrompt?: string }) => {
      const isGapCall = msg.toLowerCase().includes('gap') || (opts?.systemPrompt ?? '').toLowerCase().includes('question');
      if (isGapCall) {
        return Promise.resolve({ content: JSON.stringify({ questions: ['Is there a counterclaim?'] }) });
      }
      return Promise.resolve({ content: JSON.stringify({ items: [] }) });
    });
    const map = await buildClientMap('m1');
    expect(map.completeness.ask).toContainEqual({ text: 'Is there a counterclaim?', sectionKey: 'standing' });
  });
});
