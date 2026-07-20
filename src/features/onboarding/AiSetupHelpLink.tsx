/**
 * AiSetupHelpLink — an "I need help setting this up" link plus a small
 * support-ticket dialog, shown beneath the AI-provider key input (the Settings
 * key wizard and the onboarding key step).
 *
 * Clicking the link opens a message box that sends a help ticket straight to
 * the Lantern founder. It reuses the same transport + backend as the in-app
 * bug report (the form-handler service -> Brevo email, Reply-To the user), but
 * posts to a DEDICATED `ai-setup-help` form so setup-help tickets land in their
 * own pile, separate from bug reports. The ticket carries which provider the
 * user was connecting and which step they were on, so the reply can be specific.
 *
 * SECURITY: the box sits right under "Paste your API key", so a stuck user
 * might paste their actual key into the message. Before anything is sent, the
 * message and context are run through `redactSecrets`, which replaces anything
 * that looks like an Anthropic / OpenAI / Google API key with a placeholder.
 * A real key must never leave the user's machine in a ticket.
 *
 * Like the bug report, this request goes to Lantern infrastructure (NOT the
 * user's AI provider), so it opts out of the "Sending to your AI provider"
 * egress pulse via getCorsSafeFetch({ signalEgress: false }).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { HelpCircle, LifeBuoy, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import { openExternal } from '@/platform/utils/openExternal';
import { redactSecrets } from '@/platform/utils/redactSecrets';
import { AI_SETUP_HELP_ENDPOINT } from '@/platform/utils/supportEndpoints';
import { BRAND } from '@/config/brand';

const MAILTO_ADDRESS = BRAND.urls.supportEmail;

// Payload bounds (defense-in-depth; the server also caps + whitelists).
const MAX_MESSAGE = 2000;
const MAX_EMAIL = 254;
const MAX_META = 500;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = 'idle' | 'sending' | 'success' | 'error';

interface Metadata {
  version: string;
  os: string;
  userAgent: string;
}

function readPlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  // navigator.platform is deprecated but remains the pragmatic cross-browser
  // OS hint; this mirrors the in-app bug report's metadata.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const platform = navigator.platform;
  return platform.length > 0 ? platform : 'unknown';
}

function collectMetadata(): Metadata {
  const version =
    (import.meta.env['VITE_APP_VERSION'] as string | undefined) ?? 'unknown';
  const userAgent =
    typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  return {
    version: version.slice(0, MAX_META),
    os: readPlatform().slice(0, MAX_META),
    userAgent: userAgent.slice(0, MAX_META),
  };
}

function buildMailto(
  message: string,
  email: string,
  provider: string,
  context: string,
  meta: Metadata,
): string {
  const subject = `${BRAND.name} AI setup help`;
  const lines = [
    message,
    '',
    email ? `Reply to: ${email}` : '',
    '---',
    `Provider: ${provider}`,
    `Where: ${context}`,
    `${BRAND.name} version: ${meta.version}`,
    `Platform: ${meta.os}`,
    `User agent: ${meta.userAgent}`,
  ].filter(Boolean);
  return `mailto:${MAILTO_ADDRESS}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(lines.join('\n'))}`;
}

interface RedactedTicket {
  message: string;
  email: string;
  provider: string;
  context: string;
  version: string;
  os: string;
  user_agent: string;
}

/**
 * Build the ticket fields once, with EVERY user-reachable string redacted and
 * capped, so no raw API key can leave the machine by ANY path. The same object
 * feeds both the POST body and the mailto fallback — a key pasted into the
 * email box (or anywhere) is scrubbed before it can reach either. Redact first,
 * then cap, so a key near the length boundary is scrubbed before truncation.
 */
function buildRedactedTicket(
  rawMessage: string,
  rawEmail: string,
  provider: string,
  context: string,
  meta: Metadata,
): RedactedTicket {
  return {
    message: redactSecrets(rawMessage).slice(0, MAX_MESSAGE),
    email: redactSecrets(rawEmail).slice(0, MAX_EMAIL),
    provider,
    context: redactSecrets(context).slice(0, MAX_META),
    version: redactSecrets(meta.version).slice(0, MAX_META),
    os: redactSecrets(meta.os).slice(0, MAX_META),
    user_agent: redactSecrets(meta.userAgent).slice(0, MAX_META),
  };
}

export interface AiSetupHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Machine id of the provider the user is connecting (e.g. 'anthropic'). */
  provider: string;
  /** Plain display name of that provider (e.g. 'Claude'). */
  providerName: string;
  /** Where the user is stuck, for the ticket (e.g. 'onboarding · ai-key-step'). */
  context: string;
  /** Optional email to prefill (if onboarding already captured one). */
  defaultEmail?: string | undefined;
}

export function AiSetupHelpDialog({
  open,
  onOpenChange,
  provider,
  providerName,
  context,
  defaultEmail,
}: AiSetupHelpDialogProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [emailError, setEmailError] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  // Reset transient state each time the dialog closes so the next open is clean.
  useEffect(() => {
    if (!open) {
      setStatus('idle');
      setEmailError('');
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed) return;

    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      setEmailError(t('common.ai-setup-help.email-invalid'));
      return;
    }
    setEmailError('');
    setStatus('sending');

    const ticket = buildRedactedTicket(
      trimmed,
      trimmedEmail,
      provider,
      context,
      collectMetadata(),
    );
    const payload: {
      message: string;
      provider: string;
      context: string;
      version: string;
      os: string;
      user_agent: string;
      email?: string;
    } = {
      message: ticket.message,
      provider: ticket.provider,
      context: ticket.context,
      version: ticket.version,
      os: ticket.os,
      user_agent: ticket.user_agent,
    };
    if (ticket.email) payload.email = ticket.email;

    // Bound the POST so a down/slow help endpoint can't leave the button stuck
    // on "Sending..." forever.
    const ac = new AbortController();
    const timer = setTimeout(() => { ac.abort(); }, 15_000);
    try {
      // The help ticket goes to Lantern infrastructure, not the user's AI
      // provider — opt out of the "Sending to your AI provider" pulse.
      const fetchFn = await getCorsSafeFetch({ signalEgress: false });
      const res = await fetchFn(AI_SETUP_HELP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`server responded ${String(res.status)}`);
      setStatus('success');
      setMessage('');
    } catch (err) {
      console.error('[AiSetupHelpDialog] submit failed', err);
      setStatus('error');
    } finally {
      clearTimeout(timer);
    }
  }, [message, email, provider, context, t]);

  const handleFallbackEmail = useCallback(() => {
    // Same redacted ticket as the POST path — the mailto body can't leak a key
    // pasted into any field, including the email box.
    const ticket = buildRedactedTicket(
      message.trim(),
      email.trim(),
      provider,
      context,
      collectMetadata(),
    );
    const url = buildMailto(ticket.message, ticket.email, ticket.provider, ticket.context, {
      version: ticket.version,
      os: ticket.os,
      userAgent: ticket.user_agent,
    });
    void openExternal(url);
    onOpenChange(false);
  }, [message, email, provider, context, onOpenChange]);

  const canSubmit = message.trim().length > 0 && status !== 'sending';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-primary" />
            {t('common.ai-setup-help.title')}
          </DialogTitle>
          <DialogDescription>
            {t('common.ai-setup-help.description', { provider: providerName })}
          </DialogDescription>
        </DialogHeader>

        {status === 'success' ? (
          <div className="py-4 space-y-4" data-testid="ai-setup-help-success">
            <p className="text-sm">{t('common.ai-setup-help.success')}</p>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ai-setup-help-message">
                  {t('common.ai-setup-help.message-label')}
                </Label>
                <Textarea
                  id="ai-setup-help-message"
                  data-testid="ai-setup-help-message"
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                  }}
                  placeholder={t('common.ai-setup-help.message-placeholder')}
                  rows={5}
                  maxLength={MAX_MESSAGE}
                  autoFocus
                  disabled={status === 'sending'}
                />
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="ai-setup-help-dont-paste"
                >
                  {t('common.ai-setup-help.dont-paste')}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ai-setup-help-email">
                  {t('common.ai-setup-help.email-label')}{' '}
                  <span className="text-muted-foreground">
                    {t('common.ai-setup-help.email-help')}
                  </span>
                </Label>
                <Input
                  id="ai-setup-help-email"
                  data-testid="ai-setup-help-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError('');
                  }}
                  placeholder="you@example.com"
                  maxLength={MAX_EMAIL}
                  disabled={status === 'sending'}
                />
                {emailError && (
                  <p
                    className="text-xs text-destructive"
                    data-testid="ai-setup-help-email-error"
                  >
                    {emailError}
                  </p>
                )}
              </div>

              {status === 'error' && (
                <div
                  data-testid="ai-setup-help-error"
                  className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
                >
                  <p className="font-medium">
                    {t('common.ai-setup-help.send-failed')}
                  </p>
                  <p className="text-muted-foreground text-xs mt-1">
                    {t('common.ai-setup-help.retry-hint')}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <button
                type="button"
                data-testid="ai-setup-help-mailto"
                onClick={handleFallbackEmail}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                {t('common.ai-setup-help.open-email-client')}
              </button>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    onOpenChange(false);
                  }}
                  disabled={status === 'sending'}
                >
                  Cancel
                </Button>
                <Button
                  data-testid="ai-setup-help-submit"
                  onClick={() => {
                    void handleSubmit();
                  }}
                  disabled={!canSubmit}
                >
                  {status === 'sending' ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Sending…
                    </>
                  ) : status === 'error' ? (
                    'Retry send'
                  ) : (
                    'Send'
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface AiSetupHelpLinkProps {
  /** Machine id of the provider the user is connecting (e.g. 'anthropic'). */
  provider: string;
  /** Plain display name of that provider (e.g. 'Claude'). */
  providerName: string;
  /** Where the user is stuck, for the ticket (e.g. 'onboarding · ai-key-step'). */
  context: string;
  /** Optional email to prefill (if onboarding already captured one). */
  defaultEmail?: string | undefined;
  /** Extra classes for the link (spacing at the call site). */
  className?: string;
}

export function AiSetupHelpLink({
  provider,
  providerName,
  context,
  defaultEmail,
  className,
}: AiSetupHelpLinkProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="ai-setup-help-link"
        onClick={() => {
          setOpen(true);
        }}
        className={cn(
          'inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground',
          className,
        )}
      >
        <HelpCircle className="h-3.5 w-3.5" />
        {t('common.ai-setup-help.link')}
      </button>
      <AiSetupHelpDialog
        open={open}
        onOpenChange={setOpen}
        provider={provider}
        providerName={providerName}
        context={context}
        defaultEmail={defaultEmail}
      />
    </>
  );
}
