/**
 * useTelemetryConsent — the user's opt-in for anonymous telemetry.
 *
 * Tri-state (so we can tell "hasn't decided yet" from "explicitly off"):
 *   'unset'   — no choice recorded yet (used by the first-launch dialog)
 *   'enabled' — user opted in to anonymous lifecycle telemetry
 *   'disabled'— user explicitly opted out
 *
 * `unset` is treated as "do not send" by useTelemetry.sendEvent. Telemetry
 * never fires until the user has explicitly enabled it. The first-launch
 * onboarding dialog is the primary path that flips this; the privacy
 * settings panel can change it later.
 */

import { useEffect, useState } from 'react';
import { EV_TELEMETRY_CONSENT_CHANGE, SK_TELEMETRY_CONSENT } from '@/config/identity';

export type TelemetryConsent = 'unset' | 'enabled' | 'disabled';

function read(): TelemetryConsent {
  const v = localStorage.getItem(SK_TELEMETRY_CONSENT);
  if (v === 'enabled' || v === 'disabled') return v;
  return 'unset';
}

export function getTelemetryConsent(): TelemetryConsent {
  return read();
}

export function setTelemetryConsent(c: TelemetryConsent): void {
  if (c === 'unset') localStorage.removeItem(SK_TELEMETRY_CONSENT);
  else localStorage.setItem(SK_TELEMETRY_CONSENT, c);
  // Notify subscribers in this tab too — `storage` events only fire
  // cross-tab. Internal pub/sub is light enough.
  window.dispatchEvent(new CustomEvent(EV_TELEMETRY_CONSENT_CHANGE));
}

export function useTelemetryConsent(): {
  consent: TelemetryConsent;
  setConsent: (c: TelemetryConsent) => void;
} {
  const [consent, setLocal] = useState<TelemetryConsent>(read);

  useEffect(() => {
    const onChange = () => setLocal(read());
    window.addEventListener(EV_TELEMETRY_CONSENT_CHANGE, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(EV_TELEMETRY_CONSENT_CHANGE, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  return {
    consent,
    setConsent: (c) => {
      setTelemetryConsent(c);
      setLocal(c);
    },
  };
}
