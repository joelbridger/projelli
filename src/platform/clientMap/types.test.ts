import { describe, expect, it } from 'vitest';
import { sourceRefFromRagHit } from './types';
import type { RagHit } from '@/platform/utils/tauri-commands';

function hit(sourceType: NonNullable<RagHit['sourceType']>): RagHit {
  return {
    path: `${sourceType}:source-1`,
    sourceId: `${sourceType}:source-1`,
    sourceType,
    chunkText: 'supporting text',
    score: 0.9,
    paragraphIndex: 0,
  };
}

describe('sourceRefFromRagHit', () => {
  it('preserves new external connector source kinds', () => {
    expect(sourceRefFromRagHit(hit('box')).kind).toBe('box');
    expect(sourceRefFromRagHit(hit('jotform')).kind).toBe('jotform');
    expect(sourceRefFromRagHit(hit('sharefile')).kind).toBe('sharefile');
    expect(sourceRefFromRagHit(hit('zocks')).kind).toBe('zocks');
    expect(sourceRefFromRagHit(hit('addepar')).kind).toBe('addepar');
  });
});
