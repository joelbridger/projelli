/**
 * useDesignPartnerConsent — the user's opt-in for design-partner diagnostics.
 *
 * Tri-state (so we can tell "hasn't decided yet" from "explicitly off"):
 *   'unset'   — no choice recorded yet
 *   'enabled' — user opted in to structure-only diagnostics
 *   'disabled'— user explicitly opted out
 *
 * Default off. `unset` is treated as "do not send" by sendDiagnosticEvent.
 * Diagnostics never fire until the user has explicitly enabled this.
 *
 * Separate from telemetry consent: two independent opt-ins, both default off.
 */

import { useEffect, useState } from 'react';

const KEY = 'keepance_design_partner_consent';

export type DesignPartnerConsent = 'unset' | 'enabled' | 'disabled';

function read(): DesignPartnerConsent {
  const v = localStorage.getItem(KEY);
  if (v === 'enabled' || v === 'disabled') return v;
  return 'unset';
}

export function getDesignPartnerConsent(): DesignPartnerConsent {
  return read();
}

export function setDesignPartnerConsent(c: DesignPartnerConsent): void {
  if (c === 'unset') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, c);
  // Notify subscribers in this tab — `storage` events only fire cross-tab.
  window.dispatchEvent(new CustomEvent('keepance:design-partner-consent-change'));
}

export function useDesignPartnerConsent(): {
  consent: DesignPartnerConsent;
  setConsent: (c: DesignPartnerConsent) => void;
} {
  const [consent, setLocal] = useState<DesignPartnerConsent>(read);

  useEffect(() => {
    const onChange = () => { setLocal(read()); };
    window.addEventListener('keepance:design-partner-consent-change', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('keepance:design-partner-consent-change', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  return {
    consent,
    setConsent: (c) => {
      setDesignPartnerConsent(c);
      setLocal(c);
    },
  };
}
