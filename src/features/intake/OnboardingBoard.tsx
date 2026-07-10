import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Plus } from 'lucide-react';

import {
  EV_MATTER_LAUNCH,
  EV_OPEN_MATTER_MANAGER,
} from '@/config/identity';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useIntakeStore } from '@/platform/intake/intakeStore';
import {
  deriveOnboardingRow,
  sortOnboardingRows,
  type OnboardingRow,
} from '@/platform/intake/onboardingModel';
import { DEFAULT_ONBOARDING_CONFIG } from '@/platform/intake/nudgeTypes';
import { Button } from '@/ui/kp';
import { OnboardingBoardEmptyState } from './OnboardingBoardEmptyState';
import { OnboardingBoardRow } from './OnboardingBoardRow';

export interface OnboardingBoardProps {
  now?: Date;
  onNewClient?: () => void;
  onOpenNudge?: (row: OnboardingRow) => void;
  onOpenLinkSignals?: (row: OnboardingRow) => void;
  onReviewItems?: (row: OnboardingRow) => void;
  onCopyLink?: (row: OnboardingRow) => Promise<void> | void;
  renderNudgeSlot?: (row: OnboardingRow) => ReactNode;
  renderLinkSignals?: (row: OnboardingRow) => ReactNode;
}

function defaultNewClient(): void {
  window.dispatchEvent(new CustomEvent(EV_OPEN_MATTER_MANAGER));
}

export function OnboardingBoard({
  now,
  onNewClient,
  onOpenNudge,
  onOpenLinkSignals,
  onReviewItems,
  onCopyLink,
  renderNudgeSlot,
  renderLinkSignals,
}: OnboardingBoardProps) {
  // LANE1-ONBOARDING-BOARD
  const { t } = useTranslation();
  const intakesById = useIntakeStore((state) => state.intakesById);
  const setClientMapHubTab = useMatterStore(
    (state) => state.setClientMapHubTab,
  );
  const handleNewClient = onNewClient ?? defaultNewClient;

  const activeIntakes = useMemo(
    () =>
      Object.values(intakesById).filter(
        (intake) => intake.status === 'active',
      ),
    [intakesById],
  );

  const rows = useMemo(
    () => {
      const effectiveNow = now ?? new Date();
      return sortOnboardingRows(
        activeIntakes.map((intake) =>
          deriveOnboardingRow(
            intake,
            effectiveNow,
            DEFAULT_ONBOARDING_CONFIG,
          ),
        ),
      );
    },
    [activeIntakes, now],
  );

  const openRow = useCallback(
    (row: OnboardingRow) => {
      setClientMapHubTab('onboarding');
      window.dispatchEvent(
        new CustomEvent(EV_MATTER_LAUNCH, {
          detail: { matterId: row.matterId, surface: 'matters' },
        }),
      );
    },
    [setClientMapHubTab],
  );

  const reviewRow = useCallback(
    (row: OnboardingRow) => {
      if (onReviewItems) {
        onReviewItems(row);
        return;
      }
      openRow(row);
    },
    [onReviewItems, openRow],
  );

  const copyLink = useCallback(
    (row: OnboardingRow) => {
      if (onCopyLink) return onCopyLink(row);
      const link = intakesById[row.requestId]?.link;
      if (!link || typeof navigator === 'undefined') return undefined;
      return navigator.clipboard.writeText(link);
    },
    [intakesById, onCopyLink],
  );

  return (
    <div data-testid="onboarding-board">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--kp-space-md)',
          padding: '16px 18px',
          borderBottom: '1px solid var(--kp-divider)',
          background: 'var(--kp-surface-card)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--kp-space-sm)',
            minWidth: 0,
          }}
        >
          <ClipboardList
            aria-hidden="true"
            size={18}
            strokeWidth={1.75}
            style={{ color: 'var(--kp-accent)', flex: 'none' }}
          />
          <h2
            style={{
              margin: 0,
              color: 'var(--kp-navy)',
              fontSize: 'var(--kp-font-lg)',
              fontWeight: 'var(--kp-weight-bold)',
              lineHeight: 'var(--kp-leading-tight)',
            }}
          >
            {t('intake.board.title')}
          </h2>
        </div>
        <Button
          variant="primary"
          size="sm"
          iconLeft={Plus}
          onClick={handleNewClient}
          data-testid="onboarding-board-new-client"
        >
          {t('intake.board.new-client')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <OnboardingBoardEmptyState onNewClient={handleNewClient} />
      ) : (
        <div>
          {rows.map((row) => (
            <OnboardingBoardRow
              key={row.requestId}
              row={row}
              onOpen={openRow}
              onReviewItems={reviewRow}
              onCopyLink={copyLink}
              {...(onOpenNudge ? { onOpenNudge } : {})}
              {...(onOpenLinkSignals ? { onOpenLinkSignals } : {})}
              {...(renderNudgeSlot ? { renderNudgeSlot } : {})}
              {...(renderLinkSignals ? { renderLinkSignals } : {})}
            />
          ))}
        </div>
      )}
    </div>
  );
}
