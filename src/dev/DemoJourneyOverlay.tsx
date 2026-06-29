/**
 * DEMO-ONLY (dev render). Mounts the REAL onboarding-journey `JourneyHost` as a
 * full-screen overlay for the Keepance marketing demo video, so the film shows
 * the genuine first-run onboarding instead of a simulated modal.
 *
 * It is mounted only when `import.meta.env.DEV` is true (i.e. the vite dev
 * server the video render drives) and is controlled by the Playwright director
 * (marketing-demo) through `window.__kpJourney.{show,hide}` — no navigation, it
 * mounts on top of the running `/try/` app (JourneyHost is `position: fixed;
 * inset: 0; z-index: 1000`, so it covers the app; the demo cursor/captions sit
 * above it). Stripped from every production build (deployed /try and desktop).
 */

import { useEffect, useState } from 'react';
import { JourneyHost } from '@/features/onboarding-journey/JourneyHost';
import type { Chapter, JourneyActions } from '@/features/onboarding-journey/engine/types';
import { ch1Welcome } from '@/features/onboarding-journey/chapters/Ch1Welcome';
import { ch3FilesStayHome } from '@/features/onboarding-journey/chapters/Ch3FilesStayHome';
import { ch4MeetTheAI } from '@/features/onboarding-journey/chapters/Ch4MeetTheAI';
import { ch5ChooseYourBrain } from '@/features/onboarding-journey/chapters/Ch5ChooseYourBrain';

/**
 * A tight, cinematic cut for the film. The full first-run journey has eight
 * chapters; the video shows the four strongest, in an order whose buttons lead
 * naturally into the next screen:
 *   1. Welcome            — what Keepance is, all on your computer
 *   2. Your files at home — local-first, pick a folder (real interaction)
 *   3. Meet the AI        — it reads your files and shows its receipts
 *      ("Show me my choices") ->
 *   4. Choose your AI     — bring your own account / local / later (BYOK)
 */
const DEMO_CHAPTERS: Chapter[] = [
  ch1Welcome,
  ch3FilesStayHome,
  ch4MeetTheAI,
  ch5ChooseYourBrain,
];

/**
 * Stubbed side-effects. The video never stores a real key or opens a real
 * folder. `chooseWorkspaceFolder` returns a believable advisor path so Ch3's
 * gate satisfies and the chosen path renders on screen.
 */
const DEMO_ACTIONS: JourneyActions = {
  saveApiKey: async () => {
    await new Promise((r) => setTimeout(r, 650));
  },
  setConfidentialityMode: () => {},
  chooseWorkspaceFolder: async () => {
    await new Promise((r) => setTimeout(r, 350));
    return 'C:\\Users\\Advisor\\Keepance\\Clients';
  },
};

declare global {
  interface Window {
    __kpJourney?: { show: () => void; hide: () => void; __ready: boolean };
  }
}

export function DemoJourneyOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    window.__kpJourney = {
      show: () => setVisible(true),
      hide: () => setVisible(false),
      __ready: true,
    };
    // Convenience for manual verification: /try/?journey=1 auto-shows it.
    try {
      if (new URLSearchParams(window.location.search).get('journey') === '1') {
        setVisible(true);
      }
    } catch {
      /* ignore */
    }
    return () => {
      delete window.__kpJourney;
    };
  }, []);

  if (!visible) return null;

  return (
    <JourneyHost
      chapters={DEMO_CHAPTERS}
      actions={DEMO_ACTIONS}
      reducedMotion={false}
      onComplete={() => {}}
      onExit={() => {}}
    />
  );
}
