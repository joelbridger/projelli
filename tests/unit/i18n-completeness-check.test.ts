/**
 * Unit tests for `scripts/i18n-completeness-check.mjs` — the pure
 * flatten/diff/check logic. The real-file `main()` orchestration (reading
 * src/locales/*.json off disk) is exercised indirectly by `npm run
 * i18n:completeness` in the gate; these tests cover the decision logic in
 * isolation so a regression in the comparison itself fails fast.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — ESM module with no TS types, intentionally imported raw.
import * as completeness from '../../scripts/i18n-completeness-check.mjs';

const { flatten, getAtPath, diffLocale, checkCompleteness, parseAllowlist } = completeness;

describe('flatten', () => {
  it('produces dotted leaf-key paths for nested objects', () => {
    const obj = { a: { b: 'x', c: { d: 'y' } }, e: 'z' };
    expect(flatten(obj).sort()).toEqual(['a.b', 'a.c.d', 'e'].sort());
  });

  it('skips double-underscore metadata sibling keys', () => {
    const obj = { a: { b: 'x', b__sourceHash: 'abc123', b__locked: true } };
    expect(flatten(obj)).toEqual(['a.b']);
  });

  it('returns an empty array for an empty object', () => {
    expect(flatten({})).toEqual([]);
  });
});

describe('getAtPath', () => {
  const obj = { a: { b: { c: 'value' } } };

  it('resolves a nested dotted path', () => {
    expect(getAtPath(obj, 'a.b.c')).toBe('value');
  });

  it('returns undefined for a missing path', () => {
    expect(getAtPath(obj, 'a.b.missing')).toBeUndefined();
    expect(getAtPath(obj, 'x.y.z')).toBeUndefined();
  });

  it('returns undefined when traversing through a non-object', () => {
    expect(getAtPath({ a: 'string' }, 'a.b')).toBeUndefined();
  });
});

describe('diffLocale', () => {
  it('reports no gaps when every key has a non-empty string value', () => {
    const diff = diffLocale(['a.b', 'c'], { a: { b: 'hola' }, c: 'mundo' });
    expect(diff).toEqual({ missing: [], empty: [] });
  });

  it('reports a key absent from the locale as missing', () => {
    const diff = diffLocale(['a.b', 'a.c'], { a: { b: 'hola' } });
    expect(diff.missing).toEqual(['a.c']);
    expect(diff.empty).toEqual([]);
  });

  it('reports an empty-string or whitespace-only value as empty, not missing', () => {
    const diff = diffLocale(['a', 'b'], { a: '', b: '   ' });
    expect(diff.missing).toEqual([]);
    expect(diff.empty).toEqual(['a', 'b']);
  });

  it('reports a non-string value (structural mismatch) as empty', () => {
    const diff = diffLocale(['a'], { a: { nested: 'oops' } });
    expect(diff.empty).toEqual(['a']);
  });
});

describe('checkCompleteness', () => {
  const en = { matter: { title: 'Clients', scope: { manage: 'Manage clients...' } } };

  it('is ok when every locale has every source key', () => {
    const result = checkCompleteness(en, {
      de: { matter: { title: 'Mandanten', scope: { manage: 'Mandanten verwalten...' } } },
      es: { matter: { title: 'Clientes', scope: { manage: 'Gestionar clientes...' } } },
    });
    expect(result.ok).toBe(true);
    expect(result.sourceKeyCount).toBe(2);
    expect(result.results.de).toEqual({ missing: [], empty: [] });
    expect(result.results.es).toEqual({ missing: [], empty: [] });
  });

  it('is not ok when a locale is missing a key', () => {
    const result = checkCompleteness(en, {
      de: { matter: { title: 'Mandanten' } },
      es: { matter: { title: 'Clientes', scope: { manage: 'Gestionar clientes...' } } },
    });
    expect(result.ok).toBe(false);
    expect(result.results.de.missing).toEqual(['matter.scope.manage']);
    expect(result.results.es.missing).toEqual([]);
  });

  it('honors the allowlist by excluding listed keys from every locale check', () => {
    const result = checkCompleteness(
      en,
      { de: { matter: { title: 'Mandanten' } }, es: { matter: { title: 'Clientes' } } },
      new Set(['matter.scope.manage'])
    );
    expect(result.ok).toBe(true);
    expect(result.sourceKeyCount).toBe(1);
  });
});

describe('parseAllowlist', () => {
  it('accepts a plain object and returns its keys as a Set', () => {
    const set = parseAllowlist({ 'a.b': 'reason', 'c.d': 'reason 2' });
    expect(set).toEqual(new Set(['a.b', 'c.d']));
  });

  it('rejects an array', () => {
    expect(() => parseAllowlist(['a.b'])).toThrow(/must be a JSON object/);
  });

  it('rejects null', () => {
    expect(() => parseAllowlist(null)).toThrow(/must be a JSON object/);
  });
});
