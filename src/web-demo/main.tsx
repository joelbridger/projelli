/**
 * Stream D-web Group II · Task 2.3
 *
 * Demo entry point. Mounted by `index.demo.html`; built by
 * `vite.config.web-demo.ts` with `__PROJELLI_DEMO__ = true`.
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
import { TooltipProvider } from '@/components/ui/tooltip';
import '../styles/globals.css';
import i18n from '../i18n';
import { detectLocale } from '../lib/locale-detect';
import { useSettingsStore } from '../stores/settingsStore';
import { seedWebDemoWorkspace } from './WebDemoSeeder';
import { DemoModeBanner } from './DemoModeBanner';
import { DemoLimitGate } from './DemoLimitGate';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Failed to find root element');
}

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
    await seedWebDemoWorkspace();
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
}

void bootstrap();
