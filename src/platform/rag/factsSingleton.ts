/**
 * Facts singleton — tiny module that holds the app-wide
 * `FactsServiceApi` instance plus the settings-toggle readers the
 * chat + extraction paths call into. Mirrors the `MemoryService`
 * toggle-reader shape so tests can stub both readers in one place.
 *
 * Why a module singleton rather than a React context or Zustand store?
 *   - The chat send path in `AIChatViewer` is a big async callback
 *     created inside a `useCallback`. Threading the service through
 *     props (or a hook) bloats the dep array and forces re-creation
 *     on every store change.
 *   - Extraction, Settings panel, and prompt injection all need the
 *     same instance. A module-level holder reads the same reference
 *     from every caller without prop drilling.
 *   - It's swappable at test time via `setFactsServiceForTests`.
 */

import type { Fact, FactsServiceApi } from './FactsService';
import { selectFactsForInjection } from './FactsService';

export type FactsEnabledReader = () => boolean;

const DEFAULT_READER: FactsEnabledReader = () => true;

let service: FactsServiceApi | null = null;
let injectionReader: FactsEnabledReader = DEFAULT_READER;
let autoAcceptReader: FactsEnabledReader = () => false;

/** Install the active facts service instance. Called by `App.tsx`
 *  after the workspace has been opened. Pass `null` to uninstall when
 *  the workspace closes. */
export function setFactsService(next: FactsServiceApi | null): void {
  service = next;
}

/** Current facts service instance (or null if no workspace is open). */
export function getFactsService(): FactsServiceApi | null {
  return service;
}

/** Replace the facts service instance for a test. Same contract as
 *  `setFactsService` but named so greppability makes the test-only
 *  nature obvious. */
export function setFactsServiceForTests(next: FactsServiceApi | null): void {
  service = next;
}

/** Install the `factsInjection` setting reader. */
export function setFactsInjectionReader(reader: FactsEnabledReader): void {
  injectionReader = reader;
}

/** Install the `factsAutoAccept` setting reader. */
export function setFactsAutoAcceptReader(reader: FactsEnabledReader): void {
  autoAcceptReader = reader;
}

/** Reset readers to defaults — test helper. */
export function resetFactsReaders(): void {
  injectionReader = DEFAULT_READER;
  autoAcceptReader = () => false;
}

/** Whether facts should be injected into system prompts. Respects the
 *  user's `factsInjection` toggle. Defensive: any throw from the reader
 *  (settings not hydrated yet, etc.) defaults to ON so users don't
 *  suddenly lose their durable memory. */
export function isFactsInjectionEnabled(): boolean {
  try {
    return injectionReader();
  } catch {
    return true;
  }
}

/** Whether extracted facts should be auto-accepted without the
 *  Accept/Reject chip. Defaults to FALSE — auto-save of AI proposals
 *  without approval is a privacy concern, so we fail closed. */
export function isFactsAutoAcceptEnabled(): boolean {
  try {
    return autoAcceptReader();
  } catch {
    return false;
  }
}

/**
 * Snapshot the current facts list for injection without awaiting.
 * Returns `[]` when no service is installed or the toggle is off.
 * This is the single ingress point the chat viewer uses at the top of
 * `handleSendMessage`; by keeping it async it can safely read from the
 * workspace file (which is where the source of truth lives) without
 * forcing every caller to cache.
 *
 * A1 (isolation): pass the active client scope so only facts that may be
 * injected for that scope are returned. A client-scoped turn gets ONLY that
 * client's facts; an all-matters / no-client turn gets only global facts.
 * Callers that don't pass a scope default to GLOBAL-ONLY (`matterId: null`) —
 * the safe default that never leaks a client-scoped fact.
 */
export async function snapshotFactsForInjection(
  scope: { matterId: string | null } = { matterId: null },
): Promise<Fact[]> {
  if (!isFactsInjectionEnabled()) return [];
  const svc = service;
  if (!svc) return [];
  try {
    const all = await svc.listFacts();
    return selectFactsForInjection(all, scope);
  } catch {
    // Storage read failures shouldn't break chat — fall back to empty
    // and let the user see the fix in the Settings panel.
    return [];
  }
}
