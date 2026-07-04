/**
 * Keepance 3.0 — AuditService persistence + append-only + export.
 *
 * Covers:
 *   1. Desktop (Tauri): every append/log routes to the encrypted store via the
 *      `audit_append` command (one row per entry), and `hydrate()` loads from
 *      `audit_list`. No localStorage write happens in this mode.
 *   2. Append-only is preserved: entries only accumulate; nothing is mutated or
 *      removed through the public API.
 *   3. CSV/JSON export still works (over the in-memory entries).
 *   4. `isAuditEncrypted()` tracks the Tauri/browser split.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
}));

// Mock the Tauri core so we can flip desktop/browser and capture invokes.
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: mocks.isTauri,
  invoke: mocks.invoke,
}));

import { AuditService, isAuditEncrypted } from '@/platform/audit/AuditService';
import type { AuditEvent } from '@/platform/types/audit';

describe('AuditService persistence (browser, localStorage)', () => {
  beforeEach(() => {
    mocks.isTauri.mockReturnValue(false);
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    mocks.invoke.mockReset();
    localStorage.clear();
  });

  it('isAuditEncrypted() is false in the browser', () => {
    expect(isAuditEncrypted()).toBe(false);
  });

  it('append + log accumulate (append-only) and persist to localStorage', () => {
    const svc = new AuditService('browser-test');
    svc.log('model_call', 'first');
    svc.append({ type: 'egress', timestamp: new Date().toISOString(), payload: { provider: 'anthropic', mode: 'direct', destination: 'provider-direct', dataLeaves: true } } as AuditEvent);
    expect(svc.getCount()).toBe(2);
    // Nothing was sent to the encrypted store in browser mode.
    expect(mocks.invoke).not.toHaveBeenCalled();
    // localStorage holds both entries.
    const raw = localStorage.getItem('audit_log_browser-test');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toHaveLength(2);
  });

  it('export to JSON and CSV reflects all entries', () => {
    const svc = new AuditService('browser-export');
    svc.log('file_create', 'made a file', { model: 'stub' });
    svc.log('model_call', 'asked the model', { model: 'claude' });

    const json = JSON.parse(svc.exportJSON());
    expect(json).toHaveLength(2);

    const csv = svc.exportCSV();
    const lines = csv.split('\n');
    expect(lines[0]).toContain('id,timestamp,action,description,model');
    // header + 2 rows
    expect(lines).toHaveLength(3);
    expect(csv).toContain('file_create');
    expect(csv).toContain('model_call');
  });
});

describe('AuditService persistence (desktop, encrypted store)', () => {
  beforeEach(() => {
    mocks.isTauri.mockReturnValue(true);
    // Production detects desktop via the injected Tauri window global, so
    // simulate it here (the isTauri mock alone is no longer read).
    Reflect.set(window, '__TAURI_INTERNALS__', {});
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(() => {
    mocks.isTauri.mockReturnValue(false);
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('isAuditEncrypted() is true on the desktop', () => {
    expect(isAuditEncrypted()).toBe(true);
  });

  it('routes each append to audit_append (one row per entry), not localStorage', () => {
    const svc = new AuditService('desktop-test');
    // Legacy flat log + structured event API both route to the encrypted store.
    svc.log('model_call', 'a model call');
    svc.append({
      type: 'retrieval_executed',
      timestamp: new Date().toISOString(),
      payload: { query: 'q', scope: { kind: 'allMatters' }, hitCount: 0, topScore: null },
    });
    svc.append({
      type: 'egress',
      timestamp: new Date().toISOString(),
      payload: { provider: 'anthropic', mode: 'direct', destination: 'provider-direct', dataLeaves: true },
    });

    // Every entry went to the encrypted store command.
    const appendCalls = mocks.invoke.mock.calls.filter((c) => c[0] === 'audit_append');
    expect(appendCalls.length).toBe(svc.getCount());
    expect(svc.getCount()).toBeGreaterThanOrEqual(2);

    // The record shape carries id/timestamp/action/description + payloadJson.
    const firstRec = (appendCalls[0]![1] as { entry: Record<string, unknown> }).entry;
    expect(firstRec).toHaveProperty('id');
    expect(firstRec).toHaveProperty('payloadJson');
    expect(typeof firstRec['payloadJson']).toBe('string');

    // Desktop mode must NOT write the localStorage blob.
    expect(localStorage.getItem('audit_log_desktop-test')).toBeNull();
  });

  it('persists token, cost, and provider fields in the encrypted payload', () => {
    const svc = new AuditService('desktop-cost-fields');
    svc.log('model_call', 'chat message to Claude', {
      model: 'claude-opus-4-8',
      inputs: { promptLength: 12 },
      outputs: { contentLength: 20 },
      tokensIn: 123,
      tokensOut: 45,
      costUsd: 0.067,
      provider: 'anthropic',
    });

    const appendCalls = mocks.invoke.mock.calls.filter((c) => c[0] === 'audit_append');
    const rec = (appendCalls[0]![1] as { entry: { payloadJson: string } }).entry;
    const persisted = JSON.parse(rec.payloadJson) as Record<string, unknown>;
    expect(persisted['tokensIn']).toBe(123);
    expect(persisted['tokensOut']).toBe(45);
    expect(persisted['costUsd']).toBe(0.067);
    expect(persisted['provider']).toBe('anthropic');
  });

  it('surfaces rejected desktop persistence for a critical event without throwing', async () => {
    mocks.invoke.mockRejectedValue(new Error('encrypted store unavailable'));
    const svc = new AuditService('desktop-critical-failure');

    const entry = await svc.logDurable('egress', 'AI request sent to Anthropic', {
      metadata: { auditEventType: 'egress' },
    });

    expect(entry.metadata['auditPersistenceStatus']).toBe('failed');
    expect(String(entry.metadata['auditPersistenceError'])).toContain('encrypted store unavailable');
    expect(svc.getAll()[0]).toBe(entry);
  });

  it('persists successful durable rows with saved status, never pending', async () => {
    const svc = new AuditService('desktop-critical-success');

    const entry = await svc.logDurable('egress', 'AI request sent to Anthropic', {
      metadata: { auditEventType: 'egress' },
    });

    const appendCalls = mocks.invoke.mock.calls.filter((c) => c[0] === 'audit_append');
    const rec = (appendCalls[0]![1] as { entry: { payloadJson: string } }).entry;
    const persisted = JSON.parse(rec.payloadJson) as { metadata?: Record<string, unknown> };

    expect(entry.metadata['auditPersistenceStatus']).toBe('saved');
    expect(persisted.metadata?.['auditPersistenceStatus']).toBe('saved');
    expect(persisted.metadata?.['auditPersistenceStatus']).not.toBe('pending');
    expect(persisted.metadata?.['auditPersistenceStatus']).not.toBe('failed');
  });

  it('can expose a pending durable row before a never-resolving encrypted append finishes', () => {
    mocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === 'audit_append') {
        return new Promise(() => undefined);
      }
      return Promise.resolve(undefined);
    });
    const svc = new AuditService('desktop-critical-hanging');

    const { entry } = svc.logDurablePending('egress', 'AI request sent to Anthropic', {
      metadata: { auditEventType: 'egress' },
    });

    expect(entry.metadata['auditPersistenceStatus']).toBe('pending');
    expect(svc.getAll()[0]).toBe(entry);
  });

  it('hydrate() sets the workspace and loads entries from audit_list', async () => {
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'audit_list') {
        return [
          { id: 'e1', timestamp: '2026-06-09T00:00:00Z', action: 'model_call', description: 'old call', payloadJson: JSON.stringify({ id: 'e1', timestamp: '2026-06-09T00:00:00Z', action: 'model_call', description: 'old call', inputs: {}, outputs: {}, metadata: {} }) },
          { id: 'e2', timestamp: '2026-06-09T00:01:00Z', action: 'egress', description: 'sent', payloadJson: JSON.stringify({ id: 'e2', timestamp: '2026-06-09T00:01:00Z', action: 'egress', description: 'sent', inputs: {}, outputs: {}, metadata: { auditEventType: 'egress' } }) },
        ];
      }
      return undefined;
    });

    const svc = new AuditService('desktop-hydrate');
    expect(svc.getCount()).toBe(0); // desktop starts empty (no sync localStorage load)
    await svc.hydrate('/ws/Acme');

    // Workspace was set, then entries loaded.
    expect(mocks.invoke.mock.calls.some((c) => c[0] === 'audit_set_workspace' && (c[1] as { path: string }).path === '/ws/Acme')).toBe(true);
    expect(svc.getCount()).toBe(2);
    expect(svc.getAll()[0]!.id).toBe('e1');
    expect(svc.getAll()[1]!.action).toBe('egress');
  });

  it('verifyIntegrity() calls the encrypted store integrity command', async () => {
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'audit_verify_integrity') {
        return { status: 'verified', checked: 3 };
      }
      return undefined;
    });
    const svc = new AuditService('desktop-integrity');

    await svc.hydrate('/ws/Acme');
    const verdict = await svc.verifyIntegrity();

    expect(mocks.invoke.mock.calls.some((c) => c[0] === 'audit_verify_integrity')).toBe(true);
    expect(verdict).toEqual({ status: 'verified', checked: 3 });
  });

  it('verifyIntegrity() returns an altered verdict from the encrypted store', async () => {
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'audit_verify_integrity') {
        return {
          status: 'altered',
          seq: 2,
          id: 'audit_bad',
          reason: 'entry hash mismatch',
          checked: 1,
        };
      }
      return undefined;
    });
    const svc = new AuditService('desktop-integrity-altered');

    await svc.hydrate('/ws/Acme');
    const verdict = await svc.verifyIntegrity();

    expect(verdict).toEqual({
      status: 'altered',
      seq: 2,
      id: 'audit_bad',
      reason: 'entry hash mismatch',
      checked: 1,
    });
  });

  it('repairSeal() runs the repair command then re-hydrates so the anomaly appears', async () => {
    const anomalyRecord = {
      id: 'audit_reseal_1',
      timestamp: '2026-07-04T00:00:00Z',
      action: 'audit_integrity_reseal',
      description: 'seal repaired',
      payloadJson: JSON.stringify({
        id: 'audit_reseal_1',
        timestamp: '2026-07-04T00:00:00Z',
        action: 'audit_integrity_reseal',
        description: 'seal repaired',
        inputs: {},
        outputs: {},
        metadata: { auditEventType: 'audit_integrity_reseal' },
      }),
    };
    let repaired = false;
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'audit_repair_seal') {
        repaired = true;
        return { survivingRows: 2, anomalyId: 'audit_reseal_1', totalEntries: 3, lastVerifiableTimestamp: '2026-06-09T00:01:00Z' };
      }
      if (cmd === 'audit_list') {
        return repaired ? [anomalyRecord] : []; // the anomaly only exists after repair
      }
      return undefined;
    });
    const svc = new AuditService('desktop-repair');
    await svc.hydrate('/ws/Acme');
    expect(svc.getCount()).toBe(0);

    await svc.repairSeal();

    expect(mocks.invoke.mock.calls.some((c) => c[0] === 'audit_repair_seal')).toBe(true);
    // Re-hydrated: the permanent anomaly record is now in the live view.
    expect(svc.getAll().some((e) => e.action === 'audit_integrity_reseal')).toBe(true);
  });

  it('a transient encrypted-store failure does not break logging (entry stays in memory)', () => {
    mocks.invoke.mockRejectedValue(new Error('keychain locked'));
    const svc = new AuditService('desktop-resilient');
    expect(() => svc.log('user_action', 'still logged')).not.toThrow();
    // In-memory read model still has it even though the async append rejected.
    expect(svc.getCount()).toBe(1);
  });
});
