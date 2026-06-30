/**
 * Connector-access — provenance recognition flowing through the Ask pipeline.
 *
 * Locks the wiring that turns a recognized RightCapital/Jump export (per
 * docs/strategy/2026-06-29-connector-access-options-rightcapital-jump.md) into
 * an honest, dated, de-duplicated citation + an answer that knows the source is
 * a point-in-time snapshot. Pure helpers only (no React).
 */
import { describe, it, expect } from 'vitest';
import {
  recognizeHit,
  dedupeRecognizedHits,
  bindAnswerCitations,
} from '@/features/ask/askHelpers';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import type { RagHit } from '@/platform/utils/tauri-commands';

function hit(partial: Partial<RagHit>): RagHit {
  return { path: 'doc.md', chunkText: 'x', score: 1, paragraphIndex: 0, ...partial };
}

describe('recognizeHit', () => {
  it('recognizes a RightCapital plan PDF hit', () => {
    const p = recognizeHit(hit({ path: 'clients/Caldwell/RightCapital-Plan-2026-06-12.pdf', sourceType: 'pdf' }));
    expect(p?.tool).toBe('rightcapital');
    expect(p?.exportedAt).toBe('2026-06-12');
  });
  it('returns null for an ordinary document hit', () => {
    expect(recognizeHit(hit({ path: 'clients/x/1040.pdf', sourceType: 'pdf', chunkText: 'Form 1040' }))).toBeNull();
  });
});

describe('dedupeRecognizedHits', () => {
  it('collapses the same Jump note arriving via CRM and as a SharePoint PDF', () => {
    const fromCrm = hit({
      path: 'crm:note:1', sourceId: 'crm:note:1', sourceType: 'crm', matterId: 'm1',
      chunkText: 'Meeting Summary\nAction Items: open a Roth\njump.ai\nMeeting date: 2026-06-01',
    });
    const fromPdf = hit({
      path: 'Jump-Note-2026-06-01.pdf', sourceId: 'onedrive:d:1', sourceType: 'onedrive', matterId: 'm1',
      chunkText: 'meeting notes', paragraphIndex: 0,
    });
    const ordinary = hit({ path: 'misc.md' });
    const out = dedupeRecognizedHits([fromCrm, fromPdf, ordinary]);
    expect(out).toHaveLength(2); // one Jump note + the ordinary doc
    expect(out[0]).toBe(fromCrm); // keeps the first (most relevant) occurrence
  });
  it('keeps recognized exports from different clients separate', () => {
    const a = hit({ path: 'Jump-Note-2026-06-01.pdf', sourceType: 'pdf', matterId: 'm1' });
    const b = hit({ path: 'Jump-Note-2026-06-01.pdf', sourceType: 'pdf', matterId: 'm2' });
    expect(dedupeRecognizedHits([a, b])).toHaveLength(2);
  });
  it('leaves ordinary hits untouched', () => {
    const hits = [hit({ path: 'a.md' }), hit({ path: 'b.md' })];
    expect(dedupeRecognizedHits(hits)).toHaveLength(2);
  });
});

describe('bindAnswerCitations attaches provenance', () => {
  it('carries the recognized export onto the citation', () => {
    const h = hit({
      path: 'RightCapital-Plan-2026-06-12.pdf', sourceType: 'pdf', pageNumber: 1, paragraphIndex: 0,
      id: 'chunk-1', matterId: 'm1', chunkText: 'Probability of success 87%',
    });
    const { citations } = bindAnswerCitations(
      'Their plan is on track [RightCapital-Plan-2026-06-12.pdf page 1].',
      [h],
      'm1',
    );
    expect(citations).toHaveLength(1);
    expect(citations[0]!.provenance?.tool).toBe('rightcapital');
    expect(citations[0]!.provenance?.exportedAt).toBe('2026-06-12');
  });
  it('leaves an ordinary citation without provenance', () => {
    const h = hit({ path: 'notes.md', paragraphIndex: 2, id: 'c', matterId: 'm1', chunkText: 'plain note' });
    const { citations } = bindAnswerCitations('A point [notes.md paragraph 2].', [h], 'm1');
    expect(citations[0]?.provenance).toBeUndefined();
  });
});

describe('buildWorkspaceContextBlock — freshness annotation', () => {
  it('annotates a recognized export and adds snapshot guidance', () => {
    const block = buildWorkspaceContextBlock([
      hit({ path: 'RightCapital-Plan-2026-06-12.pdf', sourceType: 'pdf', pageNumber: 1, chunkText: 'figures' }),
    ]);
    expect(block).toContain('source: RightCapital plan');
    expect(block).toContain('point-in-time snapshot');
    expect(block).toContain('reads the files they export');
  });
  it('does not annotate or add guidance for ordinary sources', () => {
    const block = buildWorkspaceContextBlock([hit({ path: 'memo.md', chunkText: 'hello' })]);
    expect(block).not.toContain('source:');
    expect(block).not.toContain('point-in-time snapshot');
  });
});
