/**
 * Field-level blended CRM updates (Task 9c). Pure blend composer consumed by
 * crmWriteQueueStore when a `kind: 'field'` item is enqueued.
 *
 * Two field shapes:
 *   - scalar (numbers, dates, single-choice): finalValue = newValue, verbatim
 *     replace, no AI call.
 *   - narrative (free text, e.g. Wealthbox's `background_information` — see
 *     `WRITABLE_FIELDS` in `src-tauri/src/commands/crm/write.rs`, the only
 *     field the backend currently accepts): finalValue = an AI-composed
 *     merge that keeps every existing fact and folds in the new information,
 *     via a caller-supplied Provider; a deterministic `existing + "\n\n" +
 *     new` fallback when no provider is configured, so the store never
 *     silently drops content for lack of a configured AI key.
 *
 * Deliberately does NOT log the egress-audit entry itself (stays pure, no
 * IO) — `onBeforeProviderCall` is the seam the real caller hooks the actual
 * `resolveEgress`/`AuditService` wiring into, matching
 * `DraftFollowUpModal.tsx`'s "audit logged before the AI call" pattern.
 */

import type { Provider } from '@/platform/providers/Provider';

/** Wealthbox's writable-field allowlist that also happens to need an AI
 *  blend (free text). Mirrors `WRITABLE_FIELDS` in
 *  `src-tauri/src/commands/crm/write.rs` — the backend currently accepts
 *  only this one field, but the classifier stays general for when more are
 *  added. */
export const WEALTHBOX_NARRATIVE_FIELDS = ['background_information'] as const;

export function isNarrativeField(field: string): boolean {
  return (WEALTHBOX_NARRATIVE_FIELDS as readonly string[]).includes(field);
}

function mergePrompt(existingValue: string, newValue: string): string {
  return [
    'Merge the new information into the existing text. Keep every existing fact.',
    'Return only the merged text.',
    '',
    'Existing text:',
    existingValue,
    '',
    'New information:',
    newValue,
  ].join('\n');
}

export async function composeFieldBlend(args: {
  field: string;
  existingValue: string;
  newValue: string;
  provider?: Provider;
  /** Called immediately before `provider.sendMessage`, so the caller can log
   *  the required egress-audit entry first. Never fires for a scalar field
   *  (no provider call happens). */
  onBeforeProviderCall?: (prompt: string) => void;
}): Promise<string> {
  const { field, existingValue, newValue, provider, onBeforeProviderCall } = args;

  if (!isNarrativeField(field)) {
    return newValue;
  }

  if (!provider) {
    return existingValue.trim() === '' ? newValue : `${existingValue}\n\n${newValue}`;
  }

  const prompt = mergePrompt(existingValue, newValue);
  onBeforeProviderCall?.(prompt);
  const response = await provider.sendMessage(prompt);
  return response.content;
}
