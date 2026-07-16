import {
  CalendarDays,
  FolderOpen,
  MessageCircleQuestion,
  UsersRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@/ui/kp';
import type { HomeSurfaceRuntime } from './types';

export interface HomeOrientationSurfaceProps {
  runtime: HomeSurfaceRuntime;
}

const panelStyle = {
  padding: 'var(--kp-space-lg)',
};

/**
 * A read-only starting point for the day. It intentionally uses only shell
 * capabilities: later personalization owns widgets and any home data source.
 */
export function HomeOrientationSurface({
  runtime,
}: HomeOrientationSurfaceProps) {
  const { t } = useTranslation();
  const { rootPath, activeMatter } = runtime.workspace;

  if (rootPath === undefined) {
    return (
      <main
        aria-busy="true"
        data-testid="home-v1-loading"
        style={{ padding: 'var(--kp-space-xl)' }}
      >
        <Card variant="raised" style={panelStyle}>
          <h1 style={{ margin: 0 }}>{t('home.orientation.loading-title')}</h1>
          <p style={{ color: 'var(--color-muted-foreground)', marginBottom: 0 }}>
            {t('home.orientation.loading-description')}
          </p>
        </Card>
      </main>
    );
  }

  if (rootPath === null) {
    return (
      <main data-testid="home-v1-empty" style={{ padding: 'var(--kp-space-xl)' }}>
        <Card variant="raised" style={panelStyle}>
          <h1 style={{ margin: 0 }}>{t('home.orientation.empty-title')}</h1>
          <p style={{ color: 'var(--color-muted-foreground)' }}>
            {t('home.orientation.empty-description')}
          </p>
          <Button
            data-testid="home-v1-open-workspace-settings"
            iconLeft={FolderOpen}
            onClick={() => {
              runtime.settings.open('workspace');
            }}
          >
            {t('home.orientation.open-workspace-settings')}
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main
      data-testid="home-v1-surface"
      style={{
        background: 'var(--color-secondary)',
        minHeight: '100%',
        overflow: 'auto',
        padding: 'var(--kp-space-xl)',
      }}
    >
      <div style={{ margin: '0 auto', maxWidth: 1120 }}>
        <header style={{ marginBottom: 'var(--kp-space-lg)' }}>
          <p
            style={{
              color: 'var(--kp-assured)',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '.04em',
              margin: '0 0 6px',
              textTransform: 'uppercase',
            }}
          >
            {t('home.orientation.eyebrow')}
          </p>
          <h1 style={{ color: 'var(--kp-navy)', margin: 0 }}>
            {t('home.orientation.title')}
          </h1>
          <p
            style={{
              color: 'var(--color-muted-foreground)',
              fontSize: 16,
              marginBottom: 0,
              maxWidth: 660,
            }}
          >
            {t('home.orientation.description')}
          </p>
        </header>

        <div
          style={{
            display: 'grid',
            gap: 'var(--kp-space-md)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          <Card data-testid="home-v1-current-client" variant="raised" style={panelStyle}>
            <p style={{ color: 'var(--color-muted-foreground)', margin: '0 0 6px' }}>
              {t('home.orientation.current-client-label')}
            </p>
            <strong style={{ color: 'var(--kp-navy)', fontSize: 18 }}>
              {activeMatter?.name ?? t('home.orientation.no-current-client')}
            </strong>
            <p style={{ color: 'var(--color-muted-foreground)', marginBottom: 0 }}>
              {activeMatter
                ? t('home.orientation.current-client-ready')
                : t('home.orientation.current-client-empty')}
            </p>
          </Card>

          <Card variant="raised" style={panelStyle}>
            <p style={{ color: 'var(--color-muted-foreground)', margin: '0 0 6px' }}>
              {t('home.orientation.focus-label')}
            </p>
            <strong style={{ color: 'var(--kp-navy)', fontSize: 18 }}>
              {t('home.orientation.focus-title')}
            </strong>
            <p style={{ color: 'var(--color-muted-foreground)', marginBottom: 0 }}>
              {t('home.orientation.focus-description')}
            </p>
          </Card>

          <Card variant="raised" style={panelStyle}>
            <p style={{ color: 'var(--color-muted-foreground)', margin: '0 0 6px' }}>
              {t('home.orientation.day-label')}
            </p>
            <strong style={{ color: 'var(--kp-navy)', fontSize: 18 }}>
              {t('home.orientation.day-title')}
            </strong>
            <p style={{ color: 'var(--color-muted-foreground)', marginBottom: 0 }}>
              {t('home.orientation.day-description')}
            </p>
          </Card>
        </div>

        <Card
          data-testid="home-v1-starting-points"
          variant="raised"
          style={{ ...panelStyle, marginTop: 'var(--kp-space-md)' }}
        >
          <h2 style={{ color: 'var(--kp-navy)', marginTop: 0 }}>
            {t('home.orientation.starting-points-title')}
          </h2>
          <p style={{ color: 'var(--color-muted-foreground)' }}>
            {t('home.orientation.starting-points-description')}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <Button
              data-testid="home-v1-open-clients"
              iconLeft={UsersRound}
              onClick={() => {
                runtime.navigation.setSurface('matters');
              }}
            >
              {t('home.orientation.open-clients')}
            </Button>
            <Button
              data-testid="home-v1-open-ask"
              iconLeft={MessageCircleQuestion}
              onClick={() => {
                runtime.navigation.setSurface('search');
              }}
              variant="secondary"
            >
              {t('home.orientation.open-ask')}
            </Button>
            <Button
              data-testid="home-v1-open-scheduling"
              iconLeft={CalendarDays}
              onClick={() => {
                runtime.navigation.setSurface('scheduling');
              }}
              variant="secondary"
            >
              {t('home.orientation.open-scheduling')}
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}
