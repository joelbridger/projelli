import { Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface EmailReplyProposalBannerProps {
  count: number;
}

export function EmailReplyProposalBanner({ count }: EmailReplyProposalBannerProps) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <div
      data-testid="email-reply-proposal-banner"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        border: '1px solid var(--kp-warning-line)',
        borderRadius: 999,
        background: 'var(--kp-warning-bg)',
        color: 'var(--kp-warning)',
        padding: '5px 9px',
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      <Mail aria-hidden size={14} />
      {t('intake.email-reply.banner-count', { count })}
    </div>
  );
}
