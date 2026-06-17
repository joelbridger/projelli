// Snapshot test for en.json structure. Locks the namespace shape and key
// inventory so that future PRs adding or removing keys show up clearly in
// review diffs. The translation pipeline (Group IV) and locale detection
// (Group VI) both depend on this shape, so unintentional drift here would
// silently break the cascade.
//
// Update procedure when keys legitimately change:
//   1. Add or remove keys via t() calls in components.
//   2. Add or remove the key in src/locales/en.json.
//   3. Run `npm run test -- en-json-snapshot --update` to refresh the snapshot.
//   4. Re-run `npm run translate-i18n` to propagate to es.json + de.json.
import { describe, it, expect } from 'vitest';
import en from '@/locales/en.json';

type JsonValue = string | { [key: string]: JsonValue };

function flatten(obj: Record<string, JsonValue>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      out.push(...flatten(v as Record<string, JsonValue>, key));
    } else {
      out.push(key);
    }
  }
  return out;
}

function namespaceCounts(obj: Record<string, JsonValue>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [ns, val] of Object.entries(obj)) {
    if (typeof val === 'object' && val !== null) {
      counts[ns] = flatten(val as Record<string, JsonValue>).length;
    } else {
      counts[ns] = 1;
    }
  }
  return counts;
}

describe('en.json structure snapshot', () => {
  it('matches the expected namespace inventory', () => {
    const counts = namespaceCounts(en as Record<string, JsonValue>);
    expect(counts).toMatchInlineSnapshot(`
      {
        "ai": 25,
        "analysis": 10,
        "app": 2,
        "audio": 1,
        "chat": 12,
        "citation": 3,
        "common": 25,
        "editor": 14,
        "firm": 110,
        "layout": 40,
        "mail": 5,
        "marketplace": 14,
        "matter": 96,
        "media": 77,
        "memory": 3,
        "model-download": 9,
        "onboarding": 65,
        "plugins": 4,
        "privacy": 11,
        "quick-open": 1,
        "research": 11,
        "search": 6,
        "settings": 163,
        "shortcuts-overlay": 2,
        "tts": 1,
        "updater": 2,
        "vault": 49,
        "version": 17,
        "whats-new": 4,
        "whiteboard": 1,
        "workflow": 29,
        "workspace": 12,
      }
    `);
  });

  it('locks the total leaf-key count', () => {
    const flat = flatten(en as Record<string, JsonValue>);
    // 824 = 814 + the 10 new settings.privacy.design-partner.* keys (WS6, design-partner diagnostics).
    expect(flat.length).toBe(824);
  });

  it('every namespace key follows lowercase kebab-case', () => {
    const flat = flatten(en as Record<string, JsonValue>);
    const stripPlural = (segment: string): string => {
      for (const suffix of ['_one', '_other', '_few', '_many', '_zero', '_two']) {
        if (segment.endsWith(suffix)) {
          return segment.slice(0, -suffix.length);
        }
      }
      return segment;
    };
    const segmentRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    const violations: string[] = [];
    for (const key of flat) {
      for (const seg of key.split('.')) {
        if (!segmentRe.test(stripPlural(seg))) {
          violations.push(`${key} (segment: ${seg})`);
          break;
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('every leaf value is a non-empty string', () => {
    const stack: Array<[string, JsonValue]> = Object.entries(en).map(
      ([k, v]) => [k, v as JsonValue],
    );
    while (stack.length > 0) {
      const [key, val] = stack.pop()!;
      if (typeof val === 'object' && val !== null) {
        for (const [k, v] of Object.entries(val)) {
          stack.push([`${key}.${k}`, v as JsonValue]);
        }
      } else {
        expect(typeof val, `key ${key} should be string`).toBe('string');
        expect((val as string).length, `key ${key} should not be empty`).toBeGreaterThan(0);
      }
    }
  });

  it('contains no em dashes (rule: NO em dashes anywhere)', () => {
    const stack: Array<[string, JsonValue]> = Object.entries(en).map(
      ([k, v]) => [k, v as JsonValue],
    );
    const offenders: string[] = [];
    while (stack.length > 0) {
      const [key, val] = stack.pop()!;
      if (typeof val === 'object' && val !== null) {
        for (const [k, v] of Object.entries(val)) {
          stack.push([`${key}.${k}`, v as JsonValue]);
        }
      } else if (typeof val === 'string' && val.includes('—')) {
        offenders.push(key);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('plural keys come in matching _one + _other pairs', () => {
    const flat = flatten(en as Record<string, JsonValue>);
    const oneKeys = flat.filter((k) => k.endsWith('_one'));
    const otherKeys = new Set(flat.filter((k) => k.endsWith('_other')));
    const missing: string[] = [];
    for (const oneKey of oneKeys) {
      const base = oneKey.slice(0, -'_one'.length);
      if (!otherKeys.has(`${base}_other`)) {
        missing.push(oneKey);
      }
    }
    expect(missing, 'every _one key needs a matching _other').toEqual([]);
  });
});
