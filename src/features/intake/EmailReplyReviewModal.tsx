import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/button';
import type { EmailReplyProposalRecord } from '@/platform/intake/emailReplyProposalStore';
import { EmailReplyProposalRow } from './EmailReplyProposalRow';

export interface EmailReplyReviewModalProps {
  proposal: EmailReplyProposalRecord;
  selectedIds: Set<string>;
  restrictedApprovedIds: Set<string>;
  onToggle: (id: string) => void;
  onRestrictedApprove: (id: string, approved: boolean) => void;
  onAccept: () => void;
  onDismiss: () => void;
  onClose: () => void;
  accepting: boolean;
  dismissing: boolean;
}

export function EmailReplyReviewModal({
  proposal,
  selectedIds,
  restrictedApprovedIds,
  onToggle,
  onRestrictedApprove,
  onAccept,
  onDismiss,
  onClose,
  accepting,
  dismissing,
}: EmailReplyReviewModalProps) {
  const { t } = useTranslation();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('intake.email-reply.review-title')}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.28)',
        display: 'grid',
        placeItems: 'center',
        padding: 18,
        zIndex: 60,
      }}
    >
      <div
        style={{
          width: 'min(720px, 100%)',
          maxHeight: 'min(720px, 92vh)',
          overflow: 'auto',
          background: 'var(--color-background)',
          border: '1px solid var(--kp-divider)',
          borderRadius: 8,
          boxShadow: '0 18px 50px rgba(15, 23, 42, 0.18)',
          padding: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                color: 'var(--kp-navy)',
                fontSize: 16,
                fontWeight: 800,
              }}
            >
              {t('intake.email-reply.review-title')}
            </h3>
            <p
              style={{
                margin: '4px 0 0',
                color: 'var(--color-muted-foreground)',
                fontSize: 12,
              }}
            >
              {t('intake.email-reply.source-line', {
                sender: proposal.sender,
              })}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {proposal.items.map((row) => (
            <EmailReplyProposalRow
              key={row.id}
              row={row}
              checked={selectedIds.has(row.id)}
              restrictedApproved={restrictedApprovedIds.has(row.id)}
              onToggle={onToggle}
              onRestrictedApprove={onRestrictedApprove}
            />
          ))}
        </div>
        <div
          style={{
            marginTop: 14,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <Button type="button" variant="outline" onClick={onClose}>
            {t('intake.email-reply.cancel')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onDismiss}
            disabled={accepting || dismissing}
          >
            {t('intake.email-reply.dismiss')}
          </Button>
          <Button
            type="button"
            onClick={onAccept}
            disabled={accepting || dismissing || selectedIds.size === 0}
          >
            {t('intake.email-reply.accept-selected')}
          </Button>
        </div>
      </div>
    </div>
  );
}
