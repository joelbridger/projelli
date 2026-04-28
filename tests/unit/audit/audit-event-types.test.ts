import { describe, it, expect } from 'vitest';
import type { AuditEvent } from '@/types/audit';

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
});
