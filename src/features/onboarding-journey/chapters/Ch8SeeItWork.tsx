/**
 * Ch8SeeItWork — "You're set" (final chapter)
 *
 * A static illustration of a cited-answer card (not a real AI call), a
 * sample-case toggle that writes addSamples into JourneyData, and the
 * final Continue button that calls ctx.complete().
 *
 * The App writes keepance_onboarding_complete in its onComplete handler.
 * This chapter does NOT write localStorage.
 */

/* eslint-disable keepance-i18n/no-hardcoded-string */

import { useState } from 'react';
import type { Chapter, ChapterContext } from '../engine/types';
import {
  SceneFrame,
  PaperPlane,
  ReceiptTag,
  House,
} from '../scenes';
import { JOURNEY_STRINGS } from '../copy/strings';
import { ChapterLayout } from './ChapterLayout';

const S = JOURNEY_STRINGS.ch8;

// ---------------------------------------------------------------------------
// Chapter export
// ---------------------------------------------------------------------------

export const ch8SeeItWork: Chapter = {
  id: 'done',
  title: 'Done',
  render: (ctx) => <Ch8View ctx={ctx} />,
};

// ---------------------------------------------------------------------------
// View component (all hooks live here)
// ---------------------------------------------------------------------------

interface Ch8ViewProps {
  ctx: ChapterContext;
}

function Ch8View({ ctx }: Ch8ViewProps) {
  const [addSamples, setAddSamples] = useState(
    ctx.data.addSamples ?? true,
  );

  const scene = (
    <SceneFrame label={S.sceneLabel}>
      <div style={{ position: 'relative', width: 140, height: 110 }}>
        {/* House: represents your workspace */}
        <div style={{ position: 'absolute', bottom: 0, left: 0 }}>
          <House reducedMotion={ctx.reducedMotion} size={64} />
        </div>
        {/* PaperPlane: the question leaving the house */}
        <div style={{ position: 'absolute', top: 0, left: 40 }}>
          <PaperPlane reducedMotion={ctx.reducedMotion} size={34} />
        </div>
        {/* Two ReceiptTags: cited sources in the answer */}
        <div style={{ position: 'absolute', top: 10, right: 22 }}>
          <ReceiptTag reducedMotion={ctx.reducedMotion} size={40} />
        </div>
        <div style={{ position: 'absolute', top: 30, right: 0 }}>
          <ReceiptTag reducedMotion={ctx.reducedMotion} size={34} />
        </div>
      </div>
    </SceneFrame>
  );

  const handleContinue = () => {
    ctx.setData({ addSamples });
    ctx.complete();
  };

  return (
    <ChapterLayout
      title={S.title}
      scene={scene}
      onBack={ctx.goBack}
      onContinue={handleContinue}
      continueLabel={addSamples ? S.continueLabelSamples : S.continueLabelNoSamples}
      testId="ch8-root"
    >
      {/* Sample-case toggle */}
      <label
        data-testid="ch8-samples-label"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          borderRadius: 10,
          border: '1.5px solid hsl(214.3 31.8% 60%)',
          padding: 16,
          cursor: 'pointer',
          background: 'hsl(210 40% 96.1%)',
        }}
      >
        <input
          type="checkbox"
          data-testid="ch8-samples-toggle"
          checked={addSamples}
          onChange={(e) => {
            const next = e.target.checked;
            setAddSamples(next);
            ctx.setData({ addSamples: next });
          }}
          style={{ marginTop: 3, accentColor: 'var(--kp-navy)' }}
        />
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'hsl(222.2 84% 4.9%)',
            lineHeight: 1.5,
          }}
        >
          {S.samplesToggleLabel}
        </span>
      </label>

      {/* Recap line */}
      <p
        style={{
          fontSize: 13,
          color: 'hsl(215.4 16.3% 44%)',
          margin: 0,
          lineHeight: 1.6,
        }}
      >
        {S.recapLine}
      </p>
    </ChapterLayout>
  );
}
