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
import { Bug, Loader2 } from 'lucide-react';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import { openExternal } from '@/platform/utils/openExternal';
import { BUG_REPORT_ENDPOINT } from '@/platform/utils/supportEndpoints';
import { BRAND } from '@/config/brand';

const MAILTO_ADDRESS = BRAND.urls.supportEmail;

type Status = 'idle' | 'sending' | 'success' | 'error';

interface Metadata {
  version: string;
  os: string;
  userAgent: string;
}

function collectMetadata(): Metadata {
  const version =
    (import.meta.env['VITE_APP_VERSION'] as string | undefined) ?? 'unknown';
  const os =
    typeof navigator !== 'undefined' && navigator.platform
      ? navigator.platform
      : 'unknown';
  const userAgent =
    typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  return { version, os, userAgent };
}

function buildMailto(message: string, email: string, meta: Metadata): string {
  const subject = `${BRAND.name} ${meta.version} bug report`;
  const lines = [
    message,
    '',
    email ? `Reply to: ${email}` : '',
    '---',
    `${BRAND.name} version: ${meta.version}`,
    `Platform: ${meta.os}`,
    `User agent: ${meta.userAgent}`,
  ].filter(Boolean);
  return `mailto:${MAILTO_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

export interface BugReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BugReportDialog({ open, onOpenChange }: BugReportDialogProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [status, setStatus] = useState<Status>('idle');
  const [errorText, setErrorText] = useState('');

  // Reset form each time the dialog closes so the next open is clean.
  useEffect(() => {
    if (!open) {
      setStatus('idle');
      setErrorText('');
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    setStatus('sending');
    setErrorText('');

    const meta = collectMetadata();
    const payload: {
      message: string;
      email?: string;
      version?: string;
      os?: string;
      user_agent?: string;
    } = { message: trimmed };
    if (email.trim()) payload.email = email.trim();
    if (includeMetadata) {
      payload.version = meta.version;
      payload.os = meta.os;
      payload.user_agent = meta.userAgent;
    }

    try {
      // F-120: the bug report goes to Lantern infrastructure, not the user's
      // AI provider — opt out of the "Sending to your AI provider" pulse.
      const fetchFn = await getCorsSafeFetch({ signalEgress: false });
      const res = await fetchFn(BUG_REPORT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`server responded ${res.status}`);
      setStatus('success');
      setMessage('');
      setEmail('');
    } catch (err) {
      console.error('[BugReportDialog] submit failed', err);
      setErrorText(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }, [message, email, includeMetadata]);

  const handleFallbackEmail = useCallback(() => {
    const meta = collectMetadata();
    const url = buildMailto(message.trim(), email.trim(), meta);
    void openExternal(url);
    onOpenChange(false);
  }, [message, email, onOpenChange]);

  const canSubmit = message.trim().length > 0 && status !== 'sending';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-4 w-4 text-primary" />
            {t('common.bug-report.title')}
          </DialogTitle>
          <DialogDescription>
            {t('common.bug-report.description')}
          </DialogDescription>
        </DialogHeader>

        {status === 'success' ? (
          <div className="py-4 space-y-4">
            <p className="text-sm">
              {t('common.bug-report.success')}
            </p>
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="bug-report-message">
                  What happened? <span className="text-muted-foreground">(required)</span>
                </Label>
                <Textarea
                  id="bug-report-message"
                  data-testid="bug-report-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe the bug, what you expected, and what actually happened."
                  rows={6}
                  autoFocus
                  disabled={status === 'sending'}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bug-report-email">
                  {t('common.bug-report.email-label')} <span className="text-muted-foreground">{t('common.bug-report.email-optional')}</span>
                </Label>
                <Input
                  id="bug-report-email"
                  data-testid="bug-report-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={status === 'sending'}
                />
              </div>

              <label className="flex items-start gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  data-testid="bug-report-include-metadata"
                  checked={includeMetadata}
                  onChange={(e) => setIncludeMetadata(e.target.checked)}
                  className="mt-0.5"
                  disabled={status === 'sending'}
                />
                <span>
                  {t('common.bug-report.metadata-help')}
                </span>
              </label>

              {status === 'error' && (
                <div
                  data-testid="bug-report-error"
                  className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
                >
                  <p className="font-medium">{t('common.bug-report.send-failed')}</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    {errorText || t('common.bug-report.network-error')} {t('common.bug-report.retry-hint')}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={handleFallbackEmail}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                {t('common.bug-report.open-email-client')}
              </button>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  disabled={status === 'sending'}
                >
                  Cancel
                </Button>
                <Button
                  data-testid="bug-report-submit"
                  onClick={handleSubmit}
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
                    'Send report'
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
