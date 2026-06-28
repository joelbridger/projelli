/**
 * Stream D-web Group II · Task 2.3
 *
 * Demo entry point. Mounted by `index.demo.html`; built by
 * `vite.config.web-demo.ts` with `__KEEPANCE_DEMO__ = true`.
 *
 * Boot sequence:
 *   1. Seed the OPFS workspace from `sample-workspace.json` (idempotent;
 *      `WebDemoSeeder` skips the writes if already done).
 *   2. Render <App /> wrapped in the standard TooltipProvider.
 *   3. Render the DemoModeBanner placeholder (Group IV will swap this for
 *      the real component); kept here so the demo bundle never starts
 *      without a banner element on screen.
 *
 * Locale bootstrap mirrors the desktop entry; the demo respects the user's
 * stored language preference if any, otherwise OS-detected default.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';
import { TooltipProvider } from '@/ui/tooltip';
import '../styles/globals.css';
import i18n from '../i18n';
import { detectLocale } from '../lib/locale-detect';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { seedWebDemoWorkspace } from './WebDemoSeeder';
import { seedWebDemoClientMap } from './seedWebDemoClientMap';
import { DemoModeBanner } from './DemoModeBanner';
import { DemoLimitGate } from './DemoLimitGate';
import { trackDemoLoaded } from './demoPlausible';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Failed to find root element');
}

// Demo build: tell App to auto-open the pre-seeded OPFS workspace instead of
// showing the folder picker. App reads this flag on mount.
(window as unknown as { __keepanceDemo?: boolean }).__keepanceDemo = true;

async function bootstrapLocale(): Promise<void> {
  const userLang = useSettingsStore.getState().language;
  const lang = userLang ?? (await detectLocale());
  await i18n.changeLanguage(lang);
}

bootstrapLocale().catch(() => {
  // Tolerate locale-detect failures; i18n already starts in 'en'.
});

async function bootstrap(): Promise<void> {
  // Seed the OPFS workspace before mounting React so the file tree renders
  // populated on first paint. The seeder is idempotent and fast (a handful
  // of small writes).
  try {
    const { profession } = await seedWebDemoWorkspace();
    // Advisor pack (the default /try): seed the Webb Household client + its
    // fully-filled, cited Client Map and open its hub, so the demo lands on the
    // Client Map — the first thing a visitor sees — instead of the file browser.
    if (profession === 'advisor') {
      seedWebDemoClientMap();
    }
  } catch (err) {
    // Seeder errors are non-fatal: the demo still loads with an empty
    // workspace, which is degraded but functional.
    console.warn('[web-demo] WebDemoSeeder failed; continuing with empty workspace', err);
  }

  createRoot(rootElement as HTMLElement).render(
    <StrictMode>
      <TooltipProvider delayDuration={300} skipDelayDuration={100}>
        <DemoModeBanner />
        <App />
        <DemoLimitGate />
      </TooltipProvider>
    </StrictMode>,
  );

  // Fire `demo_loaded` after React has mounted so Plausible only counts
  // sessions that successfully reached the React shell. Wait one tick so the
  // deferred Plausible script has a chance to attach `window.plausible`.
  setTimeout(() => {
    trackDemoLoaded();
  }, 0);
}

void bootstrap();
