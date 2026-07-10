import { AlertTriangle, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  isEmailReplyProposalItemSelectable,
  type EmailReplyProposalItem,
} from '@/platform/intake/emailReplyProposalStore';

export interface EmailReplyProposalRowProps {
  row: EmailReplyProposalItem;
  checked: boolean;
  restrictedApproved: boolean;
  onToggle: (id: string) => void;
  onRestrictedApprove: (id: string, approved: boolean) => void;
}

function confidenceColor(confidence: string): string {
  if (confidence === 'high') return 'var(--kp-success-text)';
  if (confidence === 'medium') return 'var(--kp-warning)';
  return 'var(--color-muted-foreground)';
}

export function EmailReplyProposalRow({
  row,
  checked,
  restrictedApproved,
  onToggle,
  onRestrictedApprove,
}: EmailReplyProposalRowProps) {
  const { t } = useTranslation();
  const restricted = row.bodyFact?.sensitivity === 'restricted';
  const selectable = isEmailReplyProposalItemSelectable(row);
  return (
    <div
      data-testid="email-reply-proposal-row"
      style={{
        border: '1px solid var(--kp-divider)',
        borderRadius: 8,
        background: 'var(--kp-surface-card)',
        padding: 12,
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr)',
        gap: 10,
      }}
    >
      <input
        aria-label={t('intake.emailReply.select-row')}
        type="checkbox"
        checked={checked}
        disabled={!selectable}
        onChange={() => {
          onToggle(row.id);
        }}
        style={{ marginTop: 3 }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <FileText
            aria-hidden
            size={16}
            style={{ color: 'var(--color-muted-foreground)' }}
          />
          <strong style={{ fontSize: 13, color: 'var(--kp-navy)' }}>
            {row.label}
          </strong>
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: confidenceColor(row.confidence),
              textTransform: 'uppercase',
            }}
          >
            {t(`intake.emailReply.confidence.${row.confidence}`)}
          </span>
        </div>
        <div
          style={{
            marginTop: 5,
            color: 'var(--color-muted-foreground)',
            fontSize: 12,
            overflowWrap: 'anywhere',
          }}
        >
          {row.attachment
            ? row.attachment.filename || row.attachment.name
            : row.bodyFact?.displayValue ?? t('intake.emailReply.body-note')}
        </div>
        {row.reasoning ? (
          <div
            data-testid="email-reply-reasoning"
            style={{
              marginTop: 5,
              color: 'var(--color-muted-foreground)',
              fontSize: 12,
            }}
          >
            {row.reasoning}
          </div>
        ) : null}
        {!selectable ? (
          <div
            style={{
              marginTop: 5,
              color: 'var(--kp-warning)',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {t('intake.emailReply.needs-manual-review')}
          </div>
        ) : null}
        {restricted ? (
          <label
            style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              color: 'var(--kp-warning)',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <input
              type="checkbox"
              checked={restrictedApproved}
              onChange={(event) => {
                onRestrictedApprove(row.id, event.currentTarget.checked);
              }}
            />
            <AlertTriangle aria-hidden size={14} />
            {t('intake.emailReply.confirm-sensitive')}
          </label>
        ) : null}
      </div>
    </div>
  );
}
