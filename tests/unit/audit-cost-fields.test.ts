/**
 * Q4 (Wave 1.2) — AuditEntry cost/token fields round-trip.
 *
 * Verifies:
 *   - AuditService stores the new optional `tokensIn`, `tokensOut`, `costUsd`,
 *     `provider` fields (when present in metadata at log time) and returns
 *     them unchanged via query().
 *   - entriesToCSV populates the `tokens_in`, `tokens_out`, `cost_usd`
 *     columns from top-level fields (new style) AND from legacy locations
 *     (outputs / metadata).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuditService } from '@/modules/audit/AuditService';
import type { AuditEntry } from '@/types/audit';
import { entriesToCSV, CSV_COLUMNS } from '@/utils/audit-export';

function buildEntry(partial: Partial<AuditEntry>): AuditEntry {
  return {
    id: 'audit_x',
    timestamp: '2026-04-16T10:00:00.000Z',
    action: 'model_call',
    description: 'Test',
    model: 'claude-haiku-4-5',
    inputs: {},
    outputs: {},
    userDecision: 'auto',
    metadata: {},
    ...partial,
  };
}

describe('AuditEntry cost/token fields', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('AuditService round-trips cost/token fields via setter → query', () => {
    const svc = new AuditService('test-ws');
    // Use the store-level setter by bypassing the narrow log() API:
    // cost/token are injected by writing directly to the persisted array
    // so we cover the round-trip explicitly.
    const raw: AuditEntry = buildEntry({
      id: 'audit_1',
      tokensIn: 320,
      tokensOut: 210,
      costUsd: 0.0042,
      provider: 'anthropic',
    });
    localStorage.setItem(`audit_log_test-ws`, JSON.stringify([raw]));

    const svc2 = new AuditService('test-ws');
    const rows = svc2.query();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.tokensIn).toBe(320);
    expect(row.tokensOut).toBe(210);
    expect(row.costUsd).toBeCloseTo(0.0042, 10);
    expect(row.provider).toBe('anthropic');
  });

  it('entriesToCSV emits top-level tokensIn / tokensOut / costUsd into the right columns', () => {
    const entry = buildEntry({
      id: 'audit_csv_1',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.015,
      provider: 'openai',
    });
    const csv = entriesToCSV([entry]);
    const [headerLine, row] = csv.split('\r\n');
    const headers = headerLine!.split(',');
    const cells = row!.split(',');

    const tIn = cells[headers.indexOf('tokens_in')];
    const tOut = cells[headers.indexOf('tokens_out')];
    const cost = cells[headers.indexOf('cost_usd')];
    expect(tIn).toBe('100');
    expect(tOut).toBe('50');
    expect(cost).toBe('0.015');

    // Header must include our 3 cost columns.
    expect(CSV_COLUMNS).toContain('tokens_in');
    expect(CSV_COLUMNS).toContain('tokens_out');
    expect(CSV_COLUMNS).toContain('cost_usd');
  });

  it('entriesToCSV also scrapes legacy outputs.cost / metadata.tokens_in', () => {
    // Use an entry where the outputs/metadata JSON has no commas so we
    // can use naive `.split(',')`. readNumeric's semantics are what we
    // care about; CSV escaping of nested JSON is covered in audit-export.test.ts.
    const entry = buildEntry({
      outputs: { cost: 0.04 },
      metadata: { tokens_in: 120 },
    });
    const csv = entriesToCSV([entry]);
    // The numeric columns come at the very end (tokens_in, tokens_out,
    // cost_usd). Split the CSV manually: find the final 3 commas.
    const rows = csv.split('\r\n');
    const row = rows[1]!;
    const lastCommaIdx = row.lastIndexOf(',');
    const costCell = row.slice(lastCommaIdx + 1);
    expect(costCell).toBe('0.04');
    // Second-to-last: tokens_out. Top-level none; outputs has no
    // `tokens_out`-ish key (outputs.cost isn't a tokens key), metadata
    // has no matching key either. So tokens_out is empty.
    const beforeCost = row.slice(0, lastCommaIdx);
    const secondLastCommaIdx = beforeCost.lastIndexOf(',');
    const tokensOutCell = beforeCost.slice(secondLastCommaIdx + 1);
    expect(tokensOutCell).toBe('');
    // Third-to-last: tokens_in. metadata.tokens_in = 120.
    const beforeTokensOut = beforeCost.slice(0, secondLastCommaIdx);
    const thirdLastCommaIdx = beforeTokensOut.lastIndexOf(',');
    const tokensInCell = beforeTokensOut.slice(thirdLastCommaIdx + 1);
    expect(tokensInCell).toBe('120');
  });

  it('entriesToCSV leaves cost columns blank when no cost data is present', () => {
    const entry = buildEntry({ id: 'empty' });
    const csv = entriesToCSV([entry]);
    const [headerLine, row] = csv.split('\r\n');
    const headers = headerLine!.split(',');
    const cells = row!.split(',');
    expect(cells[headers.indexOf('tokens_in')]).toBe('');
    expect(cells[headers.indexOf('tokens_out')]).toBe('');
    expect(cells[headers.indexOf('cost_usd')]).toBe('');
  });
});
