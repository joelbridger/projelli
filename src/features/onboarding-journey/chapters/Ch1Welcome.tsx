/**
 * Ch1Welcome — "Welcome to Keepance"
 *
 * The opening chapter. Shows a brief description and a single "Start" button.
 * No back navigation (first chapter).
 */

/* eslint-disable keepance-i18n/no-hardcoded-string */

import type { Chapter, ChapterContext } from '../engine/types';
import {
  SceneFrame,
  House,
  Papers,
  Lock,
} from '../scenes';
import { JOURNEY_STRINGS } from '../copy/strings';
import { ChapterLayout } from './ChapterLayout';

const S = JOURNEY_STRINGS.ch1;

// ---------------------------------------------------------------------------
// Chapter export
// ---------------------------------------------------------------------------

export const ch1Welcome: Chapter = {
  id: 'welcome',
  title: 'Welcome',
  render: (ctx) => <Ch1View ctx={ctx} />,
};

// ---------------------------------------------------------------------------
// View component (all hooks live here)
// ---------------------------------------------------------------------------

interface Ch1ViewProps {
  ctx: ChapterContext;
}

function Ch1View({ ctx }: Ch1ViewProps) {
  const scene = (
    <SceneFrame label={S.sceneLabel}>
      <div style={{ position: 'relative', width: 112, height: 112 }}>
        <div style={{ position: 'absolute', bottom: 0, left: 8 }}>
          <House reducedMotion={ctx.reducedMotion} size={80} />
        </div>
        <div style={{ position: 'absolute', top: 8, right: 0 }}>
          <Papers reducedMotion={ctx.reducedMotion} size={36} />
        </div>
        <div style={{ position: 'absolute', bottom: 20, right: 2 }}>
          <Lock reducedMotion={ctx.reducedMotion} size={26} />
        </div>
      </div>
    </SceneFrame>
  );

  return (
    <ChapterLayout
      title={S.title}
      scene={scene}
      onContinue={ctx.advance}
      continueLabel={S.startBtn}
      testId="ch1-root"
    >
      <p
        style={{
          fontSize: 'var(--kp-font-base)',
          color: 'var(--color-foreground)',
          margin: 0,
          lineHeight: 1.6,
        }}
      >
        {S.body}
      </p>
      <p
        style={{
          fontSize: 'var(--kp-font-sm)',
          color: 'var(--color-muted-foreground)',
          margin: 0,
        }}
      >
        {S.tagline}
      </p>
    </ChapterLayout>
  );
}
