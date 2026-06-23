// tests/unit/clientMap/completeness.test.ts
import { describe, it, expect } from 'vitest';
import { deriveCompleteness } from '@/platform/clientMap/completeness';
import type { ClientMapSection, ClientMapItem } from '@/platform/clientMap/types';

const known = (id: string): ClientMapItem => ({ id, text: id, origin: 'ai', isAssumption: false, sources: [{ kind: 'document', ref: '/f', snippet: 's' }], updatedAt: 't' });
const assumed = (id: string): ClientMapItem => ({ id, text: id, origin: 'ai', isAssumption: true, sources: [], updatedAt: 't' });
const sec = (items: ClientMapItem[]): ClientMapSection => ({ id: 's', kind: 'core', key: 'standing', title: 'T', items });

describe('deriveCompleteness', () => {
  it('is thin with fewer than three known facts', () => {
    expect(deriveCompleteness([sec([known('a'), known('b')])], []).level).toBe('thin');
  });
  it('is thin when assumptions outnumber known facts', () => {
    expect(deriveCompleteness([sec([known('a'), known('b'), known('c'), assumed('x'), assumed('y'), assumed('z'), assumed('w')])], []).level).toBe('thin');
  });
  it('is getting-there with a moderate base', () => {
    expect(deriveCompleteness([sec([known('a'), known('b'), known('c'), known('d'), known('e')])], ['ask one']).level).toBe('getting-there');
  });
  it('is solid with a strong, low-assumption, low-gap base', () => {
    const items = Array.from({ length: 9 }, (_, i) => known(`k${i}`));
    expect(deriveCompleteness([sec(items)], []).level).toBe('solid');
  });
  it('routes items into know vs assuming and passes ask through', () => {
    const r = deriveCompleteness([sec([known('a'), assumed('b')])], ['what is the deadline?']);
    expect(r.know.map((i) => i.id)).toEqual(['a']);
    expect(r.assuming.map((i) => i.id)).toEqual(['b']);
    expect(r.ask).toEqual(['what is the deadline?']);
  });
});
