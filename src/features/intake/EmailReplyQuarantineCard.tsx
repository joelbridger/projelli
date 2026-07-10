import { useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmailViewer } from '@/features/email/EmailViewer';
import { mailGetMessage } from '@/platform/utils/mail-commands';
import {
  dismissQuarantinedEmail,
  manualFileQuarantinedEmail,
} from '@/platform/intake/emailReplyQuarantineManualFile';
import { emailQuarantinePolicy } from '@/platform/intake/emailQuarantinePolicy';
import type { EmailReplyQuarantine } from '@/platform/intake/emailQuarantineStore';
import { useIntakeStore } from '@/platform/intake/intakeStore';
import type { EmailReplyQuarantineReason } from '@/platform/intake/emailReplyTypes';
import { Button } from '@/ui/button';

export interface EmailReplyQuarantineCardProps {
  quarantine: EmailReplyQuarantine;
  advisorId: string;
  onResolved: () => void;
  loadMessage?: typeof mailGetMessage;
}

export function EmailReplyQuarantineCard({
  quarantine,
  advisorId,
  onResolved,
  loadMessage = mailGetMessage,
}: EmailReplyQuarantineCardProps) {
  const { t } = useTranslation();
  const intakesById = useIntakeStore((state) => state.intakesById);
  const [reviewed, setReviewed] = useState(false);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [targetMatterId, setTargetMatterId] = useState('');
  const [targetRequestId, setTargetRequestId] = useState('');
  const [targetItemId, setTargetItemId] = useState('');
  const [attachmentId, setAttachmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const policy = emailQuarantinePolicy(
    quarantine.reason as EmailReplyQuarantineReason
  );
  const activeIntakes = useMemo(
    () =>
      Object.values(intakesById).filter(
        (intake) => intake.status === 'active'
      ),
    [intakesById]
  );
  const matters = useMemo(
    () => Array.from(new Map(activeIntakes.map((intake) => [intake.matterId, intake])).values()),
    [activeIntakes]
  );
  const selectedIntake = useMemo(
    () =>
      Object.values(intakesById).find(
        (intake) =>
          intake.matterId === targetMatterId && intake.intakeId === targetRequestId
      ) ?? null,
    [intakesById, targetMatterId, targetRequestId]
  );
  const openItems = selectedIntake?.items.filter(
    (item) => item.state === 'not_started' || item.state === 'needs_followup'
  ) ?? [];

  const openOriginal = async () => {
    setBusy(true);
    setError('');
    try {
      const message = await loadMessage(quarantine.messageId);
      setAttachmentIds(
        message.attachmentsUnsupported ? [] : message.attachments.map((item) => item.id)
      );
      setReviewed(true);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : t('intake.quarantine.open-error'));
    } finally {
      setBusy(false);
    }
  };

  const manualFile = async () => {
    setBusy(true);
    setError('');
    try {
      await manualFileQuarantinedEmail({
        quarantineId: quarantine.quarantineId,
        targetMatterId,
        targetRequestId,
        targetItemId,
        attachmentId,
        advisorId,
        reviewed,
      });
      onResolved();
    } catch (fileError: unknown) {
      setError(fileError instanceof Error ? fileError.message : t('intake.quarantine.file-error'));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    setError('');
    try {
      await dismissQuarantinedEmail({ quarantineId: quarantine.quarantineId, advisorId });
      onResolved();
    } catch (dismissError: unknown) {
      setError(dismissError instanceof Error ? dismissError.message : t('intake.quarantine.dismiss-error'));
    } finally {
      setBusy(false);
    }
  };

  const handleUnexpectedError = (actionError: unknown) => {
    setError(
      actionError instanceof Error
        ? actionError.message
        : t('intake.quarantine.file-error'),
    );
  };

  return (
    <article
      data-testid="email-reply-quarantine-card"
      style={{
        border: '2px solid var(--kp-danger)',
        borderRadius: 8,
        background: 'var(--kp-warning-bg)',
        padding: 14,
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
        <AlertTriangle aria-hidden size={20} style={{ color: 'var(--kp-danger)', flexShrink: 0 }} />
        <div>
          <h3 style={{ margin: 0, color: 'var(--kp-navy)', fontSize: 15, fontWeight: 800 }}>
            {t('intake.quarantine.title')}
          </h3>
          <p style={{ margin: '5px 0 0', color: 'var(--kp-danger)', fontSize: 13, fontWeight: 700 }}>
            {policy.reasonText}
          </p>
          <p style={{ margin: '5px 0 0', color: 'var(--color-muted-foreground)', fontSize: 12 }}>
            {policy.requiredAction}
          </p>
        </div>
      </div>
      <span
        data-testid="email-reply-quarantine-non-e2ee-label"
        style={{
          display: 'inline-flex', width: 'fit-content', alignItems: 'center', gap: 4,
          border: '1px solid var(--kp-warning-line)', borderRadius: 999, padding: '4px 8px',
          background: 'var(--kp-surface-card)', color: 'var(--kp-warning)', fontSize: 11, fontWeight: 800,
        }}
      >
        <ShieldAlert aria-hidden size={13} />
        {t('intake.quarantine.channel-label')}
      </span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button type="button" variant="outline" onClick={() => { void openOriginal().catch(handleUnexpectedError); }} disabled={busy}>
          <ExternalLink aria-hidden size={14} /> {t('intake.quarantine.open-original')}
        </Button>
        {policy.dismissible ? (
          <Button type="button" variant="outline" onClick={() => { void dismiss().catch(handleUnexpectedError); }} disabled={busy}>
            {t('intake.quarantine.dismiss')}
          </Button>
        ) : null}
      </div>
      {reviewed ? (
        <div data-testid="email-reply-quarantine-review" style={{ display: 'grid', gap: 8 }}>
          <p style={{ margin: 0, color: 'var(--kp-success-text)', fontSize: 12, fontWeight: 700 }}>
            {t('intake.quarantine.reviewed')}
          </p>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--kp-navy)' }}>
            {t('intake.quarantine.client')}
            <select aria-label={t('intake.quarantine.client')} value={targetMatterId} onChange={(event) => {
              setTargetMatterId(event.target.value); setTargetRequestId(''); setTargetItemId('');
            }}>
              <option value="">{t('intake.quarantine.choose-client')}</option>
              {matters.map((intake) => <option key={intake.matterId} value={intake.matterId}>{intake.clientFirstName}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--kp-navy)' }}>
            {t('intake.quarantine.request')}
            <select aria-label={t('intake.quarantine.request')} value={targetRequestId} disabled={!targetMatterId} onChange={(event) => {
              setTargetRequestId(event.target.value); setTargetItemId('');
            }}>
              <option value="">{t('intake.quarantine.choose-request')}</option>
              {activeIntakes.filter((intake) => intake.matterId === targetMatterId).map((intake) => <option key={intake.intakeId} value={intake.intakeId}>{t('intake.quarantine.onboarding-request')}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--kp-navy)' }}>
            {t('intake.quarantine.item')}
            <select aria-label={t('intake.quarantine.item')} value={targetItemId} disabled={!targetRequestId} onChange={(event) => { setTargetItemId(event.target.value); }}>
              <option value="">{t('intake.quarantine.choose-item')}</option>
              {openItems.map((item) => <option key={item.itemId} value={item.itemId}>{item.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--kp-navy)' }}>
            {t('intake.quarantine.attachment')}
            <select aria-label={t('intake.quarantine.attachment')} value={attachmentId} onChange={(event) => { setAttachmentId(event.target.value); }}>
              <option value="">{t('intake.quarantine.choose-attachment')}</option>
              {attachmentIds.map((id, index) => <option key={id} value={id}>{t('intake.quarantine.attachment-number', { count: index + 1 })}</option>)}
            </select>
          </label>
          <Button type="button" onClick={() => { void manualFile().catch(handleUnexpectedError); }} disabled={busy || !targetMatterId || !targetRequestId || !targetItemId || !attachmentId}>
            {t('intake.quarantine.confirm-file')}
          </Button>
        </div>
      ) : null}
      {reviewed ? (
        <div
          aria-label={t('intake.quarantine.original-email')}
          style={{ borderTop: '1px solid var(--kp-warning-line)', paddingTop: 10 }}
        >
          <EmailViewer sourceId={quarantine.messageId} />
        </div>
      ) : null}
      {error ? <p role="alert" style={{ margin: 0, color: 'var(--kp-danger)', fontSize: 12 }}>{error}</p> : null}
    </article>
  );
}
