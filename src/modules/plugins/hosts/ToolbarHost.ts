// Plugin runner — Toolbar host adapter.
//
// Plugins call `api.toolbar.addButton(spec)` / `api.toolbar.removeButton(id)`
// from inside their worker. Those calls flow as dedicated `toolbar-add` /
// `toolbar-remove` message variants (NOT `api-call`), so the bridge fires
// the `onToolbarAdd` / `onToolbarRemove` hooks. The host's job:
//
//   1. Validate the `ToolbarButtonSpec` shape. The bridge swallows hook
//      exceptions so a throw here surfaces only via audit + console; that's
//      acceptable for a v2.0 bad-actor protection (a buggy plugin doesn't
//      crash the host, but the developer can read the audit log).
//   2. Delegate to `pluginRegistryStore.addToolbarButton` /
//      `removeToolbarButton`. Both are idempotent on `id` so the host doesn't
//      need to dedupe.
//   3. Emit a `plugin_executed` audit event with `command: 'toolbar.add'` or
//      `'toolbar.remove'` so the audit log carries a record of every UI
//      mutation a plugin performed.
//
// Wave 2 hosts have no `api-call` dispatch contribution — UI registration
// flows via dedicated message variants per Group I's protocol design. This
// host therefore exposes no `handle()` / `handlesMethod()` like the Wave 1
// + Wave 3 hosts do; only `handleAdd` and `handleRemove` for the bridge
// hooks.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 5.1)

import { AuditService } from '@/modules/audit/AuditService';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';
import type { ToolbarButtonSpec } from '@/types/plugin';

export class ToolbarHostError extends Error {
  readonly code: 'invalid-args';
  constructor(message: string) {
    super(message);
    this.code = 'invalid-args';
    this.name = 'ToolbarHostError';
  }
}

export interface ToolbarHostOptions {
  /** Inject an audit service (tests) or rely on the default. */
  auditService?: AuditService;
}

export class ToolbarHost {
  private readonly auditService: AuditService;

  constructor(options: ToolbarHostOptions = {}) {
    this.auditService = options.auditService ?? new AuditService('plugins');
  }

  /**
   * Handler for the bridge `onToolbarAdd` hook. Validates and registers the
   * button on the registry store, then audits.
   */
  handleAdd(pluginId: string, spec: ToolbarButtonSpec): void {
    this.validateSpec(spec);
    usePluginRegistryStore.getState().addToolbarButton(pluginId, spec);
    this.audit(pluginId, 'toolbar.add');
  }

  /**
   * Handler for the bridge `onToolbarRemove` hook. Removes by id (no-op if
   * the id isn't registered). Still audits — the plugin attempted a UI
   * mutation, which is worth recording.
   */
  handleRemove(pluginId: string, buttonId: string): void {
    if (typeof buttonId !== 'string' || buttonId.length === 0) {
      throw new ToolbarHostError('toolbar buttonId must be a non-empty string');
    }
    usePluginRegistryStore.getState().removeToolbarButton(buttonId);
    this.audit(pluginId, 'toolbar.remove');
  }

  private validateSpec(spec: ToolbarButtonSpec): void {
    if (!spec || typeof spec !== 'object') {
      throw new ToolbarHostError('toolbar button spec must be an object');
    }
    if (typeof spec.id !== 'string' || spec.id.length === 0) {
      throw new ToolbarHostError('toolbar button id must be a non-empty string');
    }
    if (typeof spec.icon !== 'string' || spec.icon.length === 0) {
      throw new ToolbarHostError('toolbar button icon must be a non-empty string');
    }
    if (typeof spec.tooltip !== 'string' || spec.tooltip.length === 0) {
      throw new ToolbarHostError('toolbar button tooltip must be a non-empty string');
    }
    if (typeof spec.command !== 'string' || spec.command.length === 0) {
      throw new ToolbarHostError('toolbar button command must be a non-empty string');
    }
  }

  private audit(pluginId: string, command: 'toolbar.add' | 'toolbar.remove'): void {
    this.auditService.append({
      type: 'plugin_executed',
      timestamp: new Date().toISOString(),
      payload: {
        id: pluginId,
        command,
        durationMs: 0,
      },
    });
  }
}
