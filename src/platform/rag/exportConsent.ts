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

/** Has the advisor consented to storing + AI-processing recognized exports? */
export function isExternalExportConsentGiven(): boolean {
  return useSettingsStore.getState().getSetting<boolean>(EXTERNAL_EXPORT_CONSENT_KEY);
}

/** Record consent (set the one-time flag). Auditing is the caller's job. */
export function grantExternalExportConsent(): void {
  useSettingsStore.getState().setSetting(EXTERNAL_EXPORT_CONSENT_KEY, true);
}
