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

import { Lock, FileSearch } from 'lucide-react';
import { Button } from '@/ui/button';
import type { ChatProvider } from '@/features/ask/chat/providerModelResolution';
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

const CLOUD_PROVIDERS = new Set<string>(['anthropic', 'openai', 'google']);

export function FileAccessConsentBanner({
  effectiveProvider,
  consent,
  consentScope,
  scopeLabel,
  onChange,
  className,
}: FileAccessConsentBannerProps) {
  // Consent only governs cloud sends — local engines don't register tools and
  // "nothing leaves the device", so there's nothing to consent to.
  if (!effectiveProvider || !CLOUD_PROVIDERS.has(effectiveProvider)) return null;

  const allowed = fileToolsAllowed(consent, consentScope);
  const grant = () => { onChange({ state: 'granted', grantedScope: consentScope }); };

  // ── Granted for this scope → small "on" line with a turn-off. ──────────────
  if (allowed) {
    return (
      <div
        data-testid="chat-file-access-consent"
        data-state="granted"
        className={`flex items-center gap-2 px-3 py-1.5 rounded border border-emerald-300/60 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-900 dark:text-emerald-200 text-xs ${className ?? ''}`}
      >
        <FileSearch className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="flex-1">
          {'The AI can search, open, and change files on its own in this chat (every change still asks first).'}
        </span>
        <button
          type="button"
          data-testid="chat-file-access-turn-off"
          className="underline hover:no-underline shrink-0"
          onClick={() => { onChange(null); }}
        >
          Turn off
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
        className={`flex items-center gap-2 px-3 py-1.5 rounded border border-slate-200 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300 text-xs ${className ?? ''}`}
      >
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="flex-1">{'File access is off for this chat.'}</span>
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
      className={`px-3 py-2 rounded border border-sky-300/60 bg-sky-50 dark:bg-sky-900/20 text-sky-900 dark:text-sky-100 text-xs ${className ?? ''}`}
    >
      <div className="flex items-start gap-2">
        <Lock className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1">
          <p className="font-medium">{`Let the AI search and open files on its own for ${scopeLabel}?`}</p>
          <p className="mt-0.5 opacity-90">
            {reconfirm
              ? `You allowed this earlier, but this chat now covers ${scopeLabel}, so it needs your OK again. The AI can search, read, and change files for you here; what it reads is sent to your AI provider, and every change still asks first. Until you allow it, the AI only uses what you type and any files you add yourself.`
              : `It can search, read, and change files for ${scopeLabel} to answer you (every change still asks first). What it reads is sent to your AI provider. Until you allow this, the AI only uses what you type and any files you add yourself.`}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              data-testid="chat-file-access-allow"
              onClick={grant}
            >
              {isAllScope ? 'Allow for all' : 'Allow file access'}
            </Button>
            <button
              type="button"
              data-testid="chat-file-access-deny"
              className="underline hover:no-underline"
              onClick={() => { onChange({ state: 'denied' }); }}
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
