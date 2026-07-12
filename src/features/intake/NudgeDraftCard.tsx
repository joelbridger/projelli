import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Bell, Phone } from 'lucide-react';

import type { OnboardingRow, NudgeEligibility } from '@/platform/intake/onboardingModel';
import type { IntakeRecord } from '@/platform/intake/intakeStore';
import {
  buildNudgeDraftForIntake,
  type BuiltNudgeDraft,
} from '@/platform/intake/nudgeDraft';
import { DEFAULT_ONBOARDING_CONFIG } from '@/platform/intake/nudgeTypes';
import { Badge, Button } from '@/ui/kp';

export interface NudgeDraftCardProps {
  row: OnboardingRow;
  intake: IntakeRecord;
  now?: Date;
  onOpenReview: () => void;
}

function blockedMessage(
  t: TFunction,
  eligibility: NudgeEligibility,
): string {
  switch (eligibility.reason) {
    case 'cadence_wait':
      return t('intake.nudge.blocked.cadence-wait', {
        count: eligibility.daysUntilEligible ?? 1,
      });
    case 'max_unanswered_suggest_call':
      return t('intake.nudge.blocked.call');
    case 'nothing_missing':
      return t('intake.nudge.blocked.nothing-missing');
    case 'link_inactive':
      return t('intake.nudge.blocked.link-inactive');
    case 'ok':
    default:
      return t('intake.nudge.blocked.default');
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function NudgeDraftCard({
  row,
  intake,
  now,
  onOpenReview,
}: NudgeDraftCardProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<BuiltNudgeDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    void Promise.resolve()
      .then(async () => {
        if (!row.nudgeEligibility.eligible || row.nudgeEligibility.suggestCall) {
          if (!isCancelled()) {
            setDraft(null);
            setDraftError(null);
          }
          return;
        }
        if (isCancelled()) return;
        setDraft(null);
        setDraftError(null);
        const nextDraft = await buildNudgeDraftForIntake(row, intake, {
          ...DEFAULT_ONBOARDING_CONFIG,
          ...(now ? { now } : {}),
        });
        if (isCancelled()) return;
        setDraft(nextDraft);
      })
      .catch((caught: unknown) => {
        if (isCancelled()) return;
        setDraftError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [row, intake, now]);

  if (row.nudgeEligibility.suggestCall) {
    return (
      <div
        data-testid={`nudge-draft-card-${row.requestId}`}
        style={{
          border: '1px solid var(--kp-warning-line)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--kp-warning-bg)',
          padding: 'var(--kp-space-xs)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--kp-space-xs)',
        }}
      >
        <Phone
          aria-hidden="true"
          size={14}
          strokeWidth={1.75}
          style={{ color: 'var(--kp-warning)', flex: 'none' }}
        />
        <span
          style={{
            color: 'var(--kp-navy)',
            fontSize: 'var(--kp-font-xs)',
            lineHeight: 'var(--kp-leading-snug)',
          }}
        >
          {t('intake.nudge.card.call-suggestion')}
        </span>
      </div>
    );
  }

  if (!row.nudgeEligibility.eligible) {
    return (
      <div
        data-testid={`nudge-draft-card-${row.requestId}`}
        style={{
          border: '1px solid var(--kp-divider)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--kp-bg-soft)',
          padding: 'var(--kp-space-xs)',
          color: 'var(--color-muted-foreground)',
          fontSize: 'var(--kp-font-xs)',
          lineHeight: 'var(--kp-leading-snug)',
        }}
      >
        {blockedMessage(t, row.nudgeEligibility)}
      </div>
    );
  }

  if (draftError || !draft) {
    return (
      <div
        data-testid={`nudge-draft-card-${row.requestId}`}
        style={{
          border: '1px solid var(--kp-divider)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--kp-bg-soft)',
          padding: 'var(--kp-space-xs)',
          color: draftError ? 'var(--kp-danger)' : 'var(--color-muted-foreground)',
          fontSize: 'var(--kp-font-xs)',
          lineHeight: 'var(--kp-leading-snug)',
        }}
      >
        {draftError ?? t('intake.nudge.modal.drafting')}
      </div>
    );
  }

  return (
    <div
      data-testid={`nudge-draft-card-${row.requestId}`}
      style={{
        border: '1px solid var(--kp-action-border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--kp-surface-card)',
        padding: 'var(--kp-space-xs)',
        display: 'grid',
        gap: 'var(--kp-space-xs)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--kp-space-xs)',
        }}
      >
        <Badge variant="featured" size="sm">
          {t('intake.nudge.card.badge')}
        </Badge>
        <span
          style={{
            color: 'var(--color-muted-foreground)',
            fontSize: 'var(--kp-font-2xs)',
          }}
        >
          {t('intake.nudge.based-on', { date: formatDate(draft.basedOnAt) })}
        </span>
      </div>
      <p
        style={{
          margin: 0,
          color: 'var(--kp-navy)',
          fontSize: 'var(--kp-font-xs)',
          lineHeight: 'var(--kp-leading-snug)',
        }}
      >
        {draft.bodyText.split('\n').find((line) => line.trim().length > 0 && !line.startsWith('Hi ')) ??
          draft.subject}
      </p>
      <Button
        type="button"
        size="sm"
        variant="primary"
        iconLeft={Bell}
        onClick={(event) => {
          event.stopPropagation();
          onOpenReview();
        }}
        data-testid={`nudge-draft-card-open-${row.requestId}`}
      >
        {t('intake.nudge.card.review-action')}
      </Button>
    </div>
  );
}
