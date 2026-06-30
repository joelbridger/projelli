/**
 * OnboardingV2 — the prototype-matched first-run onboarding, wired to real
 * functionality. Four scenes:
 *
 *   0  Intro      — the hook + flowchart
 *   1  Connect AI — real key setup / local AI (AiScene)
 *   2  Connect    — real data connectors (ConnectScene)
 *   3  Firm setup — live setup-progress bars (FirmSetupScene)
 *
 * Drop-in compatible with GuidedOnboardingProps so FirstRunOverlay's wiring
 * stays unchanged. "Continue to the app" marks onboarding complete and calls
 * onComplete; imports keep running in the background (driven by the real
 * setup-progress backend).
 *
 * This is now the ONLY first-run flow — FirstRunOverlay renders it
 * unconditionally. The old 9-step GuidedOnboarding is archived at
 * `../_archive/GuidedOnboarding.tsx`.
 */

import { useRef, useState } from 'react';
import './onboardingV2.css';

import type { GuidedOnboardingProps } from '../onboardingTypes';
import { markOnboardingComplete } from '../onboardingState';
import { markAiSetupDeferred } from '../aiSetupState';

import { OnboardingShell } from './components/OnboardingShell';
import { IntroScene } from './scenes/IntroScene';
import { AiScene } from './scenes/AiScene';
import { ConnectScene } from './scenes/ConnectScene';
import { FirmSetupScene } from './scenes/FirmSetupScene';
import { ONB_COPY } from './copy';

/** Scene order. Index 0 is the intro; 1..3 are the three numbered steps. */
const SCENE_COUNT = 4;
const ACTION_SCENES = SCENE_COUNT - 1; // dots only for the 3 numbered steps

export type OnboardingV2Props = GuidedOnboardingProps;

export function OnboardingV2({ onSaveKey, onComplete }: OnboardingV2Props) {
  const [scene, setScene] = useState(0);
  // Did the user make a real AI choice (cloud key saved or local started)?
  // If they leave the AI screen forward without one, we mark AI setup deferred
  // so the existing in-app "set this up later" reminder still shows.
  const aiResolvedRef = useRef(false);

  const goTo = (next: number) => {
    const target = Math.max(0, Math.min(SCENE_COUNT - 1, next));
    if (scene === 1 && target > 1 && !aiResolvedRef.current) {
      markAiSetupDeferred();
    }
    setScene(target);
  };
  const goNext = () => { goTo(scene + 1); };
  const goBack = () => { goTo(scene - 1); };

  const finish = () => {
    // Financial advisor is the V2 persona; persist it so the rest of the app
    // (template packs, copy) lands on the right pack.
    markOnboardingComplete('advisor');
    // Imports continue in the background; no sample files (real data loads).
    onComplete({ writeSamples: false });
  };

  // Per-scene shell configuration.
  const isIntro = scene === 0;
  const isLast = scene === SCENE_COUNT - 1;
  const continueLabel = isLast ? ONB_COPY.firm.cta : ONB_COPY.nav.continue;

  return (
    <OnboardingShell
      showLogo={!isIntro}
      showBack={!isIntro}
      onBack={goBack}
      showContinue={!isIntro}
      continueLabel={continueLabel}
      onContinue={isLast ? finish : goNext}
      dotCount={isIntro ? 0 : ACTION_SCENES}
      activeDot={isIntro ? -1 : scene - 1}
      onDotClick={(i) => { goTo(i + 1); }}
      onArrowNav={(dir) => {
        if (dir === 1 && isLast) finish();
        else goTo(scene + dir);
      }}
    >
      {scene === 0 ? <IntroScene onGo={goNext} /> : null}
      {scene === 1 ? (
        <AiScene
          onSaveKey={onSaveKey}
          onAdvance={goNext}
          onAiResolved={() => {
            aiResolvedRef.current = true;
          }}
        />
      ) : null}
      {scene === 2 ? <ConnectScene /> : null}
      {scene === 3 ? <FirmSetupScene /> : null}
    </OnboardingShell>
  );
}

export default OnboardingV2;
