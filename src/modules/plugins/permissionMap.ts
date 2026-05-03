// Plugin runner — permission map.
//
// Single source of truth for which `PluginAPIMethod` requires which
// `PluginPermission`. The bridge consults this on every `api-call` to gate
// requests; Group III's `PluginPermissions` will reuse the same table to
// build the permission-check class.
//
// Methods mapped to `null` are unconditionally allowed (no permission gate).
// Methods that flow as their own dedicated message variant (toolbar-add,
// sidebar-add-panel, settings-add-page, notify, register-command) are NOT
// `PluginAPIMethod`s and never reach the permission check; they're handled
// by the bridge's variant-routing layer without any gating per spec §6.4.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 3.2)

import type { PluginPermission } from '@/types/plugin';
import type { PluginAPIMethod } from './PluginMessageProtocol';

/**
 * For each `PluginAPIMethod` flowing through the `api-call` variant, the
 * required permission, or `null` if the method is unconditionally allowed.
 *
 * Note `commands.invoke` is `null` because invoking a registered command is
 * always permitted; the command itself may then perform gated actions, each
 * of which gets its own permission check at the moment it's called.
 */
export const REQUIRED_PERMISSION_FOR_METHOD: Record<PluginAPIMethod, PluginPermission | null> = {
  'editor.getSelection': 'editor:selection',
  'editor.getContent': 'editor:selection',
  'editor.replaceSelection': 'editor:write',
  'editor.insertAtCursor': 'editor:write',
  'workspace.listFiles': 'workspace:read',
  'workspace.readFile': 'workspace:read',
  'workspace.writeFile': 'workspace:write',
  'ai.invoke': 'ai:invoke',
  'storage.get': null,
  'storage.set': null,
  'storage.remove': null,
  'network.fetch': 'network',
  'commands.invoke': null,
  'settings.get': null,
  'settings.set': null,
};

/**
 * Convenience accessor. Returns the required permission or `null`.
 */
export function requiredPermissionFor(method: PluginAPIMethod): PluginPermission | null {
  return REQUIRED_PERMISSION_FOR_METHOD[method];
}
