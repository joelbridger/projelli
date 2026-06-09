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

import { AuditService, isAuditEncrypted } from '@/modules/audit/AuditService';
import type { AuditEvent } from '@/types/audit';

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

  it('a transient encrypted-store failure does not break logging (entry stays in memory)', () => {
    mocks.invoke.mockRejectedValue(new Error('keychain locked'));
    const svc = new AuditService('desktop-resilient');
    expect(() => svc.log('user_action', 'still logged')).not.toThrow();
    // In-memory read model still has it even though the async append rejected.
    expect(svc.getCount()).toBe(1);
  });
});
