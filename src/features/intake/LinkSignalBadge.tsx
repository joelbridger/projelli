import { Fragment, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCcw, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { LinkSignal } from '@/platform/intake/onboardingModel';
import { Badge, Button, type BadgeProps, type IconType } from '@/ui/kp';
import { linkSignalLabel } from './linkSignalCopy';

export interface LinkSignalBadgeProps {
  signal: LinkSignal;
  size?: BadgeProps['size'];
}

function linkSignalBadgeVariant(
  signal: LinkSignal
): NonNullable<BadgeProps['variant']> {
  if (signal.severity === 'integrity') return 'danger';
  if (signal.severity === 'attention') return 'warning';
  return 'neutral';
}

function linkSignalBadgeIcon(signal: LinkSignal): IconType {
  if (signal.severity === 'integrity') return ShieldAlert;
  if (signal.kind === 'regenerate_available') return RefreshCcw;
  if (signal.severity === 'attention') return AlertTriangle;
  return CheckCircle2;
}

export function LinkSignalBadge({
  signal,
  size = 'sm',
}: LinkSignalBadgeProps) {
  const { t } = useTranslation();
  return (
    <Badge
      variant={linkSignalBadgeVariant(signal)}
      size={size}
      icon={linkSignalBadgeIcon(signal)}
      data-testid={`link-signal-badge-${signal.kind}`}
      title={linkSignalLabel(signal.kind, t)}
    >
      {linkSignalLabel(signal.kind, t)}
    </Badge>
  );
}

function RetryExtractionButton({
  flagId,
  onRetryExtraction,
}: {
  flagId: string;
  onRetryExtraction: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={pending}
      data-testid={`retry-extraction-${flagId}`}
      onClick={(event) => {
        event.stopPropagation();
        if (pending) return;
        setPending(true);
        void Promise.resolve(onRetryExtraction())
          .catch((error: unknown) => {
            console.warn('[LinkSignalBadges] Could not retry document extraction:', error);
          })
          .finally(() => { setPending(false); });
      }}
    >
      {t('intake.link.signal.extraction-failed.retry')}
    </Button>
  );
}

export function LinkSignalBadges({
  signals,
  onRetryExtraction,
}: {
  signals: LinkSignal[];
  onRetryExtraction?: (signal: LinkSignal) => Promise<void> | void;
}) {
  if (signals.length === 0) return null;
  return (
    <div
      data-testid="link-signal-badges"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--kp-space-xs)',
        flexWrap: 'wrap',
        minWidth: 0,
      }}
    >
      {signals.map((signal) => (
        <Fragment key={`${signal.kind}:${signal.at ?? 'none'}`}>
          <LinkSignalBadge signal={signal} />
          {signal.kind === 'extraction_failed' && signal.flagId && onRetryExtraction ? (
            <RetryExtractionButton
              key={`retry:${signal.flagId}`}
              flagId={signal.flagId}
              onRetryExtraction={() => onRetryExtraction(signal)}
            />
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}
