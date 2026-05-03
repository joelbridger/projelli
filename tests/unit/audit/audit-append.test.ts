import { describe, it, expect, beforeEach } from 'vitest';
import { AuditService } from '@/modules/audit/AuditService';

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
});
