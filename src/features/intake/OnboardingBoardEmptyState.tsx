import { ClipboardList, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, EmptyState } from '@/ui/kp';

interface OnboardingBoardEmptyStateProps {
  onNewClient: () => void;
}

export function OnboardingBoardEmptyState({
  onNewClient,
}: OnboardingBoardEmptyStateProps) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="onboarding-board-empty"
      style={{
        padding: '44px 24px 56px',
      }}
    >
      <EmptyState
        compact
        icon={ClipboardList}
        title={t('intake.board.empty.title')}
        body={t('intake.board.empty.body')}
        actions={
          <Button
            variant="primary"
            size="md"
            iconLeft={Plus}
            onClick={onNewClient}
            data-testid="onboarding-board-empty-new-client"
          >
            {t('intake.board.new-client')}
          </Button>
        }
      />
    </div>
  );
}
