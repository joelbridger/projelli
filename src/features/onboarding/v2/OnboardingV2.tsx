/**
 * OnboardingV2 — the prototype-matched first-run onboarding, wired to real
 * functionality. Six scenes:
 *
 *   0  Intro       — the hook + flowchart
 *   1  ChooseStart — workspace-first: sample practice (default) vs own data
 *   2  Compliance  — why this can be used with client data
 *   3  Connect AI  — real key setup / local AI (AiScene)
 *   4  Connect     — real data connectors (ConnectScene)
 *   5  Firm setup  — live setup-progress bars (FirmSetupScene)
 *
 * The ChooseStart step is the workspace-first gate: connectors, email/Wealthbox
 * import and the Client Map all need a workspace, so one is established (and, for
 * the sample, seeded) BEFORE the AI / Connect / Firm-setup steps run. The user
 * cannot advance past ChooseStart until a workspace is ready.
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

import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import './onboardingV2.css';

import type { GuidedOnboardingProps } from '../onboardingTypes';
import { markOnboardingComplete } from '../onboardingState';
import { markAiSetupDeferred } from '../aiSetupState';

import { useOAuthPending } from '@/platform/connectors/oauthPending';

import { OnboardingShell } from './components/OnboardingShell';
import { IntroScene } from './scenes/IntroScene';
import { ChooseStartScene } from './scenes/ChooseStartScene';
import { ComplianceScene } from './scenes/ComplianceScene';
import { AiScene } from './scenes/AiScene';
import { ConnectScene } from './scenes/ConnectScene';
import { FirmSetupScene } from './scenes/FirmSetupScene';
import { getOnboardingV2Copy } from './copy';

/** Scene order. Index 0 is the intro; 1..5 are the action beats. */
const SCENE_COUNT = 6;
const ACTION_SCENES = SCENE_COUNT - 1; // dots only for the action beats
/** Scene index of the workspace-first step; nothing past it may run without a
 *  workspace. */
const CHOOSE_START_SCENE = 1;
/** Scene index of the compliance explanation beat. */
const COMPLIANCE_SCENE = 2;
/** Scene index of the AI step (used for the "AI setup deferred" reminder). */
const AI_SCENE = 3;
/** Scene index of the Connect step (where interactive OAuth sign-ins happen);
 *  nothing past it may run while a sign-in is still pending. */
const CONNECT_SCENE = 4;

export type OnboardingV2Props = GuidedOnboardingProps & {
  /** QA-9 — see OnboardingShell's `topBanner` doc. */
  topBanner?: ReactNode;
};

export function OnboardingV2({ onSaveKey, onComplete, onChooseStart, hasWorkspace, topBanner }: OnboardingV2Props) {
  const { t } = useTranslation();
  const C = getOnboardingV2Copy(t);
  // Loop-proofing: if a workspace ALREADY exists when this component mounts, the
  // user has necessarily passed the intro + ChooseStart steps, so start on the
  // compliance beat instead of the intro. This makes the "sample practice → back to
  // intro forever" loop impossible even if the overlay is remounted after the
  // workspace loads (the branch-stability guard in App.tsx is the primary
  // defence; this is belt-and-suspenders against ANY remount cause). On a true
  // first run there is no workspace yet, so this starts at the intro (0) as
  // before.
  const [scene, setScene] = useState(hasWorkspace ? COMPLIANCE_SCENE : 0);
  // Workspace-first gate: the user may not advance past ChooseStart until a
  // workspace exists (seeded sample or chosen folder). Pre-satisfied when a
  // workspace is already open (e.g. ?forceOnboarding with one loaded).
  const [workspaceReady, setWorkspaceReady] = useState(Boolean(hasWorkspace));
  // Did the user make a real AI choice (cloud key saved or local started)?
  // If they leave the AI screen forward without one, we mark AI setup deferred
  // so the existing in-app "set this up later" reminder still shows.
  const aiResolvedRef = useRef(false);

  // True while an interactive Microsoft/Gmail/OneDrive sign-in is in flight.
  const oauthPending = useOAuthPending();

  const goTo = (next: number) => {
    const target = Math.max(0, Math.min(SCENE_COUNT - 1, next));
    // OAuth-pending forward lock: never let ANY forward move (Continue, arrow,
    // OR a dot jump from an earlier scene) skip PAST the Connect step while a
    // sign-in is still pending — otherwise a user could start a sign-in, go
    // Back, then dot-jump to Firm setup and abandon it mid-flow.
    if (oauthPending && target > CONNECT_SCENE && target > scene) {
      return;
    }
    // Workspace-first: never advance past the ChooseStart step until a
    // workspace is ready (connectors/import/Client Map all depend on it).
    if (target > CHOOSE_START_SCENE && !workspaceReady) {
      setScene(Math.min(target, CHOOSE_START_SCENE));
      return;
    }
    if (scene === AI_SCENE && target > AI_SCENE && !aiResolvedRef.current) {
      markAiSetupDeferred();
    }
    setScene(target);
  };
  const goNext = () => { goTo(scene + 1); };
  const goBack = () => { goTo(scene - 1); };

  const onWorkspaceReady = () => {
    setWorkspaceReady(true);
    // Advance off ChooseStart to the compliance beat now that the gate is
    // satisfied.
    setScene(COMPLIANCE_SCENE);
  };

  const finish = () => {
    // Financial advisor is the V2 persona; persist it so the rest of the app
    // (template packs, copy) lands on the right pack.
    markOnboardingComplete('advisor');
    // The workspace (and, for the sample, its files + Client Map) was already
    // established in the ChooseStart step; imports continue in the background.
    onComplete({ writeSamples: false });
  };

  // Per-scene shell configuration.
  const isIntro = scene === 0;
  const isChooseStart = scene === CHOOSE_START_SCENE;
  const isConnect = scene === CONNECT_SCENE;
  const isLast = scene === SCENE_COUNT - 1;
  const continueLabel = isLast ? C.firm.cta : C.nav.continue;
  // Visually disable Continue on the Connect step while a sign-in is pending.
  // The real forward-navigation lock lives in goTo (covers dots/arrows/Continue
  // from ANY scene), so it can't be bypassed via Back-then-dot-jump; this is the
  // matching button state.
  const continueDisabled = isConnect && oauthPending;

  return (
    <OnboardingShell
      topBanner={topBanner}
      showLogo={!isIntro}
      showBack={!isIntro}
      onBack={goBack}
      // ChooseStart advances via its own cards (which open the workspace), so the
      // global Continue is hidden there — it has nothing to advance until a
      // workspace is chosen.
      showContinue={!isIntro && !isChooseStart}
      continueLabel={continueLabel}
      continueDisabled={continueDisabled}
      onContinue={isLast ? finish : goNext}
      dotCount={isIntro ? 0 : ACTION_SCENES}
      activeDot={isIntro ? -1 : scene - 1}
      // goTo enforces the OAuth-pending forward lock for all of these.
      onDotClick={(i) => { goTo(i + 1); }}
      onArrowNav={(dir) => {
        if (dir === 1 && isLast) finish();
        else goTo(scene + dir);
      }}
    >
      {scene === 0 ? <IntroScene onGo={goNext} /> : null}
      {scene === CHOOSE_START_SCENE ? (
        <ChooseStartScene onChooseStart={onChooseStart} onReady={onWorkspaceReady} />
      ) : null}
      {scene === COMPLIANCE_SCENE ? <ComplianceScene /> : null}
      {scene === AI_SCENE ? (
        <AiScene
          onSaveKey={onSaveKey}
          onAdvance={goNext}
          onAiResolved={() => {
            aiResolvedRef.current = true;
          }}
        />
      ) : null}
      {scene === CONNECT_SCENE ? <ConnectScene /> : null}
      {scene === SCENE_COUNT - 1 ? <FirmSetupScene /> : null}
    </OnboardingShell>
  );
}

export default OnboardingV2;
