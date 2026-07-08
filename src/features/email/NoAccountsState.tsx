import { Mail } from 'lucide-react';
import { Button, EmptyState } from '@/ui/kp';
import { useTranslation } from 'react-i18next';

// ── No-accounts empty state ────────────────────────────────────────────────

export interface NoAccountsStateProps {
  onOpenSettings?: (() => void) | undefined;
}

export function NoAccountsState({ onOpenSettings }: NoAccountsStateProps) {
  const { t } = useTranslation();
  return (
    <div data-testid="no-accounts-state">
      <EmptyState
        icon={Mail}
        title={t('mail.no-accounts.title')}
        body={t('mail.no-accounts.body')}
        actions={
          onOpenSettings ? (
            <Button variant="primary" size="md" onClick={onOpenSettings}>
              {t('mail.no-accounts.action')}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
