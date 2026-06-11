/**
 * EmailViewer (Keepance 3.0) — read-only viewer for ONE stored email.
 *
 * Given a message id (or a `mail:<id>` citation source id), it calls the
 * `mail_get_message` Tauri command, which reads the encrypted blob, decrypts it,
 * and returns the message broken into fields. We render from / to / cc / subject
 * / date and the (already plain-text) body, plus an attachment-name list.
 *
 * v1 mail is read-only: no reply, no compose, no folder tree, no attachment
 * download (names only). The one write the viewer offers is METADATA: a
 * per-message privilege control (VG-5c) that tags this message
 * attorney-client / work-product / not privileged, mirroring the file
 * privilege pattern, so a privileged email is excluded from default AI
 * retrieval. The body stored on disk was already stripped to text by
 * the sync layer (`normalize::html_to_text`), so it contains no markup; we render
 * it as React TEXT content (never `dangerouslySetInnerHTML`), which React escapes
 * — there is no HTML-injection surface. `stripResidualTags` is a defensive second
 * layer in case any angle-bracket markup slipped through.
 *
 * Light theme, navy accent, lean — matches the rest of Keepance.
 */

import { useEffect, useState } from 'react';
import { Mail, Calendar, Paperclip, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { mailGetMessage, type MailView } from '@/utils/mail-commands';
import { usePrivilegeStore, usePrivilegeForSource } from '@/stores/privilegeStore';
import {
  ALL_PRIVILEGE_STATUSES,
  isPrivileged,
  type Privilege,
} from '@/types/privilege';

export interface EmailViewerProps {
  /** Message id or `mail:<id>` citation source id. */
  sourceId: string;
  className?: string;
}

/**
 * Defensive: strip any residual `<...>` tags from a string. The stored body is
 * already plain text, so this is normally a no-op; it guards against a future
 * change to the storage format ever leaking raw markup into the rendered text.
 * (We still render via React text nodes, so this is belt-and-braces.)
 */
export function stripResidualTags(s: string): string {
  return s.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

/** Normalise the message id we display in the header / errors. */
function displayId(sourceId: string): string {
  return sourceId.startsWith('mail:') ? sourceId.slice('mail:'.length) : sourceId;
}

/**
 * The `mail:<id>` source id this message's indexed chunks were written under
 * (WS-PRIV). The viewer's `sourceId` prop may arrive with or without the
 * `mail:` prefix (citation-opened tabs carry it; some callers pass the bare
 * message id), so strip any existing prefix first to avoid `mail:mail:<id>`.
 */
function privilegeSourceId(sourceId: string): string {
  return `mail:${displayId(sourceId)}`;
}

/** Locale key for each privilege action, in the file UI's wording. */
const PRIVILEGE_OPTION_KEYS: Record<Privilege, string> = {
  'none': 'mail.viewer.privilege-clear',
  'attorney-client': 'mail.viewer.privilege-mark-ac',
  'work-product': 'mail.viewer.privilege-mark-wp',
};

export function EmailViewer({ sourceId, className }: EmailViewerProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState<MailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Privilege (WS-PRIV / VG-5c) — per-message tagging, mirroring the file
  // privilege control (`PrivilegeMenuItems`): write the privilege store with
  // the `mail:<id>` source id and let the store subscription in
  // `usePrivilegeWiring` re-tag the message's indexed chunks in place via
  // `rag_retag_privilege`. Same three values, same store path, no extra
  // service call here.
  const mailSourceId = privilegeSourceId(sourceId);
  const privilege = usePrivilegeForSource(mailSourceId);
  const setPrivilege = usePrivilegeStore((s) => s.setPrivilege);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessage(null);
    mailGetMessage(sourceId)
      .then((m) => {
        if (cancelled) return;
        setMessage(m);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof Error
            ? e.message
            : 'This email could not be opened. It may not be synced yet.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  if (loading) {
    return (
      <div
        data-testid="email-viewer-loading"
        className={`flex h-full items-center justify-center text-slate-500 ${className ?? ''}`}
      >
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-sm">Opening email…</span>
      </div>
    );
  }

  if (error || !message) {
    return (
      <div
        data-testid="email-viewer-error"
        className={`flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-slate-600 ${className ?? ''}`}
      >
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <p className="text-sm font-medium text-slate-800">This email could not be opened</p>
        <p className="max-w-md text-xs text-slate-500">
          {error ?? 'Message not found.'} (id: {displayId(sourceId)})
        </p>
      </div>
    );
  }

  const subject = message.subject.trim() || '(no subject)';
  const date = message.date ? formatDate(message.date) : null;

  return (
    <div
      data-testid="email-viewer"
      className={`flex h-full flex-col overflow-y-auto bg-white text-slate-900 ${className ?? ''}`}
    >
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        {/* Subject */}
        <div className="flex items-start gap-2">
          <Mail className="mt-1 h-5 w-5 shrink-0 text-[#0A2540]" />
          <h1 data-testid="email-viewer-subject" className="text-xl font-semibold leading-tight text-slate-900">
            {subject}
          </h1>
        </div>

        {/* Header card: from / to / cc / date */}
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <HeaderRow label="From">
            <span data-testid="email-viewer-from" className="font-medium text-slate-900">
              {message.from || '(unknown sender)'}
            </span>
          </HeaderRow>
          {message.to.length > 0 && (
            <HeaderRow label="To">
              <span data-testid="email-viewer-to" className="text-slate-700">
                {message.to.join(', ')}
              </span>
            </HeaderRow>
          )}
          {message.cc.length > 0 && (
            <HeaderRow label="Cc">
              <span data-testid="email-viewer-cc" className="text-slate-700">
                {message.cc.join(', ')}
              </span>
            </HeaderRow>
          )}
          {date && (
            <HeaderRow label="Date">
              <span className="inline-flex items-center gap-1 text-slate-600">
                <Calendar className="h-3.5 w-3.5" />
                {date}
              </span>
            </HeaderRow>
          )}
        </div>

        {/* Attachments (names only in v1) */}
        {message.hasAttachments && (
          <div
            data-testid="email-viewer-attachments"
            className="mt-4 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
          >
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            {message.attachments.length > 0 ? (
              <span>
                {message.attachments.length} attachment
                {message.attachments.length === 1 ? '' : 's'}:{' '}
                {message.attachments.map((a) => a.name).join(', ')}
              </span>
            ) : (
              <span>This message has attachments. Open it in your mail app to download them.</span>
            )}
          </div>
        )}

        {/* Privilege control (WS-PRIV / VG-5c) — tag THIS message. Compact
            radio row; the active status is highlighted. When privileged, a
            one-line consequence note states the retrieval effect. */}
        <div
          data-testid="email-privilege-control"
          data-privilege={privilege}
          className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              {t('mail.viewer.privilege-label')}
            </span>
            <div
              role="radiogroup"
              aria-label={t('mail.viewer.privilege-label')}
              className="flex overflow-hidden rounded-md border border-slate-200"
            >
              {ALL_PRIVILEGE_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  role="radio"
                  aria-checked={privilege === status}
                  data-testid={`email-privilege-option-${status}`}
                  onClick={() => {
                    setPrivilege(mailSourceId, status);
                  }}
                  className={`border-l border-slate-200 px-2 py-1 text-[11px] leading-tight first:border-l-0 ${
                    privilege === status
                      ? 'bg-[#0A2540] font-medium text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {t(PRIVILEGE_OPTION_KEYS[status])}
                </button>
              ))}
            </div>
          </div>
          {isPrivileged(privilege) && (
            <p
              data-testid="email-privilege-note"
              className="mt-1.5 text-[11px] leading-snug text-amber-700"
            >
              {t('mail.viewer.privilege-note')}
            </p>
          )}
        </div>

        {/* Body — rendered as plain text (React escapes it); preserve wrapping. */}
        <div className="mt-5 border-t border-slate-100 pt-5">
          <pre
            data-testid="email-viewer-body"
            className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-800"
          >
            {stripResidualTags(message.body)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function HeaderRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="w-12 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

/** Format an ISO date for display; fall back to the raw string if unparseable. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default EmailViewer;
