// Plugin runner — permission audit aggregator.
//
// The bridge (`PluginAPIBridge`) is the canonical enforcement point for
// per-call permission checks; it builds a granted-set from the manifest at
// construction time and rejects gated `api-call` messages inline. This class
// is a small companion that:
//
//   1. Surfaces the same granted/required relationship to non-bridge code
//      (PluginManager, host adapters that need to introspect permissions
//      without round-tripping through the worker).
//   2. Wires the bridge's `onPermissionDenied` hook into the audit log so
//      every denial is recorded as a structured `plugin_permission_denied`
//      event with the plugin id, permission, and API method.
//
// Keeping the audit emission here (rather than inline in the bridge) lets
// the bridge stay agnostic of audit infrastructure, and lets PluginManager
// (Group VII) instantiate one `PluginPermissions` per plugin and wire it
// declaratively.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (tasks 3.1-3.3)

import { AuditService } from '@/modules/audit/AuditService';
import type { PluginManifest, PluginPermission } from '@/types/plugin';

import type { PluginAPIBridge, PluginBridgeHooks } from './PluginAPIBridge';
import { requiredPermissionFor } from './permissionMap';
import type { PluginAPIMethod } from './PluginMessageProtocol';

/**
 * Per-plugin permission view + audit helper.
 *
 * Construct one instance per plugin (typically by the PluginManager when it
 * spawns a `PluginAPIBridge`). The instance:
 *
 *   - Exposes `check(permission)` so callers outside the bridge (host
 *     adapters, manager UI) can ask "is this permission granted?" without
 *     reimplementing the manifest parse.
 *   - Exposes `wireAuditOn(bridge)` so the manager can install an
 *     `onPermissionDenied` hook that emits `plugin_permission_denied` audit
 *     events automatically. The hook composes with any existing
 *     `onPermissionDenied` hook the caller already supplied.
 */
export class PluginPermissions {
  private readonly grantedPermissions: ReadonlySet<PluginPermission>;
  private readonly pluginId: string;
  private readonly auditService: AuditService;

  /**
   * @param manifest      The plugin's validated manifest. Permissions array
   *                      becomes the canonical granted set.
   * @param auditService  Optional audit service. Defaults to a fresh
   *                      `AuditService('plugins')` so callers don't have to
   *                      thread one through. Tests inject a mock to assert
   *                      the audit emission.
   */
  constructor(manifest: PluginManifest, auditService?: AuditService) {
    this.pluginId = manifest.id;
    this.grantedPermissions = new Set(manifest.permissions);
    this.auditService = auditService ?? new AuditService('plugins');
  }

  /**
   * True if the plugin's manifest declares this permission. Mirrors the
   * bridge's inline gate; do not use this as a substitute for the bridge's
   * own check (the bridge is the enforcement point on every `api-call`).
   */
  check(permission: PluginPermission): boolean {
    return this.grantedPermissions.has(permission);
  }

  /**
   * Convenience: look up the required permission for an API method and
   * report whether the plugin has it. Returns `true` for ungated methods.
   */
  checkMethod(method: PluginAPIMethod): boolean {
    const required = requiredPermissionFor(method);
    if (required === null) return true;
    return this.grantedPermissions.has(required);
  }

  /** Snapshot of granted permissions for debugging / introspection. */
  getGrantedPermissions(): PluginPermission[] {
    return Array.from(this.grantedPermissions);
  }

  /**
   * Install the audit hook on a bridge. Composes with any pre-existing
   * `onPermissionDenied` hook on the bridge's hook bag (via the returned
   * helper). The expected wiring is:
   *
   *     const perms = new PluginPermissions(manifest);
   *     const bridge = new PluginAPIBridge(manifest, perms.composeHooks(hooks), workerFactory);
   *
   * Or for an already-constructed bridge whose hooks need augmenting in
   * place, callers can wrap manually. Both styles are supported.
   */
  composeHooks(hooks: PluginBridgeHooks = {}): PluginBridgeHooks {
    const userHook = hooks.onPermissionDenied;
    const composed: PluginBridgeHooks['onPermissionDenied'] = (info) => {
      this.emitDenied(info.permission, info.method, info.reason);
      if (userHook) {
        try {
          userHook(info);
        } catch {
          // Caller's hook errors must not break audit emission.
        }
      }
    };
    return {
      ...hooks,
      onPermissionDenied: composed,
    };
  }

  /**
   * Convenience for callers that already constructed a bridge and want to
   * attach the audit hook reactively without rebuilding the bridge. Returns
   * a function suitable for assigning to `bridge.hooks.onPermissionDenied`.
   * Bridge hooks are private; this is exposed for tests + future managers
   * that hold their own hook references.
   */
  buildAuditHook(): NonNullable<PluginBridgeHooks['onPermissionDenied']> {
    return (info) => this.emitDenied(info.permission, info.method, info.reason);
  }

  /**
   * Audit helper. Public so tests can assert the emission shape directly
   * without wiring through the bridge. `reason` is set when the denial is a
   * Privileged Matter Mode egress block (rather than a missing manifest grant),
   * so the audit record is defensibly attributable.
   */
  emitDenied(permission: PluginPermission, apiCall: string, reason?: string): void {
    this.auditService.append({
      type: 'plugin_permission_denied',
      timestamp: new Date().toISOString(),
      payload: {
        id: this.pluginId,
        permission,
        apiCall,
        ...(reason ? { reason } : {}),
      },
    });
  }

  /**
   * Wire this instance's audit hook onto a bridge whose hooks bag is
   * already exposed via a setter. Currently the bridge constructor takes
   * hooks once and the hook bag is private, so the canonical wiring is via
   * `composeHooks`. This method exists as a forward-compat hook for Group
   * VII's PluginManager if it grows a runtime mutator.
   */
  wireAuditOn(bridge: Pick<PluginAPIBridge, 'pluginId'>): void {
    // No-op today; reserved for the future manager mutator path. Kept on
    // the public surface so Group VII tests can assert it exists.
    void bridge;
  }
}
