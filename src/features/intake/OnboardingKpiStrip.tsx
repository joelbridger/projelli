import { useTranslation } from 'react-i18next';

import type { OnboardingKpis } from '@/platform/intake/onboardingKpis';

export interface OnboardingKpiStripProps {
  kpis: OnboardingKpis;
}

export function OnboardingKpiStrip({ kpis }: OnboardingKpiStripProps) {
  const { t } = useTranslation();
  const completionPercent = Math.round(kpis.completionRate * 100);

  return (
    <section
      aria-label={t('intake.board.kpis.aria')}
      data-testid="onboarding-kpi-strip"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--kp-space-md)',
        padding: 'var(--kp-space-sm) var(--kp-space-lg)',
        borderBottom: '1px solid var(--kp-divider)',
        background: 'var(--kp-bg-soft)',
      }}
    >
      <dl
        style={{
          display: 'flex',
          flex: '1 1 520px',
          flexWrap: 'wrap',
          gap: 'var(--kp-space-lg)',
          margin: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <dt
            style={{
              color: 'var(--kp-text-dim)',
              fontSize: 'var(--kp-font-xs)',
              fontWeight: 'var(--kp-weight-medium)',
            }}
          >
            {t('intake.board.kpis.average-label')}
          </dt>
          <dd
            style={{
              margin: 'var(--kp-space-2xs) 0 0',
              color: 'var(--kp-navy)',
              fontSize: 'var(--kp-font-md)',
              fontWeight: 'var(--kp-weight-semibold)',
            }}
          >
            {kpis.avgDaysToComplete == null
              ? t('intake.board.kpis.no-completed')
              : t('intake.board.kpis.days', { count: kpis.avgDaysToComplete })}
          </dd>
        </div>
        <div style={{ minWidth: 0 }}>
          <dt
            style={{
              color: 'var(--kp-text-dim)',
              fontSize: 'var(--kp-font-xs)',
              fontWeight: 'var(--kp-weight-medium)',
            }}
          >
            {t('intake.board.kpis.stalled-label')}
          </dt>
          <dd
            style={{
              margin: 'var(--kp-space-2xs) 0 0',
              color: 'var(--kp-navy)',
              fontSize: 'var(--kp-font-md)',
              fontWeight: 'var(--kp-weight-semibold)',
            }}
          >
            {kpis.stalledCount}
          </dd>
        </div>
        <div style={{ minWidth: 0 }}>
          <dt
            style={{
              color: 'var(--kp-text-dim)',
              fontSize: 'var(--kp-font-xs)',
              fontWeight: 'var(--kp-weight-medium)',
            }}
          >
            {t('intake.board.kpis.completion-label')}
          </dt>
          <dd
            style={{
              margin: 'var(--kp-space-2xs) 0 0',
              color: 'var(--kp-navy)',
              fontSize: 'var(--kp-font-md)',
              fontWeight: 'var(--kp-weight-semibold)',
            }}
          >
            {t('intake.board.kpis.percent', { count: completionPercent })}
          </dd>
        </div>
      </dl>
    </section>
  );
}
