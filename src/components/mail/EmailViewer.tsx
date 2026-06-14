/**
 * EmailViewer (Keepance 3.0) — read-only viewer for ONE stored email.
 *
 * Given a message id (or a `mail:<id>` citation source id), it calls the
 * `mail_get_message` Tauri command, which reads the encrypted blob, decrypts it,
 * and returns the message broken into fields. We render from / to / cc / subject
 * / date and the (already plain-text) body, plus an attachment list with
 * on-demand download.
 *
 * Additions in this version:
 *   - Attachment download: click an attachment to fetch bytes via mailGetAttachment
 *     and trigger a browser download (blob URL trick, no disk persistence).
 *   - File to matter: pick a matter to call mailRetagMessageMatter for this message.
 *   - Reply area: "Draft with AI" generates a reply using buildProviderAsync;
 *     "Reply in your mail app" opens a mailto: link.
 *
 * The body stored on disk was already stripped to text by the sync layer
 * (`normalize::html_to_text`), so it contains no markup; we render it as React
 * TEXT content (never `dangerouslySetInnerHTML`), which React escapes.
 * `stripResidualTags` is a defensive second layer.
 *
 * Light theme, navy accent, lean — matches the rest of Keepance.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Mail,
  Calendar,
  Paperclip,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  FolderInput,
  Download,
  Copy,
  FileText,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  mailGetMessage,
  mailGetAttachment,
  mailRetagMessageMatter,
  type MailView,
} from '@/utils/mail-commands';
import { usePrivilegeStore, usePrivilegeForSource } from '@/stores/privilegeStore';
import { useMatters } from '@/stores/matterStore';
import {
  ALL_PRIVILEGE_STATUSES,
  isPrivileged,
  type Privilege,
} from '@/types/privilege';
import { deriveFilenameFromMessage } from '@/utils/fileDrop';
import { createKeychainService } from '@/modules/models/KeychainService';
import { createClaudeProvider } from '@/modules/models/ClaudeProvider';
import { createOpenAIProvider } from '@/modules/models/OpenAIProvider';
import { createGeminiProvider } from '@/modules/models/GeminiProvider';
import { OllamaProvider } from '@/modules/models/OllamaProvider';
import type { Provider } from '@/modules/models/Provider';
import { matterLabel } from '@/modules/memory/matterResolver';

export interface EmailViewerProps {
  /** Message id or `mail:<id>` citation source id. */
  sourceId: string;
  className?: string;
}

/**
 * Defensive: strip any residual `<...>` tags from a string. The stored body is
 * already plain text, so this is normally a no-op; it guards against a future
 * change to the storage format ever leaking raw markup into the rendered text.
 */
// eslint-disable-next-line react-refresh/only-export-components -- exported for direct test import; component is the primary export
export function stripResidualTags(s: string): string {
  return s.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

/** Normalise the message id we display in the header / errors. */
function displayId(sourceId: string): string {
  return sourceId.startsWith('mail:') ? sourceId.slice('mail:'.length) : sourceId;
}

/**
 * The `mail:<id>` source id this message's indexed chunks were written under
 * (WS-PRIV). Strip any existing prefix first to avoid `mail:mail:<id>`.
 */
function privilegeSourceId(sourceId: string): string {
  return `mail:${displayId(sourceId)}`;
}

/** Locale key for each privilege action. */
const PRIVILEGE_OPTION_KEYS: Record<Privilege, string> = {
  'none': 'mail.viewer.privilege-clear',
  'attorney-client': 'mail.viewer.privilege-mark-ac',
  'work-product': 'mail.viewer.privilege-mark-wp',
};

// ── buildProviderAsync — mirrors ReimaginedAsk.tsx pattern ─────────────────

async function buildProviderAsync(): Promise<Provider> {
  const kc = createKeychainService('localStorage');
  const anthropicKey = await kc.getKey('anthropic');
  if (anthropicKey?.trim()) return createClaudeProvider({ apiKey: anthropicKey.trim() });
  const openaiKey = await kc.getKey('openai');
  if (openaiKey?.trim()) return createOpenAIProvider({ apiKey: openaiKey.trim() });
  const googleKey = await kc.getKey('google');
  if (googleKey?.trim()) return createGeminiProvider({ apiKey: googleKey.trim() });
  return new OllamaProvider({});
}

// ── downloadBase64File — browser-side blob download, no disk persistence ───

function downloadBase64File(filename: string, contentType: string, bytesBase64: string) {
  const byteChars = atob(bytesBase64);
  const byteNums = new Array(byteChars.length).fill(0).map((_, i) => byteChars.charCodeAt(i));
  const blob = new Blob([new Uint8Array(byteNums)], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Components ─────────────────────────────────────────────────────────────

export function EmailViewer({ sourceId, className }: EmailViewerProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState<MailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Privilege (WS-PRIV / VG-5c)
  const mailSourceId = privilegeSourceId(sourceId);
  const privilege = usePrivilegeForSource(mailSourceId);
  const setPrivilege = usePrivilegeStore((s) => s.setPrivilege);

  // Attachment download state
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // File to matter state
  const matters = useMatters();
  const [filingMatter, setFilingMatter] = useState<string | null>(null);
  const [fileSuccess, setFileSuccess] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Reply area state
  const [replyMode, setReplyMode] = useState<'none' | 'draft' | 'mailto'>('none');
  const [replyDraft, setReplyDraft] = useState('');
  const [replyDraftLoading, setReplyDraftLoading] = useState(false);
  const [replyDraftError, setReplyDraftError] = useState<string | null>(null);
  const [replyCopied, setReplyCopied] = useState(false);

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

  const handleDownloadAttachment = useCallback(async (attId: string, attName: string) => {
    if (!message) return;
    const provider = message.provider ?? '';
    const account = message.account ?? '';
    setDownloadingId(attId);
    setDownloadError(null);
    try {
      const data = await mailGetAttachment(provider, account, message.id, attId);
      downloadBase64File(data.filename || attName, data.contentType, data.bytesBase64);
    } catch (e: unknown) {
      setDownloadError(e instanceof Error ? e.message : 'Failed to download attachment.');
    } finally {
      setDownloadingId(null);
    }
  }, [message]);

  const handleFileToMatter = useCallback(async (matterId: string) => {
    if (!message) return;
    setFilingMatter(matterId);
    setFileError(null);
    setFileSuccess(false);
    try {
      await mailRetagMessageMatter(message.id, matterId);
      setFileSuccess(true);
      setTimeout(() => { setFileSuccess(false); }, 2500);
    } catch (e: unknown) {
      setFileError(e instanceof Error ? e.message : 'Failed to file email to matter.');
    } finally {
      setFilingMatter(null);
    }
  }, [message]);

  const handleDraftWithAI = useCallback(async () => {
    if (!message) return;
    setReplyMode('draft');
    setReplyDraftLoading(true);
    setReplyDraftError(null);
    setReplyDraft('');
    try {
      const provider = await buildProviderAsync();
      const prompt = `You are drafting a professional reply to the following email.\n\nFrom: ${message.from}\nSubject: ${message.subject}\n\nBody:\n${stripResidualTags(message.body)}\n\nWrite a clear, professional reply. Return only the reply text, no subject line or headers.`;
      const response = await provider.sendMessage(prompt);
      setReplyDraft(response.content);
    } catch (e: unknown) {
      setReplyDraftError(e instanceof Error ? e.message : 'Failed to generate reply. Check your API key in Settings.');
    } finally {
      setReplyDraftLoading(false);
    }
  }, [message]);

  const handleCopyReply = useCallback(() => {
    if (!replyDraft) return;
    void navigator.clipboard.writeText(replyDraft).then(() => {
      setReplyCopied(true);
      setTimeout(() => { setReplyCopied(false); }, 2000);
    });
  }, [replyDraft]);

  const handleSaveReplyAsDoc = useCallback(() => {
    if (!replyDraft) return;
    const filename = deriveFilenameFromMessage(replyDraft);
    const blob = new Blob([replyDraft], { type: 'text/markdown; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [replyDraft]);

  if (loading) {
    return (
      <div
        data-testid="email-viewer-loading"
        className={`flex h-full items-center justify-center text-slate-500 ${className ?? ''}`}
      >
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-sm">Opening email...</span>
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
        {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
        <p className="text-sm font-medium text-slate-800">This email could not be opened</p>
        <p className="max-w-md text-xs text-slate-500">
          {error ?? 'Message not found.'} (id: {displayId(sourceId)})
        </p>
      </div>
    );
  }

  const subject = message.subject.trim() || '(no subject)';
  const date = message.date ? formatDate(message.date) : null;

  // mailto: link — extract plain email address from "Name <addr>" format
  const fromAddr = message.from.match(/<([^>]+)>/)?.[1] ?? message.from;
  const mailtoHref = `mailto:${encodeURIComponent(fromAddr)}?subject=${encodeURIComponent(`Re: ${subject}`)}`;

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

        {/* Attachments — clickable download */}
        {message.hasAttachments && (
          <div
            data-testid="email-viewer-attachments"
            className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-2"
          >
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Paperclip className="h-3.5 w-3.5" />
              { }
              Attachments
              { }
            </div>
            {downloadError && (
              <p className="mb-1.5 flex items-center gap-1 text-[11px] text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                {downloadError}
              </p>
            )}
            {message.attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {message.attachments.map((att) => (
                  <button
                    key={att.id}
                    type="button"
                    data-testid={`attachment-download-${att.id}`}
                    disabled={downloadingId === att.id}
                    onClick={() => { void handleDownloadAttachment(att.id, att.name); }}
                    className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                    title={`Download ${att.name}`}
                  >
                    {downloadingId === att.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    {att.name}
                  </button>
                ))}
              </div>
            ) : (
              /* eslint-disable keepance-i18n/no-hardcoded-string */
              <span className="text-xs text-slate-500">This message has attachments. Open it in your mail app to download them.</span>
              /* eslint-enable keepance-i18n/no-hardcoded-string */
            )}
          </div>
        )}

        {/* Privilege control (WS-PRIV / VG-5c) */}
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

        {/* File to matter */}
        <div
          data-testid="email-file-to-matter"
          className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-2"
        >
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <FolderInput className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            File to matter
          </div>
          {fileError && (
            <p className="mb-1.5 flex items-center gap-1 text-[11px] text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              {fileError}
            </p>
          )}
          {fileSuccess && (
            <p className="mb-1.5 text-[11px] text-emerald-700">Filed successfully.</p>
          )}
          {matters.length === 0 ? (
            <p className="text-xs text-slate-400">No matters yet. Create a matter first.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {matters.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`file-to-matter-btn-${m.id}`}
                  disabled={filingMatter === m.id}
                  onClick={() => { void handleFileToMatter(m.id); }}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  {filingMatter === m.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <FolderInput className="h-3 w-3" />
                  )}
                  {matterLabel(m)}
                </button>
              ))}
            </div>
          )}
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
        </div>

        {/* Body */}
        <div className="mt-5 border-t border-slate-100 pt-5">
          <pre
            data-testid="email-viewer-body"
            className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-800"
          >
            {stripResidualTags(message.body)}
          </pre>
        </div>

        {/* Reply area */}
        <div
          data-testid="email-reply-area"
          className="mt-6 rounded-md border border-slate-200 bg-white"
        >
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="text-xs font-medium text-slate-600">Reply</span>
          </div>
          <div className="flex gap-2 px-3 py-2.5">
            <button
              type="button"
              data-testid="reply-draft-ai-btn"
              onClick={() => { void handleDraftWithAI(); }}
              disabled={replyDraftLoading}
              className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-[#0A2540] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0c2f52] disabled:opacity-60"
            >
              {replyDraftLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <FileText className="h-3 w-3" />
              )}
              Draft with AI
            </button>
            <a
              href={mailtoHref}
              data-testid="reply-mailto-link"
              className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              rel="noopener noreferrer"
            >
              <Mail className="h-3 w-3" />
              Reply in your mail app
            </a>
          </div>

          {/* AI draft error */}
          {replyMode === 'draft' && replyDraftError && (
            <div className="border-t border-slate-100 px-3 py-2">
              <p className="flex items-center gap-1 text-[11px] text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                {replyDraftError}
              </p>
            </div>
          )}

          {/* AI draft result */}
          {replyMode === 'draft' && !replyDraftLoading && replyDraft && (
            <div className="border-t border-slate-100 px-3 py-3">
              <textarea
                data-testid="reply-draft-textarea"
                value={replyDraft}
                onChange={(e) => { setReplyDraft(e.target.value); }}
                className="w-full rounded border border-slate-200 bg-slate-50 p-2 text-sm leading-relaxed text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0A2540]"
                rows={8}
                style={{ resize: 'vertical', fontFamily: 'var(--font-sans)' }}
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  data-testid="reply-copy-btn"
                  onClick={handleCopyReply}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                >
                  <Copy className="h-3 w-3" />
                  {replyCopied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  type="button"
                  data-testid="reply-save-doc-btn"
                  onClick={handleSaveReplyAsDoc}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                >
                  <FileText className="h-3 w-3" />
                  Save as document
                </button>
              </div>
            </div>
          )}
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
