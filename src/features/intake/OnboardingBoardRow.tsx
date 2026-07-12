import {
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bell,
  ClipboardCheck,
  Copy,
  ExternalLink,
  Info,
  RotateCcw,
} from 'lucide-react';

import type { OnboardingRow } from '@/platform/intake/onboardingModel';
import { Badge, Button } from '@/ui/kp';

const MAX_MISSING_LABELS = 3;

export interface OnboardingBoardRowProps {
  row: OnboardingRow;
  onOpen: (row: OnboardingRow) => void;
  onReviewItems: (row: OnboardingRow) => void;
  onCopyLink: (row: OnboardingRow) => Promise<void> | void;
  canCopyLink?: boolean;
  onOpenNudge?: (row: OnboardingRow) => void;
  hideNudgeAction?: boolean;
  onOpenLinkSignals?: (row: OnboardingRow) => void;
  renderNudgeSlot?: (row: OnboardingRow) => ReactNode;
  renderLinkSignals?: (row: OnboardingRow) => ReactNode;
  renderEmailReplySignals?: (row: OnboardingRow) => ReactNode;
}

function stopAction(event: MouseEvent<HTMLButtonElement>): void {
  event.stopPropagation();
}

function rowShouldHandleKey(event: KeyboardEvent<HTMLDivElement>): boolean {
  return (
    event.target === event.currentTarget &&
    (event.key === 'Enter' || event.key === ' ')
  );
}

function progressPercent(row: OnboardingRow): number {
  if (row.requiredCount <= 0) return 100;
  return Math.max(
    0,
    Math.min(100, Math.round((row.receivedCount / row.requiredCount) * 100))
  );
}

function safeCount(value: number): number {
  return Math.max(0, value);
}

export function OnboardingBoardRow({
  row,
  onOpen,
  onReviewItems,
  onCopyLink,
  canCopyLink = true,
  onOpenNudge,
  hideNudgeAction = false,
  onOpenLinkSignals,
  renderNudgeSlot,
  renderLinkSignals,
  renderEmailReplySignals,
}: OnboardingBoardRowProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const shownMissing = row.missingItemLabels.slice(0, MAX_MISSING_LABELS);
  const hiddenMissingCount = safeCount(
    row.missingItemLabels.length - shownMissing.length
  );
  const pct = progressPercent(row);
  const hasNudgeAction = Boolean(onOpenNudge || renderNudgeSlot);
  const hasLinkSignalsAction = Boolean(onOpenLinkSignals || renderLinkSignals);

  const activityLabel = useMemo(() => {
    if (row.isStalled) {
      return t('intake.board.row.stalled', { count: row.stalledDays });
    }
    if (!row.lastActivityAt) return t('intake.board.row.no-activity');
    if (row.stalledDays <= 0) return t('intake.board.row.last-activity-today');
    return t('intake.board.row.days-ago', { count: row.stalledDays });
  }, [row.isStalled, row.lastActivityAt, row.stalledDays, t]);

  const nextAction = useMemo(() => {
    if (row.pendingReviewCount > 0) {
      return t('intake.board.row.next-review', {
        count: row.pendingReviewCount,
      });
    }
    if (row.isStalled && row.nudgeEligibility.suggestCall) {
      return t('intake.board.row.next-call');
    }
    if (row.isStalled && row.nudgeEligibility.eligible) {
      return t('intake.board.row.next-nudge-ready');
    }
    if (row.isStalled) {
      return t('intake.board.row.next-nudge-awaiting');
    }
    if (row.missingItemIds.length === 0) {
      return t('intake.board.row.next-complete');
    }
    return t('intake.board.row.next-progress', {
      received: row.receivedCount,
      total: row.requiredCount,
    });
  }, [
    row.isStalled,
    row.missingItemIds.length,
    row.nudgeEligibility.eligible,
    row.nudgeEligibility.suggestCall,
    row.pendingReviewCount,
    row.receivedCount,
    row.requiredCount,
    t,
  ]);

  const handleCopy = () => {
    let result: Promise<void> | void;
    try {
      result = onCopyLink(row);
    } catch (error) {
      console.error('Failed to copy onboarding link:', error);
      return;
    }
    void Promise.resolve(result)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => {
          setCopied(false);
        }, 1600);
      })
      .catch((error: unknown) => {
        console.error('Failed to copy onboarding link:', error);
      });
  };

  const rowAccent = row.isStalled
    ? '4px solid var(--kp-warning)'
    : '4px solid transparent';

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`onboarding-board-row-${row.requestId}`}
      data-stalled={row.isStalled ? 'true' : 'false'}
      aria-label={t('intake.board.row.open-aria', {
        client: row.clientFirstName,
      })}
      onClick={() => {
        onOpen(row);
      }}
      onKeyDown={(event) => {
        if (!rowShouldHandleKey(event)) return;
        event.preventDefault();
        onOpen(row);
      }}
      style={{
        display: 'grid',
        gridTemplateColumns:
          'minmax(160px, 0.9fr) minmax(170px, 1.1fr) minmax(120px, 0.7fr) minmax(170px, 0.9fr) auto',
        gap: 'var(--kp-space-md)',
        alignItems: 'center',
        padding: '16px 18px 16px 14px',
        borderLeft: rowAccent,
        borderBottom: '1px solid var(--kp-divider)',
        background: row.isStalled
          ? 'var(--kp-warning-bg)'
          : 'var(--kp-surface-card)',
        cursor: 'pointer',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--kp-space-xs)',
            minWidth: 0,
          }}
        >
          <strong
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--kp-navy)',
              fontSize: 'var(--kp-font-md)',
              lineHeight: 'var(--kp-leading-snug)',
            }}
          >
            {row.clientFirstName}
          </strong>
          {row.isStalled ? (
            <Badge variant="warning" size="sm">
              {t('intake.board.row.stalled-badge')}
            </Badge>
          ) : null}
        </div>
        <div
          role="meter"
          aria-label={t('intake.board.row.progress-aria', {
            client: row.clientFirstName,
          })}
          aria-valuemin={0}
          aria-valuemax={row.requiredCount}
          aria-valuenow={row.receivedCount}
          aria-valuetext={t('intake.board.row.progress-text', {
            received: row.receivedCount,
            total: row.requiredCount,
          })}
          style={{
            marginTop: 9,
            display: 'grid',
            gridTemplateColumns: 'minmax(72px, 1fr) auto',
            alignItems: 'center',
            gap: 'var(--kp-space-sm)',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              height: 8,
              borderRadius: 999,
              background: 'var(--kp-bg-soft)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${String(pct)}%`,
                borderRadius: 999,
                background: row.isStalled
                  ? 'var(--kp-warning)'
                  : 'var(--kp-accent)',
              }}
            />
          </div>
          <span
            style={{
              color: 'var(--color-muted-foreground)',
              fontSize: 'var(--kp-font-xs)',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {row.missingItemIds.length === 0
              ? t('intake.board.row.complete')
              : t('intake.board.row.progress-text', {
                  received: row.receivedCount,
                  total: row.requiredCount,
                })}
          </span>
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          className="kp-eyebrow"
          style={{ marginBottom: 6, color: 'var(--color-muted-foreground)' }}
        >
          {t('intake.board.row.missing-heading')}
        </div>
        {shownMissing.length > 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
              minWidth: 0,
            }}
          >
            {shownMissing.map((label) => (
              <Badge key={label} variant="neutral" size="sm">
                {label}
              </Badge>
            ))}
            {hiddenMissingCount > 0 ? (
              <Badge variant="neutral" size="sm">
                {t('intake.board.row.missing-more', {
                  count: hiddenMissingCount,
                })}
              </Badge>
            ) : null}
          </div>
        ) : (
          <span
            style={{
              color: 'var(--color-muted-foreground)',
              fontSize: 'var(--kp-font-sm)',
            }}
          >
            {t('intake.board.row.missing-none')}
          </span>
        )}
      </div>

      <div
        style={{
          color: row.isStalled
            ? 'var(--kp-warning)'
            : 'var(--color-muted-foreground)',
          fontSize: 'var(--kp-font-sm)',
          fontWeight: row.isStalled
            ? 'var(--kp-weight-bold)'
            : 'var(--kp-weight-medium)',
          whiteSpace: 'nowrap',
        }}
      >
        {activityLabel}
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--kp-space-xs)',
            color: 'var(--kp-navy)',
            fontSize: 'var(--kp-font-sm)',
            fontWeight: 'var(--kp-weight-semibold)',
            minWidth: 0,
          }}
        >
          <RotateCcw
            aria-hidden="true"
            size={14}
            strokeWidth={1.75}
            style={{ flex: 'none', color: 'var(--kp-accent)' }}
          />
          <span
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {nextAction}
          </span>
        </div>
        {renderNudgeSlot ? (
          <div style={{ marginTop: 8 }}>{renderNudgeSlot(row)}</div>
        ) : null}
        {renderLinkSignals ? (
          <div style={{ marginTop: 8 }}>{renderLinkSignals(row)}</div>
        ) : null}
        {renderEmailReplySignals ? (
          <div style={{ marginTop: 8 }}>{renderEmailReplySignals(row)}</div>
        ) : null}
      </div>

      <div
        aria-label={t('intake.board.row.actions-aria', {
          client: row.clientFirstName,
        })}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--kp-space-xs)',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
        }}
      >
        <Button
          variant="secondary"
          size="sm"
          iconLeft={ExternalLink}
          data-testid={`onboarding-row-open-${row.requestId}`}
          onClick={(event) => {
            stopAction(event);
            onOpen(row);
          }}
        >
          {t('intake.board.row.open-action')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={ClipboardCheck}
          disabled={row.pendingReviewCount === 0}
          data-testid={`onboarding-row-review-${row.requestId}`}
          onClick={(event) => {
            stopAction(event);
            onReviewItems(row);
          }}
        >
          {t('intake.board.row.review-action')}
        </Button>
        {!hideNudgeAction ? (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={Bell}
            disabled={!row.isStalled || !hasNudgeAction}
            data-testid={`onboarding-row-nudge-${row.requestId}`}
            onClick={(event) => {
              stopAction(event);
              onOpenNudge?.(row);
            }}
          >
            {t('intake.board.row.nudge-action')}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          iconLeft={Copy}
          disabled={!canCopyLink}
          data-testid={`onboarding-row-copy-link-${row.requestId}`}
          onClick={(event) => {
            stopAction(event);
            handleCopy();
          }}
        >
          {copied
            ? t('intake.board.row.copy-link-copied')
            : t('intake.board.row.copy-link-action')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={Info}
          disabled={!hasLinkSignalsAction}
          data-testid={`onboarding-row-link-signals-${row.requestId}`}
          onClick={(event) => {
            stopAction(event);
            onOpenLinkSignals?.(row);
          }}
        >
          {t('intake.board.row.link-signals-action')}
        </Button>
      </div>
    </div>
  );
}
