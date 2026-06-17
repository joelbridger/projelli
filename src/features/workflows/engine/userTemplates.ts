/**
 * Q19 (Wave 1.6) — User-authored workflow templates (fork / remix).
 *
 * Persists user-created template variants so they appear in the workflow
 * picker alongside the built-ins. Built-ins are loaded from code as
 * before (`allWorkflows`); user templates are loaded from an abstraction
 * whose default implementation is `localStorage`. In Tauri builds the
 * same data could be mirrored to `~/.keepance/user-templates/*.json` in
 * a future wave without changing the public API of this module.
 *
 * Public shape:
 *  - `listUserTemplates()` -> WorkflowTemplate[]
 *  - `saveUserTemplate(tpl)` -> writes the template (creates or updates)
 *  - `deleteUserTemplate(id)` -> removes a template by id
 *  - `duplicateTemplate(original, overrides)` -> returns a new template
 *    with a unique id `<original.id>-user-<ts>` and `isUser: true`
 *  - `loadAllTemplates()` -> built-ins plus user templates, with user
 *    entries overriding any built-in with the same id
 *
 * Kept as plain functions (not a Zustand store) so it can be used
 * outside React (WorkflowEngine, Settings plumbing, tests) without
 * needing a provider or hook.
 */

import type { WorkflowTemplate } from '@/types/workflow';
import { allWorkflows } from '.';

export const USER_TEMPLATES_STORAGE_KEY = 'keepance:userWorkflowTemplates';

// ---------------------------------------------------------------------------
// Storage adapter — minimal interface so tests can swap in an in-memory
// store and a future Tauri implementation can swap in a filesystem adapter.
// ---------------------------------------------------------------------------

export interface UserTemplateStorage {
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

function defaultStorage(): UserTemplateStorage {
  if (typeof localStorage === 'undefined') {
    // Node / non-DOM context: use an in-process map so the API still works.
    const mem = new Map<string, string>();
    return {
      read: () => mem.get(USER_TEMPLATES_STORAGE_KEY) ?? null,
      write: (v) => mem.set(USER_TEMPLATES_STORAGE_KEY, v),
      clear: () => mem.delete(USER_TEMPLATES_STORAGE_KEY),
    };
  }
  return {
    read: () => localStorage.getItem(USER_TEMPLATES_STORAGE_KEY),
    write: (v) => localStorage.setItem(USER_TEMPLATES_STORAGE_KEY, v),
    clear: () => localStorage.removeItem(USER_TEMPLATES_STORAGE_KEY),
  };
}

let adapter: UserTemplateStorage = defaultStorage();

/** Swap out the storage adapter. Intended for tests and Tauri bootstrap. */
export function setUserTemplateStorage(next: UserTemplateStorage): void {
  adapter = next;
}

/** Reset the adapter back to the default (localStorage). Intended for tests. */
export function resetUserTemplateStorage(): void {
  adapter = defaultStorage();
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

function parseStored(): WorkflowTemplate[] {
  try {
    const raw = adapter.read();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Shallow validation: require id + steps shape.
    return parsed.filter((t): t is WorkflowTemplate => {
      const obj = t as Partial<WorkflowTemplate> | null;
      return (
        obj !== null &&
        typeof obj === 'object' &&
        typeof obj.id === 'string' &&
        typeof obj.name === 'string' &&
        Array.isArray(obj.steps)
      );
    });
  } catch {
    return [];
  }
}

function persist(list: WorkflowTemplate[]): void {
  adapter.write(JSON.stringify(list, null, 2));
}

/** List every user-authored template currently on disk. */
export function listUserTemplates(): WorkflowTemplate[] {
  return parseStored().map((t) => ({ ...t, isUser: true }));
}

/** Create or update a user template by id. */
export function saveUserTemplate(template: WorkflowTemplate): WorkflowTemplate {
  const all = parseStored();
  const stamped: WorkflowTemplate = { ...template, isUser: true };
  const idx = all.findIndex((t) => t.id === stamped.id);
  if (idx >= 0) {
    all[idx] = stamped;
  } else {
    all.push(stamped);
  }
  persist(all);
  return stamped;
}

/** Remove a user template by id. No-op when the id doesn't exist. */
export function deleteUserTemplate(id: string): void {
  const all = parseStored();
  const next = all.filter((t) => t.id !== id);
  if (next.length !== all.length) persist(next);
}

/**
 * Wipe every user template. Exposed mostly for tests; the product UI
 * doesn't surface a "delete all" action.
 */
export function clearUserTemplates(): void {
  adapter.clear();
}

/**
 * Duplicate a template. Produces a new template with id
 * `<original.id>-user-<timestamp>` by default, `isUser = true`, and
 * any caller-supplied overrides applied on top (typically `name`
 * and a modified `systemPrompt` on the first generate step). Does NOT
 * persist; caller is expected to call `saveUserTemplate`.
 */
export function duplicateTemplate(
  original: WorkflowTemplate,
  overrides: Partial<WorkflowTemplate> = {},
  timestamp: number = Date.now()
): WorkflowTemplate {
  // Deep-clone the steps so editing the duplicate doesn't mutate the
  // original (important for the built-in templates which are module-level
  // const objects).
  const clonedSteps = original.steps.map((s) => ({
    ...s,
    config: { ...(s.config as object) } as typeof s.config,
  }));
  const next: WorkflowTemplate = {
    ...original,
    ...overrides,
    id: overrides.id ?? `${original.id}-user-${timestamp}`,
    steps: overrides.steps ?? clonedSteps,
    isUser: true,
  };
  return next;
}

/**
 * Convenience helper: update the first `generate` step's systemPrompt
 * on a template, returning a new template (does NOT persist).
 *
 * Matches the Q19 editor UI, which only edits the system prompt.
 */
export function setSystemPrompt(
  template: WorkflowTemplate,
  systemPrompt: string
): WorkflowTemplate {
  const nextSteps = template.steps.map((step) => {
    if (step.type !== 'generate') return step;
    // Generate steps carry a config with an optional `systemPrompt`.
    return {
      ...step,
      config: { ...(step.config as object), systemPrompt } as typeof step.config,
    };
  });
  return { ...template, steps: nextSteps };
}

/**
 * Read the first generate step's systemPrompt, or empty string if
 * the template has none. Useful for populating the edit dialog.
 */
export function getSystemPrompt(template: WorkflowTemplate): string {
  for (const step of template.steps) {
    if (step.type === 'generate') {
      const cfg = step.config as { systemPrompt?: string };
      return cfg.systemPrompt ?? '';
    }
  }
  return '';
}

/**
 * Load every template the picker should show: built-ins first, then
 * user templates. User templates override built-ins with the same id.
 */
export function loadAllTemplates(): WorkflowTemplate[] {
  const userTemplates = listUserTemplates();
  const userIds = new Set(userTemplates.map((t) => t.id));
  const merged: WorkflowTemplate[] = [];
  for (const t of allWorkflows) {
    if (!userIds.has(t.id)) merged.push(t);
  }
  merged.push(...userTemplates);
  return merged;
}
