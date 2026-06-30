/**
 * Connector-access — provenance recognition flowing through the Ask pipeline.
 *
 * Locks the wiring that turns a recognized RightCapital/Jump export (per
 * docs/strategy/2026-06-29-connector-access-options-rightcapital-jump.md) into
 * an honest, dated, de-duplicated citation + an answer that knows the source is
 * a point-in-time snapshot. Pure helpers only (no React).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  recognizeHit,
  dedupeRecognizedHits,
  bindAnswerCitations,
} from '@/features/ask/askHelpers';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { EXTERNAL_EXPORT_CONSENT_KEY } from '@/platform/settings/schema';
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
  it('keeps every page/section of one plan (P2: never drops later-page evidence)', () => {
    const base = { path: 'clients/Caldwell/RightCapital-Plan-2026-06-12.pdf', sourceType: 'pdf' as const, matterId: 'm1' };
    const p1 = hit({ ...base, pageNumber: 1, paragraphIndex: 0, chunkText: 'Retirement projection on page one' });
    const p2 = hit({ ...base, pageNumber: 2, paragraphIndex: 1, chunkText: 'Tax strategy detail on page two' });
    const p3 = hit({ ...base, pageNumber: 3, paragraphIndex: 2, chunkText: 'Estate notes on page three' });
    expect(dedupeRecognizedHits([p1, p2, p3])).toHaveLength(3);
  });
  it('collapses a truly identical export chunk arriving via two paths', () => {
    // The exact same plan page, same content, synced into two folders.
    const a = hit({ path: 'folderA/RightCapital-Plan-2026-06-12.pdf', sourceType: 'pdf', matterId: 'm1', pageNumber: 1, chunkText: 'Probability of success 87%' });
    const b = hit({ path: 'folderB/RightCapital-Plan-2026-06-12.pdf', sourceType: 'pdf', matterId: 'm1', pageNumber: 1, chunkText: 'Probability of success 87%' });
    const out = dedupeRecognizedHits([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(a); // keeps the first (most relevant) occurrence
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

describe('buildWorkspaceContextBlock — freshness annotation + consent gate', () => {
  // The annotation only appears once the advisor has consented to AI-processing
  // exports; reset to the default (off) after each test.
  beforeEach(() => { useSettingsStore.getState().setSetting(EXTERNAL_EXPORT_CONSENT_KEY, true); });
  afterEach(() => { useSettingsStore.getState().setSetting(EXTERNAL_EXPORT_CONSENT_KEY, false); });

  it('annotates a recognized export and adds snapshot guidance (with consent)', () => {
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
  it('P1: withholds recognized export chunks from the model context until consent', () => {
    useSettingsStore.getState().setSetting(EXTERNAL_EXPORT_CONSENT_KEY, false);
    const block = buildWorkspaceContextBlock([
      hit({ path: 'RightCapital-Plan-2026-06-12.pdf', sourceType: 'pdf', pageNumber: 1, chunkText: 'CONFIDENTIAL plan figures' }),
      hit({ path: 'memo.md', chunkText: 'an ordinary note' }),
    ]);
    expect(block).not.toContain('CONFIDENTIAL plan figures'); // export withheld from the model
    expect(block).not.toContain('source:');
    expect(block).toContain('an ordinary note'); // ordinary sources still included
  });
  it('P1: includes the same export once consent is given', () => {
    useSettingsStore.getState().setSetting(EXTERNAL_EXPORT_CONSENT_KEY, true);
    const block = buildWorkspaceContextBlock([
      hit({ path: 'RightCapital-Plan-2026-06-12.pdf', sourceType: 'pdf', pageNumber: 1, chunkText: 'CONFIDENTIAL plan figures' }),
    ]);
    expect(block).toContain('CONFIDENTIAL plan figures');
    expect(block).toContain('source: RightCapital plan');
  });
});
