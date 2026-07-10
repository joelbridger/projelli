import { useEffect, useMemo, useState } from 'react';
import { Copy, RefreshCcw, RotateCw, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { IntakeRecord } from '@/platform/intake/intakeStore';
import {
  deriveLinkSignals,
  type LinkSignal,
} from '@/platform/intake/onboardingModel';
import { DEFAULT_ONBOARDING_CONFIG } from '@/platform/intake/nudgeTypes';
import { Badge, Button } from '@/ui/kp';
import { LinkSignalBadge } from './LinkSignalBadge';
import { LinkSignalDetails } from './LinkSignalDetails';
import { isPrimaryLinkSignal, linkSignalKey } from './linkSignalCopy';

type LinkAction = 'extend' | 'revoke' | 'regenerate';

export interface LinkLifecyclePanelProps {
  intake: IntakeRecord;
  now?: Date;
  onCopyLink: () => Promise<void> | void;
  onExtend?: (intakeId: string) => Promise<void> | void;
  onRevoke?: (intakeId: string) => Promise<void> | void;
  onRegenerate?: (intakeId: string) => Promise<void> | void;
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function LinkLifecyclePanel({
  intake,
  now,
  onCopyLink,
  onExtend,
  onRevoke,
  onRegenerate,
}: LinkLifecyclePanelProps) {
  // LANE2-LINK-SIGNALS: all link notes come from local intake state only.
  const { t } = useTranslation();
  const [dismissedSignalKeys, setDismissedSignalKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [copied, setCopied] = useState(false);
  const [pendingAction, setPendingAction] = useState<LinkAction | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    setDismissedSignalKeys(new Set());
    setCopied(false);
    setActionError('');
    setPendingAction(null);
  }, [intake.intakeId]);

  const signals = useMemo(() => {
    return deriveLinkSignals(
      intake,
      now ?? new Date(),
      DEFAULT_ONBOARDING_CONFIG
    );
  }, [intake, now]);

  const primarySignal =
    signals.find((signal) => isPrimaryLinkSignal(signal.kind)) ?? signals[0];
  const visibleSignals = signals.filter(
    (signal) => !dismissedSignalKeys.has(linkSignalKey(signal))
  );

  const dismissSignal = (signal: LinkSignal) => {
    if (!signal.dismissible) return;
    setDismissedSignalKeys((current) => {
      const next = new Set(current);
      next.add(linkSignalKey(signal));
      return next;
    });
  };

  const copyLink = async () => {
    setActionError('');
    try {
      await onCopyLink();
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1600);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t('intake.link.error-copy')
      );
    }
  };

  const runLinkAction = async (
    action: LinkAction,
    handler: ((intakeId: string) => Promise<void> | void) | undefined
  ) => {
    if (!handler) return;
    setActionError('');
    setPendingAction(action);
    try {
      await handler(intake.intakeId);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t('intake.link.error-update')
      );
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section
      data-testid="link-lifecycle-panel"
      style={{
        border: '1px solid var(--kp-divider)',
        borderRadius: 8,
        background: 'var(--kp-surface-card)',
        padding: 14,
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: 'var(--kp-space-sm)',
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 800,
              color: 'var(--kp-navy)',
            }}
          >
            {t('intake.link.title')}
          </h3>
          <p
            style={{
              margin: '5px 0 0',
              color: 'var(--color-muted-foreground)',
              fontSize: 12,
              lineHeight: 'var(--kp-leading-relaxed)',
            }}
          >
            {t('intake.link.local-note')}
          </p>
        </div>

        <div
          style={{
            border: '1px solid var(--kp-divider)',
            borderRadius: 8,
            background: 'var(--kp-bg-soft)',
            padding: 10,
            display: 'grid',
            gap: 'var(--kp-space-xs)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--kp-space-sm)',
            }}
          >
            <span
              style={{
                color: 'var(--kp-navy)',
                fontSize: 'var(--kp-font-sm)',
                fontWeight: 'var(--kp-weight-bold)',
              }}
            >
              {t('intake.link.status-heading')}
            </span>
            {primarySignal ? <LinkSignalBadge signal={primarySignal} /> : null}
          </div>
          <Badge variant="neutral" size="sm">
            {t('intake.link.expiry', { date: formatExpiry(intake.expiresAt) })}
          </Badge>
        </div>

        <div>
          <div
            className="kp-eyebrow"
            style={{
              marginBottom: 8,
              color: 'var(--color-muted-foreground)',
            }}
          >
            {t('intake.link.controls-heading')}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
            }}
          >
            <Button
              variant="secondary"
              size="sm"
              iconLeft={Copy}
              onClick={() => {
                void copyLink().catch((error: unknown) => {
                  setActionError(
                    error instanceof Error
                      ? error.message
                      : t('intake.link.error-copy')
                  );
                });
              }}
              data-testid="link-action-copy"
            >
              {copied ? t('intake.link.copied') : t('intake.link.copy-again')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={RotateCw}
              disabled={!onExtend || pendingAction != null}
              onClick={() => {
                void runLinkAction('extend', onExtend).catch(
                  (error: unknown) => {
                    setActionError(
                      error instanceof Error
                        ? error.message
                        : t('intake.link.error-update')
                    );
                  }
                );
              }}
              data-testid="link-action-extend"
            >
              {pendingAction === 'extend'
                ? t('intake.link.extending')
                : t('intake.link.extend')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={RefreshCcw}
              disabled={!onRegenerate || pendingAction != null}
              onClick={() => {
                void runLinkAction('regenerate', onRegenerate).catch(
                  (error: unknown) => {
                    setActionError(
                      error instanceof Error
                        ? error.message
                        : t('intake.link.error-update')
                    );
                  }
                );
              }}
              data-testid="link-action-regenerate"
            >
              {pendingAction === 'regenerate'
                ? t('intake.link.regenerating')
                : t('intake.link.regenerate')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={XCircle}
              disabled={!onRevoke || pendingAction != null}
              onClick={() => {
                void runLinkAction('revoke', onRevoke).catch(
                  (error: unknown) => {
                    setActionError(
                      error instanceof Error
                        ? error.message
                        : t('intake.link.error-update')
                    );
                  }
                );
              }}
              data-testid="link-action-revoke"
            >
              {pendingAction === 'revoke'
                ? t('intake.link.turning-off')
                : t('intake.link.turn-off')}
            </Button>
          </div>
          {actionError ? (
            <p
              style={{
                margin: '10px 0 0',
                color: 'var(--kp-danger)',
                fontSize: 12,
              }}
            >
              {actionError}
            </p>
          ) : null}
        </div>

        <div>
          <div
            className="kp-eyebrow"
            style={{
              marginBottom: 8,
              color: 'var(--color-muted-foreground)',
            }}
          >
            {t('intake.link.signals-heading')}
          </div>
          {visibleSignals.length > 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {visibleSignals.map((signal) => (
                <LinkSignalDetails
                  key={linkSignalKey(signal)}
                  signal={signal}
                  onDismiss={dismissSignal}
                />
              ))}
            </div>
          ) : (
            <p
              style={{
                margin: 0,
                color: 'var(--color-muted-foreground)',
                fontSize: 'var(--kp-font-sm)',
              }}
            >
              {t('intake.link.no-signals')}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
