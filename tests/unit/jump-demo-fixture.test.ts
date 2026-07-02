import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recognizeProvenance } from '@/platform/rag/sourceProvenance';

const FIXTURE = join(
  __dirname,
  '../../scripts/demo/staged-live-client/Brennan, Thomas & Karen',
  'Jump Meeting Recap 2026-06-24 - Brennan.txt',
);

describe('Jump demo fixture', () => {
  it('is recognized as a high-confidence Jump meeting note with its export date', () => {
    const text = readFileSync(FIXTURE, 'utf8');
    const p = recognizeProvenance({ path: FIXTURE, text, sourceType: 'txt' });
    expect(p?.tool).toBe('jump');
    expect(p?.kind).toBe('meeting-note');
    expect(p?.toolLabel).toBe('Jump');
    expect(p?.confidence).toBe('high');
    expect(p?.exportedAt).toBe('2026-06-24');
  });

  it('still recognizes (medium confidence) from body branding alone, if a user renames the file', () => {
    const text = readFileSync(FIXTURE, 'utf8');
    const p = recognizeProvenance({ path: 'renamed-recap.txt', text, sourceType: 'txt' });
    expect(p?.tool).toBe('jump');
    expect(p?.confidence).toBe('medium');
  });
});
