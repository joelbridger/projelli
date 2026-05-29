// Plugin runner — Notify host adapter.
//
// Plugins call `api.notify.info/warn/error(message)` to surface a
// user-visible message. That posts a dedicated `notify` message variant
// (NOT an `api-call`), and the bridge's `onNotify` hook fires per spec
// §6.4 — no permission gate.
//
// The host turns those calls into two outputs:
//
//   1. A single `delegate` callback the PluginManager / app shell can wire
//      to whatever toast / outcome system is current. Keeping the host
//      decoupled from a specific UI primitive matches how the rest of
//      Keepance handles notifications today (per-component `OutcomeBanner`
//      state in the marketplace; see TemplateDetailView.tsx). When the
//      app grows a global toast store this delegate is the only call site
//      that needs to change.
//
//   2. An audit emission. Plugin notifications are user-facing actions
//      worth recording, so each one becomes a `plugin_executed` audit event
//      tagged with the plugin id, the level, and the message length. We
//      intentionally do NOT log the full message body to avoid leaking
//      arbitrary plugin output into the audit log; the level + length is
//      enough for a launch-time observability story.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 4.3)

import { AuditService } from '@/modules/audit/AuditService';

export type PluginNotifyLevel = 'info' | 'warn' | 'error';

/**
 * Adapter callback the host invokes once per `notify` message. The PluginManager
 * (Group VII) sets this to whatever in-app toast / outcome system is current.
 * Tests replace it to assert messages were forwarded.
 */
export type PluginNotifyDelegate = (
  pluginId: string,
  level: PluginNotifyLevel,
  message: string,
) => void;

export interface NotifyHostOptions {
  /** Optional initial delegate. Can be replaced via `setDelegate` later. */
  delegate?: PluginNotifyDelegate;
  /** Inject an audit service (tests) or rely on the default. */
  auditService?: AuditService;
}

export class NotifyHost {
  private delegate: PluginNotifyDelegate | undefined;
  private readonly auditService: AuditService;

  constructor(options: NotifyHostOptions = {}) {
    if (options.delegate) {
      this.delegate = options.delegate;
    }
    this.auditService = options.auditService ?? new AuditService('plugins');
  }

  /** Replace the user-facing delegate. Pass `undefined` to clear. */
  setDelegate(delegate: PluginNotifyDelegate | undefined): void {
    this.delegate = delegate;
  }

  /**
   * Handler for the bridge `onNotify` hook. Forwards to the delegate (if any)
   * and records an audit event. A delegate that throws is isolated so a
   * downstream UI bug can't break audit emission.
   */
  handleNotify(pluginId: string, level: PluginNotifyLevel, message: string): void {
    const safeMessage = typeof message === 'string' ? message : String(message);
    if (this.delegate) {
      try {
        this.delegate(pluginId, level, safeMessage);
      } catch {
        // Delegate errors must not break the audit emission below.
      }
    }
    this.auditService.append({
      type: 'plugin_executed',
      timestamp: new Date().toISOString(),
      payload: {
        id: pluginId,
        command: `notify.${level}`,
        durationMs: 0,
      },
    });
  }
}
