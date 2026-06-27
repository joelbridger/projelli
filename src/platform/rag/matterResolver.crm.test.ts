/**
 * Tests for the Wealthbox household -> matter resolution logic:
 *   - normalizeClientName: deterministic, handles edge cases
 *   - resolveMatterForHousehold: reuse / link / create priority order, guard
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeClientName,
  resolveFolderForHousehold,
  resolveMatterForHousehold,
} from './matterResolver';
import type { Matter } from '@/platform/types/matter';

/** Minimal Matter fixture — only required fields + optional CRM keys. */
function makeMatter(
  overrides: Pick<Matter, 'id' | 'name' | 'client'> & Partial<Matter>,
): Matter {
  return {
    folderPaths: [],
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────
// normalizeClientName
// ────────────────────────────────────────────────────────────

describe('normalizeClientName', () => {
  it('lowercases and trims surrounding whitespace', () => {
    expect(normalizeClientName('  SMITH, BOB  ')).toBe('smith, bob');
  });

  it('collapses internal whitespace to a single space', () => {
    expect(normalizeClientName('Jones,   Alice')).toBe('jones, alice');
  });

  it('strips surrounding double quotes', () => {
    expect(normalizeClientName('"Ellison, Robert"')).toBe('ellison, robert');
  });

  it('strips surrounding single quotes', () => {
    expect(normalizeClientName("'Smith, Bob'")).toBe('smith, bob');
  });

  it('preserves internal punctuation (commas, ampersands)', () => {
    expect(normalizeClientName('Ellison, Robert & Margaret'))
      .toBe('ellison, robert & margaret');
  });

  it('handles an already-normalised string idempotently', () => {
    expect(normalizeClientName('ellison, robert & margaret'))
      .toBe('ellison, robert & margaret');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeClientName('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeClientName('   ')).toBe('');
  });
});

// ────────────────────────────────────────────────────────────
// resolveMatterForHousehold
// ────────────────────────────────────────────────────────────

describe('resolveMatterForHousehold', () => {
  // (a) name matches a file-client with no CRM keys → link
  it('(a) links to an existing file-client whose name matches', () => {
    const matters: Matter[] = [
      makeMatter({
        id: 'm1',
        name: 'Ellison, Robert & Margaret',
        client: 'Ellison, Robert & Margaret',
      }),
    ];
    const result = resolveMatterForHousehold(
      matters,
      { id: 'wb-123', name: 'Ellison, Robert & Margaret' },
    );
    expect(result.action).toBe('link');
    expect(result.matterId).toBe('m1');
  });

  // (a2) match via client field when name differs
  it('(a) links when the household name matches the matter client field', () => {
    const matters: Matter[] = [
      makeMatter({ id: 'm1', name: 'Estate Planning', client: 'Smith, Bob' }),
    ];
    const result = resolveMatterForHousehold(matters, { id: 'wb-456', name: 'Smith, Bob' });
    expect(result.action).toBe('link');
    expect(result.matterId).toBe('m1');
  });

  // (a3) case-insensitive matching
  it('(a) matches names case-insensitively', () => {
    const matters: Matter[] = [
      makeMatter({ id: 'm1', name: 'SMITH, BOB', client: 'SMITH, BOB' }),
    ];
    const result = resolveMatterForHousehold(matters, { id: 'wb-1', name: 'Smith, Bob' });
    expect(result.action).toBe('link');
    expect(result.matterId).toBe('m1');
  });

  // (b) no name match → create
  it('(b) creates a new matter when no name matches', () => {
    const matters: Matter[] = [
      makeMatter({ id: 'm1', name: 'Jones, Alice', client: 'Jones, Alice' }),
    ];
    const result = resolveMatterForHousehold(matters, { id: 'wb-999', name: 'Smith, Bob' });
    expect(result.action).toBe('create');
    expect(result.name).toBe('Smith, Bob');
    expect(result.matterId).toBe('');
  });

  // (b2) empty matters list → create
  it('(b) creates when there are no existing matters', () => {
    const result = resolveMatterForHousehold([], { id: 'wb-1', name: 'Hollings Family' });
    expect(result.action).toBe('create');
    expect(result.name).toBe('Hollings Family');
  });

  // (c) already linked by key → reuse (even if name also matches)
  it('(c) reuses a matter already linked to the household by key', () => {
    const matters: Matter[] = [
      makeMatter({
        id: 'm1',
        name: 'Jones, Alice',
        client: 'Jones, Alice',
        crmHouseholdKeys: ['wb-777'],
      }),
    ];
    const result = resolveMatterForHousehold(matters, { id: 'wb-777', name: 'Jones, Alice' });
    expect(result.action).toBe('reuse');
    expect(result.matterId).toBe('m1');
  });

  // (d) name matches but matter is already CRM-linked to a DIFFERENT household → create
  it('(d) creates instead of cross-linking when the name-match matter already has a CRM key', () => {
    const matters: Matter[] = [
      makeMatter({
        id: 'm1',
        name: 'Jones, Alice',
        client: 'Jones, Alice',
        crmHouseholdKeys: ['wb-111'],
      }),
    ];
    // Different household id — should NOT link to m1
    const result = resolveMatterForHousehold(matters, { id: 'wb-222', name: 'Jones, Alice' });
    expect(result.action).toBe('create');
  });

  // (e) AMBIGUOUS name match — two eligible file-clients share the same normalized
  // name → must NOT auto-attach to either (would corrupt the wrong client); create new.
  it('(e) creates instead of linking when two file-clients share the same normalized name', () => {
    const matters: Matter[] = [
      makeMatter({ id: 'm1', name: 'Smith, Bob', client: 'Smith, Bob' }),
      makeMatter({ id: 'm2', name: 'SMITH, BOB', client: 'SMITH, BOB' }),
    ];
    const result = resolveMatterForHousehold(matters, { id: 'wb-dup', name: 'Smith, Bob' });
    expect(result.action).toBe('create');
    expect(result.matterId).toBe('');
  });

  // (e2) one unambiguous match among other non-matching matters still links cleanly.
  it('(e) links to the single unambiguous match even when other non-matching matters exist', () => {
    const matters: Matter[] = [
      makeMatter({ id: 'm1', name: 'Jones, Alice', client: 'Jones, Alice' }),
      makeMatter({ id: 'm2', name: 'Smith, Bob', client: 'Smith, Bob' }),
    ];
    const result = resolveMatterForHousehold(matters, { id: 'wb-1', name: 'Smith, Bob' });
    expect(result.action).toBe('link');
    expect(result.matterId).toBe('m2');
  });

  // (e3) AMBIGUOUS even when one of the same-name matters is already CRM-linked.
  // The name "Smith, Bob" is shared by 2 existing clients, so it cannot reliably
  // identify which one this household is — the already-linked twin must NOT be
  // filtered out before judging ambiguity, or we'd silently link to the file-client
  // and risk attaching the household to the wrong "Smith". Ambiguity → create.
  it('(e) creates (not links) when two matters share a name and one is already CRM-linked', () => {
    const matters: Matter[] = [
      makeMatter({ id: 'm-linked', name: 'Smith, Bob', client: 'Smith, Bob', crmHouseholdKeys: ['wb-9'] }),
      makeMatter({ id: 'm-file', name: 'Smith, Bob', client: 'Smith, Bob' }),
    ];
    const result = resolveMatterForHousehold(matters, { id: 'wb-new', name: 'Smith, Bob' });
    expect(result.action).toBe('create');
    expect(result.matterId).toBe('');
  });

  // Guard: two households with the same name must not both link to the same matter
  it('does not link two households to the same matter when claimedMatterIds is supplied', () => {
    const matters: Matter[] = [
      makeMatter({ id: 'm1', name: 'Jones, Alice', client: 'Jones, Alice' }),
    ];

    // First household successfully links to m1.
    const first = resolveMatterForHousehold(matters, { id: 'wb-1', name: 'Jones, Alice' });
    expect(first.action).toBe('link');
    expect(first.matterId).toBe('m1');

    // Caller marks m1 as claimed.
    const claimed = new Set([first.matterId]);

    // Second household with the same name should NOT also link to m1.
    const second = resolveMatterForHousehold(
      matters,
      { id: 'wb-2', name: 'Jones, Alice' },
      claimed,
    );
    expect(second.action).toBe('create');
  });

  // reuse takes priority over name-match (key wins)
  it('returns reuse when household is already linked, even if no-key matters also match by name', () => {
    const matters: Matter[] = [
      makeMatter({ id: 'm-linked', name: 'Smith, Bob', client: 'Smith, Bob', crmHouseholdKeys: ['wb-42'] }),
      makeMatter({ id: 'm-file',   name: 'Smith, Bob', client: 'Smith, Bob' }),
    ];
    const result = resolveMatterForHousehold(matters, { id: 'wb-42', name: 'Smith, Bob' });
    expect(result.action).toBe('reuse');
    expect(result.matterId).toBe('m-linked');
  });
});

// ────────────────────────────────────────────────────────────
// resolveFolderForHousehold
// ────────────────────────────────────────────────────────────

describe('resolveFolderForHousehold', () => {
  it('returns the one unambiguous matching workspace folder', () => {
    expect(
      resolveFolderForHousehold(
        [
          '/workspace/Clients/Ellison, Robert & Margaret',
          '/workspace/Clients/Hollings Family',
          '/workspace/Clients/Nakamura, David & Susan',
        ],
        { id: 'wb-ellison', name: 'Ellison, Robert & Margaret' },
      ),
    ).toBe('/workspace/Clients/Ellison, Robert & Margaret');
  });

  it('returns null when two folders share the same normalized leaf name', () => {
    expect(
      resolveFolderForHousehold(
        [
          '/workspace/Clients/Hollings Family',
          '/workspace/Archive/HOLLINGS FAMILY',
        ],
        { id: 'wb-hollings', name: 'Hollings Family' },
      ),
    ).toBeNull();
  });

  it('normalizes punctuation and whitespace in demo star household names', () => {
    expect(
      resolveFolderForHousehold(
        ['/workspace/Clients/Ellison, Robert & Margaret'],
        { id: 'wb-ellison', name: '  "Ellison, Robert & Margaret"  ' },
      ),
    ).toBe('/workspace/Clients/Ellison, Robert & Margaret');
  });

  it('skips an already-claimed matching folder', () => {
    expect(
      resolveFolderForHousehold(
        ['/workspace/Clients/Nakamura, David & Susan'],
        { id: 'wb-nakamura', name: 'Nakamura, David & Susan' },
        new Set(['/workspace/Clients/Nakamura, David & Susan']),
      ),
    ).toBeNull();
  });
});
