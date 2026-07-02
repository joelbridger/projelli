import { describe, it, expect, beforeEach } from 'vitest';
import { AuditService, auditEventToEntry } from '@/platform/audit/AuditService';

describe('AuditService.append accepts v2.0 events', () => {
  let svc: AuditService;

  beforeEach(() => {
    localStorage.clear();
    svc = new AuditService('test-append');
  });

  it('appends attachment_added without throwing', () => {
    expect(() =>
      svc.append({
        type: 'attachment_added',
        timestamp: new Date().toISOString(),
        payload: { path: 'p', hash: 'h', byteSize: 1 },
      })
    ).not.toThrow();
  });

  it('appends plugin_installed without throwing', () => {
    expect(() =>
      svc.append({
        type: 'plugin_installed',
        timestamp: new Date().toISOString(),
        payload: { id: 'x', version: '1.0.0', permissions: [] },
      })
    ).not.toThrow();
  });

  // Firm Phase 1 (Task 3) governance events
  it('appends matter_shared without throwing', () => {
    expect(() =>
      svc.append({
        type: 'matter_shared',
        timestamp: new Date().toISOString(),
        payload: { matter_id: 'local-1', firm_matter_id: 'firm-1', org_id: 'org-1', detail: 'shared' },
      })
    ).not.toThrow();
  });

  it('matter_shared round-trips through auditEventToEntry with correct description', () => {
    const ts = new Date().toISOString();
    const event = {
      type: 'matter_shared' as const,
      timestamp: ts,
      payload: { matter_id: 'local-1', firm_matter_id: 'firm-1', org_id: 'org-1', detail: 'sent to firm' },
    };
    const entry = auditEventToEntry(event);
    expect(entry.action).toBe('matter_shared');
    expect(entry.description).toBe('Matter shared with firm: sent to firm');
    expect(entry.metadata['matter_id']).toBe('local-1');
    expect(entry.metadata['firm_matter_id']).toBe('firm-1');
    expect(entry.metadata['org_id']).toBe('org-1');
  });

  // Independent reviewer catch (F2.6a reconciliation): 'assured-proxy' used
  // to fall into the generic "with your key" branch, so an Assured-only firm
  // user (no personal key at all) got an Activity Log row that falsely
  // claimed they'd used their own key. Shared by every surface that logs
  // assured egress (Ask, redline, matter-at-a-glance, email).
  it('egress (assured-proxy) describes the firm proxy, not "with your key"', () => {
    const entry = auditEventToEntry({
      type: 'egress',
      timestamp: new Date().toISOString(),
      payload: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        mode: 'assured',
        destination: 'assured-proxy',
        dataLeaves: true,
      },
    });
    expect(entry.description).toBe("AI request sent to anthropic via your firm's zero-retention proxy");
    expect(entry.description).not.toContain('with your key');
  });

  it('egress (provider-direct) still describes BYOK "with your key"', () => {
    const entry = auditEventToEntry({
      type: 'egress',
      timestamp: new Date().toISOString(),
      payload: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        mode: 'direct',
        destination: 'provider-direct',
        dataLeaves: true,
      },
    });
    expect(entry.description).toBe('AI request sent to anthropic with your key');
  });

  it('matter_shared (no detail) round-trips with plain description', () => {
    const entry = auditEventToEntry({
      type: 'matter_shared',
      timestamp: new Date().toISOString(),
      payload: { matter_id: 'local-1', firm_matter_id: 'firm-1' },
    });
    expect(entry.description).toBe('Matter shared with firm');
  });

  it('member_invited round-trips with target_user_id stub in description', () => {
    const entry = auditEventToEntry({
      type: 'member_invited',
      timestamp: new Date().toISOString(),
      payload: { matter_id: 'local-1', firm_matter_id: 'firm-1', target_user_id: 'abcdefghijklmn' },
    });
    expect(entry.action).toBe('member_invited');
    expect(entry.description).toContain('Member invited to matter');
    expect(entry.description).toContain('abcdefgh'); // first 8 chars
  });

  it('member_invited with detail uses detail in description', () => {
    const entry = auditEventToEntry({
      type: 'member_invited',
      timestamp: new Date().toISOString(),
      payload: { matter_id: 'local-1', firm_matter_id: 'firm-1', target_user_id: 'uid-x', detail: 'jane@law.com' },
    });
    expect(entry.description).toBe('Member invited to matter: jane@law.com');
  });

  it('matter_shared entry is stored in AuditService and queryable by action type', () => {
    svc.append({
      type: 'matter_shared',
      timestamp: new Date().toISOString(),
      payload: { matter_id: 'local-1', firm_matter_id: 'firm-1', org_id: 'org-1' },
    });
    const results = svc.query({ actionTypes: ['matter_shared'] });
    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe('matter_shared');
    expect(results[0]!.metadata['matter_id']).toBe('local-1');
  });

  // wall_set_from_manager and seat_revoked round-trip tests (spec item 2)
  it('wall_set_from_manager round-trips with correct description', () => {
    const entry = auditEventToEntry({
      type: 'wall_set_from_manager',
      timestamp: new Date().toISOString(),
      payload: {
        matter_id: 'local-1',
        firm_matter_id: 'firm-1',
        target_user_id: 'user-abcdefgh12',
        detail: 'lateral conflict',
      },
    });
    expect(entry.action).toBe('wall_set_from_manager');
    expect(entry.description).toBe('Information barrier set: lateral conflict');
    expect(entry.metadata['target_user_id']).toBe('user-abcdefgh12');
  });

  it('wall_set_from_manager stored and queryable', () => {
    svc.append({
      type: 'wall_set_from_manager',
      timestamp: new Date().toISOString(),
      payload: { matter_id: 'local-1', firm_matter_id: 'firm-1', target_user_id: 'user-42', detail: 'screen' },
    });
    const results = svc.query({ actionTypes: ['wall_set_from_manager'] });
    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe('wall_set_from_manager');
    expect(results[0]!.metadata['target_user_id']).toBe('user-42');
  });

  it('seat_revoked round-trips with correct description', () => {
    const entry = auditEventToEntry({
      type: 'seat_revoked',
      timestamp: new Date().toISOString(),
      payload: { seat_id: 'seat-abcdefgh12345', org_id: 'org-1', reason: 'admin_revoke', detail: 'revoked seat seat-abcd (Work Laptop)' },
    });
    expect(entry.action).toBe('seat_revoked');
    expect(entry.description).toBe('Seat revoked by admin: revoked seat seat-abcd (Work Laptop)');
    expect(entry.metadata['seat_id']).toBe('seat-abcdefgh12345');
  });

  it('seat_revoked (no detail) includes seat id stub in description', () => {
    const entry = auditEventToEntry({
      type: 'seat_revoked',
      timestamp: new Date().toISOString(),
      payload: { seat_id: 'seat-abcdefgh12345', org_id: 'org-1' },
    });
    // slice(0, 12) of 'seat-abcdefgh12345' is 'seat-abcdefg'
    expect(entry.description).toContain('seat-abcdef'); // prefix in first 12 chars
  });

  it('seat_revoked stored and queryable', () => {
    svc.append({
      type: 'seat_revoked',
      timestamp: new Date().toISOString(),
      payload: { seat_id: 'seat-001', org_id: 'org-1', reason: 'admin_revoke' },
    });
    const results = svc.query({ actionTypes: ['seat_revoked'] });
    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe('seat_revoked');
    expect(results[0]!.metadata['seat_id']).toBe('seat-001');
  });
});
