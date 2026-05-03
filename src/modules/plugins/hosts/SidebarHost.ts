// Plugin runner — Sidebar host adapter.
//
// Plugins call `api.sidebar.addPanel(spec)` / `api.sidebar.removePanel(id)`.
// Those flow as `sidebar-add-panel` / `sidebar-remove-panel` message variants
// (NOT `api-call`), so the bridge fires `onSidebarAddPanel` /
// `onSidebarRemovePanel` hooks. The host validates and forwards to the
// registry store.
//
// Spec note (per Group I `SidebarPanelSpec`): a panel may carry either
// `html` (rendered inside a sandboxed iframe by Group VIII) or
// `componentTree` (reserved for v2.1+, validated but not rendered). At least
// one of the two should be present; we accept either.
//
// Sandboxing happens at render time in Group VIII's iframe wrapper. The host
// does NOT sanitize HTML here — the iframe's `sandbox` attribute is the
// security boundary. Sanitizing here would only delay the inevitable XSS
// that any plugin can already perform inside the iframe sandbox, and would
// break legitimate use cases (custom CSS, embedded SVG, etc.).
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 5.2)

import { AuditService } from '@/modules/audit/AuditService';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';
import type { SidebarPanelSpec } from '@/types/plugin';

export class SidebarHostError extends Error {
  readonly code: 'invalid-args';
  constructor(message: string) {
    super(message);
    this.code = 'invalid-args';
    this.name = 'SidebarHostError';
  }
}

export interface SidebarHostOptions {
  auditService?: AuditService;
}

export class SidebarHost {
  private readonly auditService: AuditService;

  constructor(options: SidebarHostOptions = {}) {
    this.auditService = options.auditService ?? new AuditService('plugins');
  }

  /**
   * Handler for the bridge `onSidebarAddPanel` hook. Validates and registers
   * the panel on the registry store.
   */
  handleAdd(pluginId: string, spec: SidebarPanelSpec): void {
    this.validateSpec(spec);
    usePluginRegistryStore.getState().addSidebarPanel(pluginId, spec);
    this.audit(pluginId, 'sidebar.addPanel');
  }

  /**
   * Handler for the bridge `onSidebarRemovePanel` hook. Removes by id.
   */
  handleRemove(pluginId: string, panelId: string): void {
    if (typeof panelId !== 'string' || panelId.length === 0) {
      throw new SidebarHostError('sidebar panelId must be a non-empty string');
    }
    usePluginRegistryStore.getState().removeSidebarPanel(panelId);
    this.audit(pluginId, 'sidebar.removePanel');
  }

  private validateSpec(spec: SidebarPanelSpec): void {
    if (!spec || typeof spec !== 'object') {
      throw new SidebarHostError('sidebar panel spec must be an object');
    }
    if (typeof spec.id !== 'string' || spec.id.length === 0) {
      throw new SidebarHostError('sidebar panel id must be a non-empty string');
    }
    if (typeof spec.title !== 'string' || spec.title.length === 0) {
      throw new SidebarHostError('sidebar panel title must be a non-empty string');
    }
    // html (when present) must be a string. componentTree is reserved; we
    // accept any value but require at least one of html or componentTree.
    const hasHtml = spec.html !== undefined;
    const hasTree = spec.componentTree !== undefined;
    if (hasHtml && typeof spec.html !== 'string') {
      throw new SidebarHostError('sidebar panel html must be a string when provided');
    }
    if (!hasHtml && !hasTree) {
      throw new SidebarHostError(
        'sidebar panel spec must include either html or componentTree',
      );
    }
  }

  private audit(pluginId: string, command: 'sidebar.addPanel' | 'sidebar.removePanel'): void {
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
