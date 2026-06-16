import { Mail } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui/kp';

// ── No-accounts empty state ────────────────────────────────────────────────

export interface NoAccountsStateProps {
  onOpenSettings?: (() => void) | undefined;
}

export function NoAccountsState({ onOpenSettings }: NoAccountsStateProps) {
  return (
    /* eslint-disable keepance-i18n/no-hardcoded-string */
    <div data-testid="no-accounts-state">
      <EmptyState
        icon={Mail}
        title="No email connected"
        body="Connect your email to search across it, file messages to a matter, and cite them in answers. It is imported to your machine, not our servers."
        actions={
          onOpenSettings ? (
            <Button variant="primary" size="md" onClick={onOpenSettings}>
              Connect your email
            </Button>
          ) : undefined
        }
      />
    </div>
    /* eslint-enable keepance-i18n/no-hardcoded-string */
  );
}
