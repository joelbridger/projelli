import { AlertTriangle, CheckCircle2, RefreshCcw, ShieldAlert } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { LinkSignal } from '@/platform/intake/onboardingModel';
import { Callout, type CalloutProps, type IconType } from '@/ui/kp';
import {
  linkSignalAction,
  linkSignalBody,
  linkSignalTitle,
} from './linkSignalCopy';

export interface LinkSignalDetailsProps {
  signal: LinkSignal;
  onDismiss?: (signal: LinkSignal) => void;
}

function calloutVariant(
  signal: LinkSignal
): NonNullable<CalloutProps['variant']> {
  if (signal.severity === 'integrity') return 'error';
  if (signal.severity === 'attention') return 'warning';
  return 'info';
}

function calloutIcon(signal: LinkSignal): IconType {
  if (signal.severity === 'integrity') return ShieldAlert;
  if (signal.kind === 'regenerate_available') return RefreshCcw;
  if (signal.severity === 'attention') return AlertTriangle;
  return CheckCircle2;
}

function formatSignalDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function LinkSignalDetails({
  signal,
  onDismiss,
}: LinkSignalDetailsProps) {
  const { t } = useTranslation();
  const formattedDate = useMemo(() => formatSignalDate(signal.at), [signal.at]);
  const title = linkSignalTitle(signal.kind, t);

  return (
    <div data-testid={`link-signal-detail-${signal.kind}`}>
      <Callout
        variant={calloutVariant(signal)}
        icon={calloutIcon(signal)}
        {...(signal.dismissible && onDismiss
          ? {
              onDismiss: () => {
                onDismiss(signal);
              },
            }
          : {})}
      >
        <details open={signal.severity !== 'info'}>
          <summary
            style={{
              cursor: 'pointer',
              color: 'var(--kp-navy)',
              fontSize: 'var(--kp-font-sm)',
              fontWeight: 'var(--kp-weight-bold)',
              lineHeight: 'var(--kp-leading-snug)',
            }}
          >
            {title}
            <span
              style={{
                marginLeft: 8,
                color: 'var(--color-muted-foreground)',
                fontSize: 'var(--kp-font-xs)',
                fontWeight: 'var(--kp-weight-medium)',
              }}
            >
              {t('intake.link.details-label')}
            </span>
          </summary>
          <div
            style={{
              display: 'grid',
              gap: 'var(--kp-space-xs)',
              marginTop: 'var(--kp-space-xs)',
              color: 'var(--color-muted-foreground)',
              fontSize: 'var(--kp-font-sm)',
              lineHeight: 'var(--kp-leading-relaxed)',
            }}
          >
            <p style={{ margin: 0 }}>{linkSignalBody(signal.kind, t)}</p>
            <p style={{ margin: 0, color: 'var(--kp-navy)' }}>
              <strong>{t('intake.link.next-label')}</strong>{' '}
              {linkSignalAction(signal.kind, t)}
            </p>
            {formattedDate ? (
              <p style={{ margin: 0, fontSize: 'var(--kp-font-xs)' }}>
                {t('intake.link.updated', { date: formattedDate })}
              </p>
            ) : null}
          </div>
        </details>
      </Callout>
    </div>
  );
}
