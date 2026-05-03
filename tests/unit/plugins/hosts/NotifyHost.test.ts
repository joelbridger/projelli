// Tests for NotifyHost.
//
// Coverage:
//  - handleNotify forwards (pluginId, level, message) to the delegate
//  - handleNotify still emits an audit event when no delegate is wired
//  - handleNotify still emits an audit event when the delegate throws
//  - audit event shape: type=plugin_executed, payload includes id + command
//    `notify.<level>` and durationMs:0
//  - setDelegate(undefined) clears the delegate
//  - non-string messages are coerced to strings before forwarding

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AuditService } from '@/modules/audit/AuditService';
import { NotifyHost } from '@/modules/plugins/hosts/NotifyHost';

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('NotifyHost.handleNotify', () => {
  it('forwards level + message to the delegate with the plugin id', () => {
    const delegate = vi.fn();
    const host = new NotifyHost({ delegate });
    host.handleNotify('translator', 'info', 'Translation done');
    expect(delegate).toHaveBeenCalledWith('translator', 'info', 'Translation done');
  });

  it('emits a plugin_executed audit event for every notification', () => {
    const audit = new AuditService('test-plugins');
    const appendSpy = vi.spyOn(audit, 'append');
    const host = new NotifyHost({ auditService: audit });

    host.handleNotify('translator', 'warn', 'Rate limit nearing');

    expect(appendSpy).toHaveBeenCalledTimes(1);
    const event = appendSpy.mock.calls[0]?.[0];
    expect(event?.type).toBe('plugin_executed');
    if (event?.type === 'plugin_executed') {
      expect(event.payload.id).toBe('translator');
      expect(event.payload.command).toBe('notify.warn');
      expect(event.payload.durationMs).toBe(0);
      expect(typeof event.timestamp).toBe('string');
    }
  });

  it('still emits the audit event when no delegate is wired', () => {
    const audit = new AuditService('test-plugins');
    const appendSpy = vi.spyOn(audit, 'append');
    const host = new NotifyHost({ auditService: audit });
    host.handleNotify('p', 'error', 'something broke');
    expect(appendSpy).toHaveBeenCalledTimes(1);
  });

  it('still emits the audit event when the delegate throws', () => {
    const audit = new AuditService('test-plugins');
    const appendSpy = vi.spyOn(audit, 'append');
    const delegate = vi.fn(() => {
      throw new Error('toast renderer is down');
    });
    const host = new NotifyHost({ delegate, auditService: audit });

    expect(() => host.handleNotify('p', 'info', 'x')).not.toThrow();
    expect(appendSpy).toHaveBeenCalledTimes(1);
  });

  it('setDelegate(undefined) clears the delegate so subsequent notifies do not throw', () => {
    const delegate = vi.fn();
    const audit = new AuditService('test-plugins');
    const host = new NotifyHost({ delegate, auditService: audit });
    host.setDelegate(undefined);

    expect(() => host.handleNotify('p', 'info', 'x')).not.toThrow();
    expect(delegate).not.toHaveBeenCalled();
  });

  it('coerces non-string messages to strings before forwarding', () => {
    const delegate = vi.fn();
    const host = new NotifyHost({ delegate });
    // Plugin worker side could pass anything; the host should not crash.
    host.handleNotify('p', 'info', 42 as unknown as string);
    expect(delegate).toHaveBeenCalledWith('p', 'info', '42');
  });
});

describe('NotifyHost — multiple plugins', () => {
  it('keeps audit emissions independent across plugins', () => {
    const audit = new AuditService('test-plugins');
    const appendSpy = vi.spyOn(audit, 'append');
    const host = new NotifyHost({ auditService: audit });

    host.handleNotify('plugin-a', 'info', 'a-message');
    host.handleNotify('plugin-b', 'warn', 'b-message');
    host.handleNotify('plugin-a', 'error', 'a-message-2');

    expect(appendSpy).toHaveBeenCalledTimes(3);
    const events = appendSpy.mock.calls.map((c) => c[0]);
    const ids = events.map((e) => (e.type === 'plugin_executed' ? e.payload.id : null));
    expect(ids).toEqual(['plugin-a', 'plugin-b', 'plugin-a']);
  });
});
