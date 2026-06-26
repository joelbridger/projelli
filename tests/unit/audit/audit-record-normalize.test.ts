/**
 * AuditService.recordToEntry — load-source normalization.
 *
 * Robustness follow-up to the Activity Log crash fix: an OLD thin persisted
 * audit record (e.g. a connector entry whose payload is just
 * {"auditEventType":"wealthbox.connect"}) used to load with
 * metadata/inputs/outputs === undefined, because the parse path returned the
 * payload as-is. The display layer's asRecord() already prevents a crash, but
 * normalizing at the load source means every loaded entry ALWAYS has those three
 * as objects — closing the gap at its origin.
 */

import { describe, it, expect, vi } from 'vitest';

// AuditService touches the Tauri core at module load; stub it so the import works.
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
}));

import { recordToEntry } from '@/platform/audit/AuditService';
import type { AuditEntryRecord } from '@/platform/utils/tauri-commands';

function rec(payload: unknown): AuditEntryRecord {
  return {
    id: 'rec-1',
    timestamp: '2026-06-26T10:00:00.000Z',
    action: 'wealthbox.connect',
    description: 'Connected Wealthbox',
    payloadJson: JSON.stringify(payload),
  };
}

describe('recordToEntry — normalizes missing metadata/inputs/outputs to {}', () => {
  it('an OLD thin persisted row loads with {} (not undefined) for all three objects', () => {
    // The exact shape Codex flagged: just an event marker, no objects.
    const entry = recordToEntry(rec({ auditEventType: 'wealthbox.connect' }));
    expect(entry.metadata).toEqual({});
    expect(entry.inputs).toEqual({});
    expect(entry.outputs).toEqual({});
    // Indexed fields still come from the record's summary columns.
    expect(entry.id).toBe('rec-1');
    expect(entry.action).toBe('wealthbox.connect');
    expect(entry.description).toBe('Connected Wealthbox');
  });

  it('preserves well-formed metadata/inputs/outputs unchanged', () => {
    const entry = recordToEntry(
      rec({
        id: 'ignored',
        timestamp: 'ignored',
        action: 'egress',
        description: 'ignored',
        inputs: { promptLength: 12 },
        outputs: { contentLength: 40 },
        metadata: { scope: { kind: 'matter', matterId: 'm-1' }, mode: 'direct' },
      }),
    );
    expect(entry.inputs).toEqual({ promptLength: 12 });
    expect(entry.outputs).toEqual({ contentLength: 40 });
    expect(entry.metadata).toEqual({ scope: { kind: 'matter', matterId: 'm-1' }, mode: 'direct' });
  });

  it('coerces null metadata/inputs/outputs to {} (typeof null === object guard)', () => {
    const entry = recordToEntry(
      rec({ metadata: null, inputs: null, outputs: null }),
    );
    expect(entry.metadata).toEqual({});
    expect(entry.inputs).toEqual({});
    expect(entry.outputs).toEqual({});
  });

  it('falls back to a minimal entry with {} objects on unreadable JSON', () => {
    const entry = recordToEntry({
      id: 'rec-2',
      timestamp: '2026-06-26T11:00:00.000Z',
      action: 'wealthbox.disconnect',
      description: 'Disconnected',
      payloadJson: '{not valid json',
    });
    expect(entry.metadata).toEqual({});
    expect(entry.inputs).toEqual({});
    expect(entry.outputs).toEqual({});
    expect(entry.id).toBe('rec-2');
    expect(entry.action).toBe('wealthbox.disconnect');
  });
});
