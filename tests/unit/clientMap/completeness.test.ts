// tests/unit/clientMap/completeness.test.ts
import { describe, it, expect } from 'vitest';
import { deriveCompleteness } from '@/features/matters/clientMap/completeness';
import type { ClientMapSection, ClientMapItem, GapQuestion } from '@/platform/clientMap/types';

const known = (id: string): ClientMapItem => ({ id, text: id, origin: 'ai', isAssumption: false, sources: [{ kind: 'document', ref: '/f', snippet: 's' }], updatedAt: 't' });
const assumed = (id: string): ClientMapItem => ({ id, text: id, origin: 'ai', isAssumption: true, sources: [], updatedAt: 't' });
const sec = (items: ClientMapItem[]): ClientMapSection => ({ id: 's', kind: 'core', key: 'money', title: 'T', items });
const gap = (text: string, sectionKey: string): GapQuestion => ({ text, sectionKey });

describe('deriveCompleteness', () => {
  it('is thin with fewer than three known facts', () => {
    expect(deriveCompleteness([sec([known('a'), known('b')])], []).level).toBe('thin');
  });
  it('is thin when assumptions outnumber known facts', () => {
    expect(deriveCompleteness([sec([known('a'), known('b'), known('c'), assumed('x'), assumed('y'), assumed('z'), assumed('w')])], []).level).toBe('thin');
  });
  it('is getting-there with a moderate base', () => {
    expect(deriveCompleteness([sec([known('a'), known('b'), known('c'), known('d'), known('e')])], [gap('ask one', 'money')]).level).toBe('getting-there');
  });
  it('is solid with a strong, low-assumption, low-gap base', () => {
    const items = Array.from({ length: 9 }, (_, i) => known(`k${i}`));
    expect(deriveCompleteness([sec(items)], []).level).toBe('solid');
  });
  it('routes items into know vs assuming and passes the section-targeted ask list through', () => {
    const r = deriveCompleteness([sec([known('a'), assumed('b')])], [gap('what is the deadline?', 'followups')]);
    expect(r.know.map((i) => i.id)).toEqual(['a']);
    expect(r.assuming.map((i) => i.id)).toEqual(['b']);
    expect(r.ask).toEqual([{ text: 'what is the deadline?', sectionKey: 'followups' }]);
  });
});
