import { Mail } from 'lucide-react';
import { Button, EmptyState } from '@/ui/kp';
import { useEntityLabelEnglish } from '@/platform/hooks/useEntityLabel';

// ── No-accounts empty state ────────────────────────────────────────────────

export interface NoAccountsStateProps {
  onOpenSettings?: (() => void) | undefined;
}

export function NoAccountsState({ onOpenSettings }: NoAccountsStateProps) {
  // Fixed-English escape hatch: this whole block is exempted from i18n
  // (see the eslint-disable below), so the noun stays English too.
  const entityLabel = useEntityLabelEnglish();
  return (
    /* eslint-disable lantern-i18n/no-hardcoded-string */
    <div data-testid="no-accounts-state">
      <EmptyState
        icon={Mail}
        title="No email connected"
        body={`Connect your email to search across it, file messages to a ${entityLabel.one}, and cite them in answers. It is imported to your machine, not our servers.`}
        actions={
          onOpenSettings ? (
            <Button variant="primary" size="md" onClick={onOpenSettings}>
              Connect your email
            </Button>
          ) : undefined
        }
      />
    </div>
    /* eslint-enable lantern-i18n/no-hardcoded-string */
  );
}
