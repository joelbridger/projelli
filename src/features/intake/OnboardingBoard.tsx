import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Plus } from 'lucide-react';

import { EV_MATTER_LAUNCH, EV_OPEN_MATTER_MANAGER } from '@/config/identity';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useIntakeStore } from '@/platform/intake/intakeStore';
import { reconstructAdvisorIntakeLink } from '@/platform/intake/advisorIntakeLink';
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
  renderEmailReplySignals?: (row: OnboardingRow) => ReactNode;
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
  renderEmailReplySignals,
}: OnboardingBoardProps) {
  // LANE1-ONBOARDING-BOARD
  const { t } = useTranslation();
  const intakesById = useIntakeStore((state) => state.intakesById);
  const setClientMapHubTab = useMatterStore(
    (state) => state.setClientMapHubTab
  );
  const handleNewClient = onNewClient ?? defaultNewClient;

  const activeIntakes = useMemo(
    () =>
      Object.values(intakesById).filter((intake) => intake.status === 'active'),
    [intakesById]
  );

  const rows = useMemo(() => {
    const effectiveNow = now ?? new Date();
    return sortOnboardingRows(
      activeIntakes.map((intake) =>
        deriveOnboardingRow(intake, effectiveNow, DEFAULT_ONBOARDING_CONFIG)
      )
    );
  }, [activeIntakes, now]);

  const openRow = useCallback(
    (row: OnboardingRow) => {
      window.dispatchEvent(
        new CustomEvent(EV_MATTER_LAUNCH, {
          detail: { matterId: row.matterId, surface: 'matters' },
        })
      );
      // LANE1-FIX-ROW-LAUNCH: the app listener picks the client during dispatch and defaults the hub to Overview, so the board selects Onboarding after that listener returns.
      setClientMapHubTab('onboarding');
    },
    [setClientMapHubTab]
  );

  const reviewRow = useCallback(
    (row: OnboardingRow) => {
      if (onReviewItems) {
        onReviewItems(row);
        return;
      }
      openRow(row);
    },
    [onReviewItems, openRow]
  );

  const copyLink = useCallback(
    async (row: OnboardingRow) => {
      if (onCopyLink) {
        await onCopyLink(row);
        return;
      }
      const intake = intakesById[row.requestId];
      if (!intake) throw new Error('No intake link is available.');
      const clipboard = (
        navigator as unknown as {
          clipboard?: { writeText?: (text: string) => Promise<void> };
        }
      ).clipboard;
      if (!clipboard?.writeText) {
        throw new Error('Clipboard is not available.');
      }
      const link =
        intake.link ??
        (intake.publicKeyRawB64
          ? await reconstructAdvisorIntakeLink({
              intakeId: intake.intakeId,
              publicKeyRawB64: intake.publicKeyRawB64,
            })
          : null);
      if (!link) throw new Error('No intake link is available.');
      await clipboard.writeText(link);
    },
    [intakesById, onCopyLink]
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
              canCopyLink={Boolean(
                onCopyLink ||
                intakesById[row.requestId]?.link ||
                intakesById[row.requestId]?.publicKeyRawB64
              )}
              {...(onOpenNudge ? { onOpenNudge } : {})}
              {...(onOpenLinkSignals ? { onOpenLinkSignals } : {})}
              {...(renderNudgeSlot ? { renderNudgeSlot } : {})}
              {...(renderLinkSignals ? { renderLinkSignals } : {})}
              {...(renderEmailReplySignals ? { renderEmailReplySignals } : {})}
            />
          ))}
        </div>
      )}
    </div>
  );
}
