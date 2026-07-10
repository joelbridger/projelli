import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function EmailReplyQuarantineBanner({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return <div data-testid="email-reply-quarantine-banner" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--kp-danger)', borderRadius: 999, background: 'var(--kp-warning-bg)', color: 'var(--kp-danger)', padding: '5px 9px', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}><AlertTriangle aria-hidden size={14} />{t('intake.quarantine.banner-count', { count })}</div>;
}
