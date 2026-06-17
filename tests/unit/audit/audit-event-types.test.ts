import { describe, it, expect } from 'vitest';
import type { AuditEvent } from '@/platform/types/audit';

describe('AuditEvent v2.0 additions', () => {
  it('accepts attachment_added', () => {
    const e: AuditEvent = {
      type: 'attachment_added',
      timestamp: new Date().toISOString(),
      payload: { path: 'media/2026-04/x.png', hash: 'abc', byteSize: 100 },
    };
    expect(e.type).toBe('attachment_added');
  });

  it('accepts attachment_sent_to_provider', () => {
    const e: AuditEvent = {
      type: 'attachment_sent_to_provider',
      timestamp: new Date().toISOString(),
      payload: { path: 'media/x.png', hash: 'abc', provider: 'claude', model: 'sonnet' },
    };
    expect(e.type).toBe('attachment_sent_to_provider');
  });

  it('accepts plugin_installed', () => {
    const e: AuditEvent = {
      type: 'plugin_installed',
      timestamp: new Date().toISOString(),
      payload: { id: 'translator', version: '1.0.0', permissions: ['network'] },
    };
    expect(e.type).toBe('plugin_installed');
  });

  it('accepts language_changed', () => {
    const e: AuditEvent = {
      type: 'language_changed',
      timestamp: new Date().toISOString(),
      payload: { from: 'en', to: 'es' },
    };
    expect(e.type).toBe('language_changed');
  });

  it('accepts context_compressed', () => {
    const e: AuditEvent = {
      type: 'context_compressed',
      timestamp: new Date().toISOString(),
      payload: { messagesBefore: 14, tokensBefore: 18500, messagesAfter: 1, tokensAfter: 1200 },
    };
    expect(e.type).toBe('context_compressed');
  });

  // Firm Phase 1 (Task 3) governance events
  it('accepts matter_shared', () => {
    const e: AuditEvent = {
      type: 'matter_shared',
      timestamp: new Date().toISOString(),
      payload: { matter_id: 'local-1', firm_matter_id: 'firm-1', org_id: 'org-1', detail: 'shared' },
    };
    expect(e.type).toBe('matter_shared');
  });

  it('accepts matter_unshared', () => {
    const e: AuditEvent = {
      type: 'matter_unshared',
      timestamp: new Date().toISOString(),
      payload: { matter_id: 'local-1', firm_matter_id: 'firm-1' },
    };
    expect(e.type).toBe('matter_unshared');
  });

  it('accepts member_invited', () => {
    const e: AuditEvent = {
      type: 'member_invited',
      timestamp: new Date().toISOString(),
      payload: { matter_id: 'local-1', firm_matter_id: 'firm-1', target_user_id: 'user-42' },
    };
    expect(e.type).toBe('member_invited');
  });

  it('accepts member_removed', () => {
    const e: AuditEvent = {
      type: 'member_removed',
      timestamp: new Date().toISOString(),
      payload: { matter_id: 'local-1', firm_matter_id: 'firm-1', target_user_id: 'user-42' },
    };
    expect(e.type).toBe('member_removed');
  });

  it('accepts wall_set_from_manager', () => {
    const e: AuditEvent = {
      type: 'wall_set_from_manager',
      timestamp: new Date().toISOString(),
      payload: { matter_id: 'local-1', firm_matter_id: 'firm-1', target_user_id: 'user-42', detail: 'lateral conflict' },
    };
    expect(e.type).toBe('wall_set_from_manager');
  });

  it('accepts key_published', () => {
    const e: AuditEvent = {
      type: 'key_published',
      timestamp: new Date().toISOString(),
      payload: { matter_id: 'local-1', firm_matter_id: 'firm-1', org_id: 'org-1' },
    };
    expect(e.type).toBe('key_published');
  });
});
