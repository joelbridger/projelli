import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  listEmailQuarantines,
  type EmailReplyQuarantine,
} from '@/platform/intake/emailQuarantineStore';
import { EmailReplyQuarantineCard } from './EmailReplyQuarantineCard';

export interface EmailReplyQuarantinePanelProps {
  matterId: string;
  advisorId: string;
}

export function EmailReplyQuarantinePanel({ matterId, advisorId }: EmailReplyQuarantinePanelProps) {
  const { t } = useTranslation();
  const [quarantines, setQuarantines] = useState<EmailReplyQuarantine[]>([]);
  const [error, setError] = useState('');
  const load = () => {
    void listEmailQuarantines(matterId)
      .then(setQuarantines)
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : t('intake.quarantine.load-error')));
  };
  useEffect(() => {
    load();
    const interval = window.setInterval(load, 5000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId]);
  if (quarantines.length === 0 && !error) return null;
  return (
    <section data-testid="email-reply-quarantine-panel" style={{ display: 'grid', gap: 8 }}>
      {quarantines.map((quarantine) => (
        <EmailReplyQuarantineCard key={quarantine.quarantineId} quarantine={quarantine} matterId={matterId} advisorId={advisorId} onResolved={load} />
      ))}
      {error ? <p role="alert" style={{ margin: 0, color: 'var(--kp-danger)', fontSize: 12 }}>{error}</p> : null}
    </section>
  );
}
