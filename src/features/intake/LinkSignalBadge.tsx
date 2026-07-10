import { AlertTriangle, CheckCircle2, RefreshCcw, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { LinkSignal } from '@/platform/intake/onboardingModel';
import { Badge, type BadgeProps, type IconType } from '@/ui/kp';
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

export function LinkSignalBadges({
  signals,
}: {
  signals: LinkSignal[];
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
        <LinkSignalBadge
          key={`${signal.kind}:${signal.at ?? 'none'}`}
          signal={signal}
        />
      ))}
    </div>
  );
}
