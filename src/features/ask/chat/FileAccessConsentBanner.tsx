// FileAccessConsentBanner (F2.5) — the ONE inline affordance, above the
// composer, that lets the advisor allow the AI to work with their files for the
// conversation. "Reading is sending" with a cloud model, so the AI's file tools
// are OFF until this is granted. Local engines never register tools, so this
// only appears for cloud providers.
//
// States:
//   - gated off (unasked)          → the full "Allow file access" prompt
//   - gated off (scope re-confirm) → same prompt, worded to explain the re-ask
//                                    (client switched, or now spanning all clients)
//   - denied                        → a small unobtrusive "off · Allow" line
//   - granted (for this scope)      → a small "on · Turn off" line
//
// A grant records the scope it was made under, so switching to another client —
// or to all-clients — re-asks. A single-client grant never widens to another
// client or the whole practice. Light theme.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, FileSearch } from 'lucide-react';
import { Button } from '@/ui/button';
import { TrustNote } from '@/ui/kp';
import type { ChatProvider } from '@/features/ask/chat/providerModelResolution';
import { isLocalProviderId } from '@/platform/providers/providerFactory';
import { providerDisplayName } from '@/platform/privacy/egress';
import {
  fileToolsAllowed,
  type ConsentScope,
  type FileAccessConsent,
} from '@/platform/ai/fileAccessConsent';

interface FileAccessConsentBannerProps {
  /** The provider the next send targets. Only cloud providers gate on consent. */
  effectiveProvider: ChatProvider | 'none' | null;
  /** Current consent for this conversation. */
  consent: FileAccessConsent;
  /** The scope the next send runs under (a specific client, or all clients). */
  consentScope: ConsentScope;
  /** A ready-made noun phrase for the active scope, used directly in the copy:
   *  a client name for a single-client chat (e.g. "Acme Corp"), or a plural
   *  phrase for an all-clients chat (e.g. "all your clients"). */
  scopeLabel: string;
  /** Grant / revoke. `null` resets to unasked; a `denied` object records a
   *  "not now". A grant is stamped with the current scope by this component. */
  onChange: (consent: FileAccessConsent | null) => void;
  className?: string;
}

export function FileAccessConsentBanner({
  effectiveProvider,
  consent,
  consentScope,
  scopeLabel,
  onChange,
  className,
}: FileAccessConsentBannerProps) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Consent only governs cloud sends — local engines don't register tools and
  // "nothing leaves the device", so there's nothing to consent to. "Cloud"
  // here is the SAME predicate the send path gates on (isLocalProviderId,
  // negated) — not a second hardcoded provider list. The old local `Set` of
  // the three known cloud ids drifted from the gate's fail-closed "anything
  // not local is cloud" rule: any provider id the Set didn't name (a future
  // provider, or a test double) would be BLOCKED by the gate with no "Allow"
  // affordance ever rendering, a silent dead end. Sharing one predicate keeps
  // the gate and its only escape hatch permanently in sync.
  if (!effectiveProvider || effectiveProvider === 'none' || isLocalProviderId(effectiveProvider)) {
    return null;
  }

  const allowed = fileToolsAllowed(consent, consentScope);
  const grant = () => { onChange({ state: 'granted', grantedScope: consentScope }); };
  const provider = providerDisplayName(effectiveProvider);

  // ── Granted for this scope → small "on" line with a turn-off. ──────────────
  if (allowed) {
    return (
      <div
        data-testid="chat-file-access-consent"
        data-state="granted"
        className={`flex items-center gap-2 rounded border border-emerald-300/60 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900 ${className ?? ''}`}
      >
        <FileSearch className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="flex-1">{t('ask.file-access.granted')}</span>
        <button
          type="button"
          data-testid="chat-file-access-turn-off"
          className="underline hover:no-underline shrink-0"
          onClick={() => { onChange(null); }}
        >
          {t('ask.file-access.turn-off')}
        </button>
      </div>
    );
  }

  const isAllScope = consentScope.kind === 'allMatters';
  // Re-asking despite a prior grant (the client was switched, or the chat now
  // spans all clients) — the copy explains why so the second prompt isn't
  // confusing.
  const reconfirm = consent.state === 'granted';

  // ── Denied → collapsed, unobtrusive one-liner (not a nag). ─────────────────
  if (consent.state === 'denied') {
    return (
      <div
        data-testid="chat-file-access-consent"
        data-state="denied"
        className={`flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 ${className ?? ''}`}
      >
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="flex-1">{t('ask.file-access.denied')}</span>
        <button
          type="button"
          data-testid="chat-file-access-allow"
          className="underline hover:no-underline shrink-0"
          onClick={grant}
        >
          Allow
        </button>
      </div>
    );
  }

  // ── Unasked (or scope re-confirm) → the full prompt. ───────────────────────
  return (
    <div
      data-testid="chat-file-access-consent"
      data-state={reconfirm ? 'reconfirm' : 'unasked'}
      className={`rounded border border-sky-300/60 bg-sky-50 px-3 py-2 text-xs text-sky-900 ${className ?? ''}`}
    >
      <div className="flex items-start gap-2">
        <Lock className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1">
          <p className="font-medium">{t('ask.file-access.prompt-title', { scopeLabel })}</p>
          <TrustNote className="mt-1" details={t('ask.file-access.details')}>
            {t('ask.file-access.prompt-body', { provider })}
          </TrustNote>
          {reconfirm ? (
            <p className="mt-1 opacity-80">{t('ask.file-access.reconfirm', { scopeLabel })}</p>
          ) : null}
          {detailsOpen ? (
            <p className="mt-1 opacity-80">{t('ask.file-access.details')}</p>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              data-testid="chat-file-access-allow"
              onClick={grant}
            >
              {isAllScope ? t('ask.file-access.allow-all') : t('ask.file-access.allow')}
            </Button>
            <button
              type="button"
              data-testid="chat-file-access-deny"
              className="underline hover:no-underline"
              onClick={() => { onChange({ state: 'denied' }); }}
            >
              {t('ask.file-access.not-now')}
            </button>
            <button
              type="button"
              data-testid="chat-file-access-details"
              className="underline hover:no-underline"
              onClick={() => { setDetailsOpen((open) => !open); }}
            >
              {t('ask.file-access.details-link')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
