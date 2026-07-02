// tests/unit/coedit/textDiff.test.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyTextDiff } from '@/platform/firm/coedit/textDiff';

function run(oldText: string, newText: string): string {
  const doc = new Y.Doc();
  const t = doc.getText('t');
  t.insert(0, oldText);
  applyTextDiff(doc, t, oldText, newText);
  return t.toString();
}

describe('applyTextDiff', () => {
  it('converges to newText for insert/delete/replace/append/prepend/noop', () => {
    const cases: Array<[string, string]> = [
      ['hello', 'hello world'],  // append
      ['hello', 'hi'],           // replace tail
      ['world', 'hello world'],  // prepend
      ['abcdef', 'abXYef'],      // middle replace
      ['abc', 'abc'],            // no-op
      ['abc', ''],               // full delete
      ['', 'abc'],               // full insert
      ['the quick fox', 'the slow fox'], // middle word
    ];
    for (const [a, b] of cases) {
      expect(run(a, b)).toBe(b);
    }
  });

  it('a no-op edit produces no Y.Text change (no new update)', () => {
    const doc = new Y.Doc();
    const t = doc.getText('t'); t.insert(0, 'abc');
    let updates = 0; doc.on('update', () => { updates++; });
    applyTextDiff(doc, t, 'abc', 'abc');
    expect(updates).toBe(0);
  });

  it('two replicas editing different ends of the same text converge with both edits', () => {
    const base = new Y.Doc(); base.getText('t').insert(0, 'middle');
    const a = new Y.Doc(); Y.applyUpdate(a, Y.encodeStateAsUpdate(base));
    const b = new Y.Doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(base));
    applyTextDiff(a, a.getText('t'), 'middle', 'PREmiddle');   // a prepends
    applyTextDiff(b, b.getText('t'), 'middle', 'middlePOST');  // b appends
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getText('t').toString()).toBe(b.getText('t').toString());
    expect(a.getText('t').toString()).toContain('PRE');
    expect(a.getText('t').toString()).toContain('POST');
  });
});
