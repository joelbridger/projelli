import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Mail, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { mailConnectedAccounts, type ConnectedAccount } from '@/platform/utils/mail-commands';
import { isPersistedLocalOnly } from '@/platform/privacy/localOnlyGuard';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button as DialogButton } from '@/ui/button';
import { AuditService } from '@/platform/audit/AuditService';
import type { MeetingMeta } from './meetingStore';
import type { TranscriptFile } from '@/platform/types/meeting';
import { mmss } from './meetingSources';
import {
  buildMeetingArtifactAvailability,
  buildMeetingSendPreview,
  meetingSendLogSummary,
  meetingSendTitle,
  sendMeetingArtifacts,
  type MeetingSendLogEntry,
} from './meetingArtifactDelivery';

export interface MeetingArtifactSendPanelProps {
  matterId: string;
  meetingDir: string;
  meta: MeetingMeta;
  clientName: string;
  workspaceService: WorkspaceService | null;
  hasAudio: boolean;
  hasTranscript: boolean;
  hasNotes: boolean;
  summaryReady: boolean;
  transcript: TranscriptFile | null;
  buildSummaryDocxBytes: () => Promise<Uint8Array>;
  onSent: (meta: MeetingMeta) => void;
}

const audit = new AuditService('meetings');

export function MeetingArtifactSendPanel({
  matterId,
  meetingDir,
  meta,
  clientName,
  workspaceService,
  hasAudio,
  hasTranscript,
  hasNotes,
  summaryReady,
  transcript,
  buildSummaryDocxBytes,
  onSent,
}: MeetingArtifactSendPanelProps) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [selectedAccountKey, setSelectedAccountKey] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const request = { cancelled: false };
    const loadAccounts = async () => {
      const next = await mailConnectedAccounts();
      if (request.cancelled) return;
      setAccounts(next);
      setSelectedAccountKey((current) => current || accountKey(next[0]));
    };
    void loadAccounts().catch(() => {
      if (!request.cancelled) setAccounts([]);
    });
    return () => { request.cancelled = true; };
  }, []);

  const title = meetingSendTitle(meta, t);
  const availability = useMemo(
    () => buildMeetingArtifactAvailability({ hasAudio, hasTranscript, hasNotes, summaryReady }),
    [hasAudio, hasTranscript, hasNotes, summaryReady],
  );
  const preview = useMemo(
    () => buildMeetingSendPreview({ meta, availability, title, clientName, t }),
    [meta, availability, title, clientName, t],
  );
  const sendLog = meetingSendLogSummary(meta);
  const sentArtifacts = useMemo(
    () => new Set(sendLog.filter((entry) => entry.status === 'sent').map((entry) => entry.artifact)),
    [sendLog],
  );
  const selectedAccount = accounts.find((account) => accountKey(account) === selectedAccountKey) ?? accounts[0] ?? null;
  const localOnly = isPersistedLocalOnly();
  const canReview = Boolean(workspaceService && selectedAccount && preview.items.length > 0 && meta.reviewedAt && !localOnly);

  const handleConfirmSend = async () => {
    if (!workspaceService || !selectedAccount) return;
    setSending(true);
    setError(null);
    setStatus(null);
    try {
      const entries = await sendMeetingArtifacts({
        workspaceService,
        meetingDir,
        matterId,
        meta,
        account: selectedAccount,
        preview,
        availability,
        clientName,
        t,
        transcriptText: transcriptToText(transcript),
        buildSummaryDocxBytes,
        audit,
      });
      const raw = await workspaceService.readFile(`${meetingDir}/meeting.json`);
      onSent(JSON.parse(raw) as MeetingMeta);
      setConfirmOpen(false);
      const failed = entries.filter((entry) => entry.status === 'failed').length;
      setStatus(failed > 0
        ? `${t('meetings.entry.send.sent-with-errors', { count: entries.length, failed, total: entries.length })} ${entries
          .filter((entry) => entry.status === 'failed')
          .map((entry) => `${entry.artifactLabel}: ${entry.error ?? t('meetings.entry.send.failed-without-message')}`)
          .join(' ')}`
        : t('meetings.entry.send.sent', { count: entries.length }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      data-testid="meeting-artifact-send-panel"
      style={{
        margin: '10px var(--kp-gutter) 0',
        border: '1px solid var(--kp-divider)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-background)',
        padding: 'var(--kp-space-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--kp-space-md)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--kp-space-md)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, color: 'var(--kp-navy)', fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Mail style={{ width: 14, height: 14 }} />
            {t('meetings.entry.send.title')}
          </h3>
          <p style={{ margin: '4px 0 0', color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', lineHeight: 1.5 }}>
            {t('meetings.entry.send.privacy-note')}
          </p>
        </div>
        <button
          type="button"
          data-testid="meeting-send-review"
          onClick={() => { setConfirmOpen(true); setError(null); setStatus(null); }}
          disabled={!canReview}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            border: '1px solid var(--kp-divider)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--kp-accent)',
            color: 'var(--color-primary-foreground)',
            padding: '7px 11px',
            fontSize: 'var(--kp-font-xs)',
            fontFamily: 'inherit',
            cursor: canReview ? 'pointer' : 'not-allowed',
            opacity: canReview ? 1 : 0.6,
          }}
        >
          <Send style={{ width: 13, height: 13 }} />
          {t('meetings.entry.send.review-button')}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 0.5fr) minmax(220px, 1fr)', gap: 'var(--kp-space-md)' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
          {t('meetings.entry.send.account-label')}
          <select
            data-testid="meeting-send-account"
            value={selectedAccountKey}
            onChange={(event) => { setSelectedAccountKey(event.target.value); }}
            disabled={accounts.length === 0}
            style={{
              border: '1px solid var(--kp-divider)',
              borderRadius: 'var(--radius-md)',
              padding: '7px 9px',
              color: 'var(--color-foreground)',
              background: 'var(--color-background)',
              fontSize: 'var(--kp-font-xs)',
              fontFamily: 'inherit',
            }}
          >
            {accounts.length === 0 ? (
              <option value="">{t('meetings.entry.send.no-account')}</option>
            ) : accounts.map((account) => (
              <option key={accountKey(account)} value={accountKey(account)}>{account.label}</option>
            ))}
          </select>
        </label>
        <div style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', lineHeight: 1.5 }}>
          {!meta.reviewedAt && t('meetings.entry.send.needs-review')}
          {meta.reviewedAt && preview.items.length === 0 && t('meetings.entry.send.no-items')}
          {localOnly && t('meetings.entry.send.local-only-blocked')}
          {preview.items.length > 0 && !localOnly && (
            <span>{t('meetings.entry.send.ready-count', { count: preview.items.length })}</span>
          )}
        </div>
      </div>

      {preview.items.length > 0 && (
        <div data-testid="meeting-send-preview-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {preview.items.map((item) => (
            <div key={item.artifact} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--kp-font-xs)', color: 'var(--kp-navy)' }}>
              <strong>{item.artifactLabel}</strong>
              <span style={{ color: 'var(--color-muted-foreground)' }}>
                {t('meetings.entry.send.to-line', { recipients: item.recipients.map(formatRecipient).join(', ') })}
              </span>
              <span style={{ color: 'var(--color-muted-foreground)' }}>
                {t('meetings.entry.send.attachment-line', { attachment: item.attachmentName })}
              </span>
            </div>
          ))}
        </div>
      )}

      {preview.missing.length > 0 && (
        <div data-testid="meeting-send-missing" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)' }}>
          <AlertTriangle style={{ width: 13, height: 13 }} />
          {t('meetings.entry.send.missing', { artifacts: preview.missing.map((artifact) => t(`meetings.entry.recipients.artifacts.${artifact}.label`)).join(', ') })}
        </div>
      )}

      {sendLog.length > 0 && (
        <div data-testid="meeting-send-log" style={{ borderTop: '1px solid var(--kp-divider)', paddingTop: 'var(--kp-space-sm)', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ color: 'var(--kp-navy)', fontSize: 'var(--kp-font-xs)', fontWeight: 'var(--kp-weight-semibold)' }}>{t('meetings.entry.send.log-title')}</div>
          {sendLog.slice(-4).reverse().map((entry: MeetingSendLogEntry) => (
            <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)' }}>
              {entry.status === 'sent' && <Check style={{ width: 12, height: 12, color: 'var(--kp-accent)' }} />}
              {entry.status !== 'sent' && <AlertTriangle style={{ width: 12, height: 12 }} />}
              <span>{t('meetings.entry.send.log-row', {
                status: entry.status,
                artifact: entry.artifactLabel,
                count: entry.recipients.length,
                date: new Date(entry.sentAt).toLocaleString(),
              })}</span>
            </div>
          ))}
        </div>
      )}

      {(error || status) && (
        <div data-testid="meeting-send-status" style={{ fontSize: 'var(--kp-font-xs)', color: error ? 'var(--color-destructive)' : 'var(--color-muted-foreground)' }}>
          {error ?? status}
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('meetings.entry.send.confirm-title')}</DialogTitle>
          </DialogHeader>
          <div data-testid="meeting-send-confirm-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)', color: 'var(--color-foreground)', fontSize: 'var(--kp-font-sm)' }}>
            <p style={{ margin: 0, color: 'var(--color-muted-foreground)', lineHeight: 1.5 }}>
              {t('meetings.entry.send.confirm-privacy', { account: selectedAccount?.label ?? '' })}
            </p>
            {preview.items.map((item) => (
              <div key={item.artifact} data-testid={`meeting-send-confirm-${item.artifact}`} style={{ border: '1px solid var(--kp-divider)', borderRadius: 'var(--radius-md)', padding: 'var(--kp-space-sm)' }}>
                <div style={{ color: 'var(--kp-navy)', fontWeight: 'var(--kp-weight-semibold)' }}>{item.artifactLabel}</div>
                {sentArtifacts.has(item.artifact) && (
                  <div style={{ marginTop: 4, color: 'var(--color-destructive)', fontWeight: 'var(--kp-weight-semibold)' }}>
                    {t('meetings.entry.send.send-again-warning', { artifact: item.artifactLabel })}
                  </div>
                )}
                <div>{t('meetings.entry.send.to-line', { recipients: item.recipients.map(formatRecipient).join(', ') })}</div>
                <div>{t('meetings.entry.send.subject-line', { subject: item.subject })}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{t('meetings.entry.send.body-line', { body: item.body })}</div>
                <div>{t('meetings.entry.send.attachment-line', { attachment: item.attachmentName })}</div>
              </div>
            ))}
            {error && <div style={{ color: 'var(--color-destructive)' }}>{error}</div>}
          </div>
          <DialogFooter>
            <DialogButton type="button" variant="outline" onClick={() => { setConfirmOpen(false); }} disabled={sending}>
              {t('common.actions.cancel')}
            </DialogButton>
            <DialogButton type="button" onClick={() => { void handleConfirmSend().catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); }); }} disabled={sending || !canReview}>
              {sending ? t('meetings.entry.send.sending') : t('meetings.entry.send.confirm-button')}
            </DialogButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function accountKey(account: ConnectedAccount | undefined): string {
  return account ? `${account.provider}:${account.account}` : '';
}

function formatRecipient(recipient: { email: string; name?: string }): string {
  return recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email;
}

function transcriptToText(transcript: TranscriptFile | null): string {
  if (!transcript) return '';
  return transcript.segments
    .map((seg) => `${mmss(seg.startMs)} ${seg.speaker}: ${seg.text}`)
    .join('\n');
}
