// Unit tests for src/platform/utils/audit-export.ts
//
// Focus: serialization correctness (CSV RFC 4180 escaping, JSON shape),
// filename format, filter composition. Download side effect is covered by
// spying on the document / URL APIs to avoid real DOM mutation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AuditEntry } from '@/platform/types/audit';
import {
  entriesToJSON,
  entriesToCSV,
  buildExportFilename,
  uniqueModels,
  uniqueMatterScopes,
  filterEntries,
  triggerDownload,
  downloadAuditJSON,
  downloadAuditCSV,
  asRecord,
  CSV_COLUMNS,
} from '@/features/audit/audit-export';

function makeEntry(partial: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'audit_1',
    timestamp: '2026-04-16T10:00:00.000Z',
    action: 'model_call',
    description: 'Test entry',
    model: 'claude-sonnet-4',
    inputs: {},
    outputs: {},
    userDecision: undefined,
    metadata: {},
    ...partial,
  };
}

describe('audit-export / entriesToJSON', () => {
  it('pretty-prints with 2-space indentation', () => {
    const json = entriesToJSON([makeEntry()]);
    // Pretty-printed JSON has newlines between fields.
    expect(json).toContain('\n');
    // Top-level array → object → property is nested 2 levels deep, so the
    // "id" property line is indented by 4 spaces (2 indent steps × 2 spaces).
    // Verify 2-space step: no tabs, not 4-per-step (which would indent "id" by 8).
    expect(json).toMatch(/\n    "id":/);
    expect(json).not.toMatch(/\n        "id":/);
    expect(json).not.toMatch(/\n\t"id":/);
  });

  it('round-trips through JSON.parse', () => {
    const entries = [makeEntry(), makeEntry({ id: 'audit_2' })];
    const parsed = JSON.parse(entriesToJSON(entries));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe('audit_1');
    expect(parsed[1].id).toBe('audit_2');
  });

  it('can include integrity status with JSON export', () => {
    const parsed = JSON.parse(
      entriesToJSON([makeEntry()], { status: 'verified', checked: 1 }),
    );

    expect(parsed.integrity).toEqual({ status: 'verified', checked: 1 });
    expect(parsed.entries).toHaveLength(1);
  });

  it('emits [] for empty input', () => {
    expect(entriesToJSON([])).toBe('[]');
  });
});

describe('audit-export / entriesToCSV', () => {
  it('emits the documented header row first', () => {
    const csv = entriesToCSV([]);
    const firstLine = csv.split('\r\n')[0];
    expect(firstLine).toBe(CSV_COLUMNS.join(','));
  });

  it('can include integrity status comment rows with CSV export', () => {
    const csv = entriesToCSV(
      [makeEntry()],
      {
        status: 'altered',
        seq: 2,
        id: 'audit_bad',
        reason: 'entry hash mismatch',
        checked: 1,
      },
    );
    const lines = csv.split('\r\n');

    expect(lines[0]).toBe('# integrity_status,altered');
    expect(lines[1]).toBe('# integrity_checked,1');
    expect(lines[2]).toBe('# integrity_broken_entry,2');
    expect(lines[3]).toBe('# integrity_broken_id,audit_bad');
    expect(lines[4]).toBe('# integrity_reason,entry hash mismatch');
    expect(lines[5]).toBe(CSV_COLUMNS.join(','));
  });

  it('uses CRLF line separators per RFC 4180', () => {
    const csv = entriesToCSV([makeEntry()]);
    expect(csv).toContain('\r\n');
    // Verify no lone \n that isn't preceded by \r inside field boundaries.
    const lines = csv.split('\r\n');
    expect(lines.length).toBe(2); // header + 1 row
  });

  it('quotes fields containing commas', () => {
    const csv = entriesToCSV([makeEntry({ description: 'foo, bar, baz' })]);
    expect(csv).toContain('"foo, bar, baz"');
  });

  it('escapes embedded double quotes by doubling', () => {
    const csv = entriesToCSV([
      makeEntry({ description: 'he said "hi" to me' }),
    ]);
    expect(csv).toContain('"he said ""hi"" to me"');
  });

  it('quotes fields containing newlines', () => {
    const csv = entriesToCSV([makeEntry({ description: 'line1\nline2' })]);
    expect(csv).toContain('"line1\nline2"');
  });

  it('quotes fields containing carriage returns', () => {
    const csv = entriesToCSV([makeEntry({ description: 'line1\rline2' })]);
    expect(csv).toContain('"line1\rline2"');
  });

  it('leaves plain fields unquoted', () => {
    const csv = entriesToCSV([makeEntry({ description: 'plainstring' })]);
    expect(csv).toContain(',plainstring,');
    // Description should not be wrapped in quotes.
    expect(csv).not.toContain('"plainstring"');
  });

  it('neutralizes spreadsheet formula injection on dangerous leading chars (BUG-027)', () => {
    for (const payload of ['=cmd()', '+1+2', '-2+3', '@SUM(A1)']) {
      const csv = entriesToCSV([makeEntry({ description: payload })]);
      // The value must be prefixed with an apostrophe so Excel/Sheets treat it
      // as literal text, never a formula.
      expect(csv).toContain(`'${payload}`);
      // And the raw formula must not appear at a cell boundary unprefixed.
      expect(csv).not.toContain(`,${payload},`);
    }
  });

  it('serializes nested objects as JSON strings (escaped)', () => {
    const csv = entriesToCSV([
      makeEntry({
        inputs: { path: '/foo/bar', extra: 'data' },
      }),
    ]);
    // Nested JSON contains `"` which must be doubled under RFC 4180.
    expect(csv).toContain('""path""');
    expect(csv).toContain('""extra""');
  });

  it('emits empty string for missing optional fields', () => {
    const csv = entriesToCSV([
      makeEntry({
        model: undefined,
        userDecision: undefined,
        action: 'user_action', // no status mapping → empty
      }),
    ]);
    const header = CSV_COLUMNS.join(',');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(header);
    // Parse the data row: model column should be empty, user_decision empty,
    // status empty, tokens_in/out/cost_usd empty.
    const dataRow = lines[1];
    // Easiest: count the trailing empty commas for tokens_in,tokens_out,cost_usd.
    expect(dataRow).toMatch(/,,,$/);
  });

  it('maps workflow actions to status column', () => {
    const csv = entriesToCSV([
      makeEntry({ action: 'workflow_start', model: undefined }),
      makeEntry({ action: 'workflow_complete', id: 'a2', model: undefined }),
      makeEntry({ action: 'workflow_fail', id: 'a3', model: undefined }),
    ]);
    expect(csv).toContain(',started,');
    expect(csv).toContain(',completed,');
    expect(csv).toContain(',failed,');
  });

  it('includes future-proof cost columns even when absent', () => {
    const csv = entriesToCSV([makeEntry()]);
    const header = csv.split('\r\n')[0]!;
    expect(header).toContain('tokens_in');
    expect(header).toContain('tokens_out');
    expect(header).toContain('cost_usd');
  });

  it('picks up numeric cost fields from outputs when present (Q4 forward-compat)', () => {
    const csv = entriesToCSV([
      makeEntry({
        outputs: { tokens: 1234, cost: 0.0456 },
      }),
    ]);
    // tokens_out pulls from outputs.tokens fallback
    expect(csv).toContain('1234');
    expect(csv).toContain('0.0456');
  });

  it('ignores non-numeric values in cost columns', () => {
    const csv = entriesToCSV([
      makeEntry({
        outputs: { tokens: 'lots', cost: null },
      }),
    ]);
    // The row should still end with empty tokens/cost columns.
    const lines = csv.split('\r\n');
    expect(lines[1]).toMatch(/,,,$/);
  });
});

describe('audit-export / buildExportFilename', () => {
  it('uses the keepance-audit-<iso>.<ext> format', () => {
    const name = buildExportFilename('json', new Date(2026, 3, 16, 14, 32, 7));
    expect(name).toBe('keepance-audit-2026-04-16T14-32-07.json');
  });

  it('switches extension correctly', () => {
    const name = buildExportFilename('csv', new Date(2026, 3, 16, 14, 32, 7));
    expect(name.endsWith('.csv')).toBe(true);
  });

  it('pads single-digit month/day/hour/minute/second with zeros', () => {
    const name = buildExportFilename('json', new Date(2026, 0, 3, 4, 5, 6));
    expect(name).toBe('keepance-audit-2026-01-03T04-05-06.json');
  });

  it('avoids colons (Windows-portable)', () => {
    const name = buildExportFilename('csv');
    expect(name).not.toContain(':');
  });
});

describe('audit-export / uniqueModels', () => {
  it('returns sorted unique model names, excluding entries without a model', () => {
    const entries = [
      makeEntry({ id: '1', model: 'claude-sonnet-4' }),
      makeEntry({ id: '2', model: 'gpt-4o' }),
      makeEntry({ id: '3', model: 'claude-sonnet-4' }),
      makeEntry({ id: '4', model: undefined }),
      makeEntry({ id: '5', model: '' }),
    ];
    expect(uniqueModels(entries)).toEqual(['claude-sonnet-4', 'gpt-4o']);
  });

  it('returns an empty array for empty input', () => {
    expect(uniqueModels([])).toEqual([]);
  });
});

describe('audit-export / filterEntries', () => {
  const entries: AuditEntry[] = [
    makeEntry({
      id: '1',
      timestamp: '2026-04-10T12:00:00.000Z',
      action: 'file_create',
      model: 'claude-sonnet-4',
      description: 'alpha',
    }),
    makeEntry({
      id: '2',
      timestamp: '2026-04-16T12:00:00.000Z',
      action: 'model_call',
      model: 'gpt-4o',
      description: 'bravo',
    }),
    makeEntry({
      id: '3',
      timestamp: '2026-04-20T12:00:00.000Z',
      action: 'file_update',
      model: 'claude-sonnet-4',
      description: 'charlie',
    }),
  ];

  it('returns all entries when no filter is applied', () => {
    expect(filterEntries(entries, {})).toHaveLength(3);
  });

  it('filters by action type set', () => {
    const result = filterEntries(entries, {
      actionTypes: new Set(['file_create', 'file_update']),
    });
    expect(result.map((e) => e.id)).toEqual(['1', '3']);
  });

  it('treats empty action-type set as no filter', () => {
    const result = filterEntries(entries, { actionTypes: new Set() });
    expect(result).toHaveLength(3);
  });

  it('filters by model', () => {
    const result = filterEntries(entries, { model: 'gpt-4o' });
    expect(result.map((e) => e.id)).toEqual(['2']);
  });

  it('filters by inclusive date-from', () => {
    const result = filterEntries(entries, { dateFrom: '2026-04-16' });
    expect(result.map((e) => e.id)).toEqual(['2', '3']);
  });

  it('filters by inclusive date-to', () => {
    const result = filterEntries(entries, { dateTo: '2026-04-16' });
    expect(result.map((e) => e.id)).toEqual(['1', '2']);
  });

  it('filters by both dateFrom and dateTo inclusively', () => {
    const result = filterEntries(entries, {
      dateFrom: '2026-04-16',
      dateTo: '2026-04-16',
    });
    expect(result.map((e) => e.id)).toEqual(['2']);
  });

  it('composes action + model + date', () => {
    const result = filterEntries(entries, {
      actionTypes: new Set(['file_create', 'file_update', 'model_call']),
      model: 'claude-sonnet-4',
      dateFrom: '2026-04-15',
    });
    expect(result.map((e) => e.id)).toEqual(['3']);
  });

  it('applies searchQuery across description / action / model', () => {
    expect(filterEntries(entries, { searchQuery: 'alpha' }).map((e) => e.id)).toEqual(['1']);
    expect(filterEntries(entries, { searchQuery: 'MODEL_CALL' }).map((e) => e.id)).toEqual(['2']);
    expect(filterEntries(entries, { searchQuery: 'gpt' }).map((e) => e.id)).toEqual(['2']);
  });

  it('filters CSV and JSON exports to one matter scope (BUG-069)', () => {
    const scopedEntries = [
      makeEntry({
        id: 'matter-a',
        description: 'Defense file answer',
        metadata: {
          scope: { kind: 'matter', matterId: 'matter-a', matterName: 'Matter A' },
        },
      }),
      makeEntry({
        id: 'matter-b',
        description: 'Other client answer',
        metadata: {
          scope: { kind: 'matter', matterId: 'matter-b', matterName: 'Matter B' },
        },
      }),
    ];

    const filtered = filterEntries(scopedEntries, { matterId: 'matter-a' });
    const csv = entriesToCSV(filtered);
    const json = entriesToJSON(filtered);

    expect(filtered.map((e) => e.id)).toEqual(['matter-a']);
    expect(csv).toContain('Defense file answer');
    expect(csv).not.toContain('Other client answer');
    expect(json).toContain('Matter A');
    expect(json).not.toContain('Matter B');
  });
});

describe('audit-export / triggerDownload', () => {
  let createdUrl: string | null = null;
  let revokedUrl: string | null = null;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    createdUrl = null;
    revokedUrl = null;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      createdUrl = `blob:mock-${blob.size}`;
      return createdUrl;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrl = url;
    }) as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('creates an object URL, appends an anchor with download=, clicks, and removes it', () => {
    triggerDownload('hello', 'hello.txt', 'text/plain');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(createdUrl).toMatch(/^blob:mock-/);
    // Anchor should have been removed again — body should have no stray <a> elements.
    expect(document.body.querySelectorAll('a').length).toBe(0);
  });

  it('revokes the object URL asynchronously', async () => {
    triggerDownload('hello', 'hello.txt', 'text/plain');
    // Give setTimeout(0) a tick.
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(revokedUrl).toBe(createdUrl);
  });

  it('downloadAuditJSON and downloadAuditCSV return the built filename', () => {
    const now = new Date(2026, 3, 16, 9, 0, 0);
    expect(downloadAuditJSON([makeEntry()], now)).toBe(
      'keepance-audit-2026-04-16T09-00-00.json'
    );
    expect(downloadAuditCSV([makeEntry()], now)).toBe(
      'keepance-audit-2026-04-16T09-00-00.csv'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Defensive: an audit row may arrive WITHOUT inputs/outputs/metadata objects.
//
// Regression for the demo-blocker where clicking "Activity Log" white-screened
// the whole app: connector-emitted audit entries lacked a `metadata` object, so
// `getAuditEntryMatterScope` (via uniqueMatterScopes) did `entry.metadata['scope']`
// on `undefined` and threw, with nothing catching it. No audit row should ever
// throw, whatever its shape.
// ─────────────────────────────────────────────────────────────────────────────
describe('audit-export / resilience to missing metadata|inputs|outputs', () => {
  // A connector-style entry that omits the three object fields the type marks
  // as required. The cast models real runtime data that bypassed the type.
  function malformedEntry(): AuditEntry {
    return makeEntry({
      id: 'connector-1',
      action: 'wealthbox.connect' as AuditEntry['action'],
      description: 'Connected Wealthbox',
      metadata: undefined as unknown as Record<string, unknown>,
      inputs: undefined as unknown as Record<string, unknown>,
      outputs: undefined as unknown as Record<string, unknown>,
    });
  }

  it('uniqueMatterScopes does not throw and ignores a row with undefined metadata', () => {
    expect(() => uniqueMatterScopes([malformedEntry()])).not.toThrow();
    expect(uniqueMatterScopes([malformedEntry()])).toEqual([]);
  });

  it('uniqueMatterScopes still reads scope from well-formed rows alongside malformed ones', () => {
    const good = makeEntry({
      id: 'good-1',
      action: 'scope_active',
      metadata: { scope: { kind: 'matter', matterId: 'm-1', matterName: 'Ellison' } },
    });
    const scopes = uniqueMatterScopes([malformedEntry(), good]);
    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.matterId).toBe('m-1');
  });

  it('entriesToCSV does not throw on a row with undefined inputs/outputs/metadata', () => {
    expect(() => entriesToCSV([malformedEntry()])).not.toThrow();
    const csv = entriesToCSV([malformedEntry()]);
    expect(csv).toContain('connector-1');
  });

  it('filterEntries (matter filter) does not throw on a malformed row', () => {
    expect(() => filterEntries([malformedEntry()], { matterId: 'm-1' })).not.toThrow();
  });

  it('asRecord coerces missing/odd values to a plain record', () => {
    expect(asRecord(undefined)).toEqual({});
    expect(asRecord(null)).toEqual({});
    expect(asRecord('x')).toEqual({});
    expect(asRecord([1, 2])).toEqual({});
    const obj = { a: 1 };
    expect(asRecord(obj)).toBe(obj);
  });
});
