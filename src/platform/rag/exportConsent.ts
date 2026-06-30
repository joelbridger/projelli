/**
 * exportConsent — the single source of truth for "may Keepance send recognized
 * external-tool EXPORTS (RightCapital plans, Jump meeting notes) to the AI?"
 *
 * The `externalExportConsent` setting promises the advisor that exported reports
 * are not AI-processed until they have agreed once. That promise must hold for
 * EVERY model send, not just the Ask surface — so the consent read lives here
 * and the actual filter is enforced at the shared context-builder choke-point
 * (`buildWorkspaceContextBlock`), which Ask, @workspace chat, Client Map, and
 * At-a-glance all go through. See `sourceProvenance.ts` for recognition and
 * `docs/strategy/2026-06-29-connector-access-options-rightcapital-jump.md`.
 */

import { useSettingsStore } from '@/platform/settings/settingsStore';
import { EXTERNAL_EXPORT_CONSENT_KEY } from '@/platform/settings/schema';
import { recognizeProvenance, type ProvenanceInput } from '@/platform/rag/sourceProvenance';
import type { RagHit } from '@/platform/utils/tauri-commands';

/** Has the advisor consented to storing + AI-processing recognized exports? */
export function isExternalExportConsentGiven(): boolean {
  return useSettingsStore.getState().getSetting<boolean>(EXTERNAL_EXPORT_CONSENT_KEY);
}

/** Record consent (set the one-time flag). Auditing is the caller's job. */
export function grantExternalExportConsent(): void {
  useSettingsStore.getState().setSetting(EXTERNAL_EXPORT_CONSENT_KEY, true);
}

/**
 * Drop recognized RightCapital/Jump EXPORT hits when consent has not been given.
 *
 * Apply this to the RETRIEVED HITS ARRAY at every model-send surface, BEFORE the
 * surface builds its prompt context AND its citation/source list AND its "did we
 * find evidence?" decision — so all three stay in sync and an unconsented export
 * is never shown as a source the model never actually saw. (The shared
 * `buildWorkspaceContextBlock` also filters as a defense-in-depth backstop, but
 * that alone desyncs a caller's citations from the prompt — hence this
 * hits-level filter at the source. Ask runs its own interactive consent flow
 * instead of this blanket filter.)
 *
 * Ordinary hits always pass; when consent is given, everything passes.
 */
export function filterHitsForExportConsent(hits: RagHit[]): RagHit[] {
  return dropUnconsentedExports(hits, (h) => ({
    path: h.path || h.sourceId,
    text: h.chunkText,
    sourceType: h.sourceType,
  }));
}

/**
 * Generic form of the gate for NON-hit model inputs that can also carry export
 * content — open-file (ambient) context and `read_file` tool results in the chat
 * send. `toInput` maps each item to the recognizer's input (path + text). When
 * consent is off, recognized RightCapital/Jump exports are dropped; ordinary
 * items and (once consent is given) everything pass. Keeps every file-content
 * path into a model consistent with the RAG-hits gate above.
 */
export function dropUnconsentedExports<T>(
  items: T[],
  toInput: (item: T) => ProvenanceInput,
): T[] {
  if (isExternalExportConsentGiven()) return items;
  return items.filter((it) => recognizeProvenance(toInput(it)) === null);
}
