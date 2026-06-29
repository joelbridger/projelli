/**
 * Ch4MeetTheAI — "Meet the AI"
 *
 * Explains the AI plug-in metaphor and citation / receipt behavior before the
 * user picks their AI in Ch5. No gate — any user can proceed.
 */

/* eslint-disable keepance-i18n/no-hardcoded-string */

import type { Chapter, ChapterContext } from '../engine/types';
import {
  SceneFrame,
  Brain,
  House,
  PaperPlane,
  ReceiptTag,
} from '../scenes';
import { JOURNEY_STRINGS } from '../copy/strings';
import { ChapterLayout } from './ChapterLayout';

const S = JOURNEY_STRINGS.ch4;

// ---------------------------------------------------------------------------
// Chapter export
// ---------------------------------------------------------------------------

export const ch4MeetTheAI: Chapter = {
  id: 'meet-ai',
  title: 'Meet the AI',
  render: (ctx) => <Ch4View ctx={ctx} />,
};

// ---------------------------------------------------------------------------
// View component
// ---------------------------------------------------------------------------

interface Ch4ViewProps {
  ctx: ChapterContext;
}

function Ch4View({ ctx }: Ch4ViewProps) {
  const scene = (
    <SceneFrame label={S.sceneLabel}>
      <div style={{ position: 'relative', width: 160, height: 110 }}>
        {/* House on the left */}
        <div style={{ position: 'absolute', bottom: 0, left: 0 }}>
          <House reducedMotion={ctx.reducedMotion} size={72} />
        </div>
        {/* Brain on the right, representing the AI */}
        <div style={{ position: 'absolute', top: 0, right: 0 }}>
          <Brain reducedMotion={ctx.reducedMotion} size={52} />
        </div>
        {/* PaperPlane going from house to brain */}
        <div style={{ position: 'absolute', top: 24, left: 56 }}>
          <PaperPlane reducedMotion={ctx.reducedMotion} size={28} />
        </div>
        {/* ReceiptTag coming back from brain — the cited answer */}
        <div style={{ position: 'absolute', bottom: 20, right: 48 }}>
          <ReceiptTag reducedMotion={ctx.reducedMotion} size={26} />
        </div>
      </div>
    </SceneFrame>
  );

  return (
    <ChapterLayout
      title={S.title}
      scene={scene}
      onBack={ctx.goBack}
      onContinue={ctx.advance}
      continueLabel={S.continueBtn}
      testId="ch4-root"
    >
      <p
        style={{
          fontSize: 'var(--kp-font-base)',
          color: 'var(--color-foreground)',
          margin: 0,
          lineHeight: 1.6,
        }}
      >
        {S.body1}
      </p>
      <p
        style={{
          fontSize: 'var(--kp-font-base)',
          color: 'var(--color-foreground)',
          margin: 0,
          lineHeight: 1.6,
        }}
      >
        {S.body2}
      </p>
    </ChapterLayout>
  );
}
