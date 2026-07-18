/**
 * Stream D-web Group II · Task 2.3
 *
 * Demo entry point. Mounted by `index.demo.html`; built by
 * `vite.config.web-demo.ts` with `__LANTERN_DEMO__ = true`.
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
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import { CONFIDENTIALITY_CHOICE_MADE_KEY } from '@/platform/privacy/resolvePersonalEgressDefault';
import { seedWebDemoWorkspace, getSampleForProfession, DEMO_WORKSPACE_ROOT } from './WebDemoSeeder';
import { seedWebDemoClientMap } from './seedWebDemoClientMap';
import { installDemoRetrieval } from './demoRetrieval';
import { DemoModeBanner } from './DemoModeBanner';
import { DemoLimitGate } from './DemoLimitGate';
import { trackDemoLoaded } from './demoPlausible';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Failed to find root element');
}

// Demo build: tell App to auto-open the pre-seeded OPFS workspace instead of
// showing the folder picker. App reads this flag on mount.
(window as unknown as { __lanternDemo?: boolean }).__lanternDemo = true;

async function bootstrapLocale(): Promise<void> {
  const userLang = useSettingsStore.getState().language;
  const lang = userLang ?? (await detectLocale());
  await i18n.changeLanguage(lang);
}

bootstrapLocale().catch(() => {
  // Tolerate locale-detect failures; i18n already starts in 'en'.
});

/**
 * The web demo answers AI questions through the shared demo proxy (or a pasted
 * BYOK key) — never an on-device model, because a browser has no local engine.
 * The fail-closed cloud-send guard (`isLocalOnlyModeFailClosed`) treats an UNSET
 * confidentiality mode as Local-only and would BLOCK every cloud send, so the
 * demo must declare its posture explicitly: Direct, choice made. We only set this
 * when the visitor has not chosen a mode themselves, so an explicit Local-only
 * choice in the demo's Privacy Center is still respected (it just can't answer —
 * honestly — without a local model).
 */
function ensureDemoConfidentialityDefault(): void {
  const settings = useSettingsStore.getState();
  // Default the mode to Direct only when the visitor hasn't chosen one, so an
  // explicit Local-only choice in the demo's Privacy Center is respected.
  if (settings.values[CONFIDENTIALITY_MODE_SETTING_KEY] === undefined) {
    settings.setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'direct');
  }
  // Always ensure the choice is marked made: the demo's egress is disclosed by
  // the demo banner, so the personal-install choice gate (which blocks cloud
  // generation in Workflows / AI Chat until a choice is recorded) must not fire.
  // Done independently of the mode check so a stale state with the mode set but
  // the choice flag missing is still unblocked (Codex review).
  if (settings.getSetting(CONFIDENTIALITY_CHOICE_MADE_KEY) !== true) {
    settings.setSetting(CONFIDENTIALITY_CHOICE_MADE_KEY, true);
  }
}

async function bootstrap(): Promise<void> {
  // Declare the demo's AI egress posture before anything can send (see helper).
  ensureDemoConfidentialityDefault();
  // Seed the OPFS workspace before mounting React so the file tree renders
  // populated on first paint. The seeder is idempotent and fast (a handful
  // of small writes).
  try {
    const { profession, ready } = await seedWebDemoWorkspace();
    // Fail closed: only index + seed the cited Client Map when the workspace is
    // FULLY on disk. If a seed write failed (PDF fetch / DOCX gen / OPFS quota) or
    // OPFS is unavailable, `ready` is false and we install NEITHER the retriever
    // NOR the Client Map — otherwise an Ask/Client Map citation could point at a
    // file that was never written and its source chip would fail to open, which
    // is exactly the source-click trust the demo is selling. The demo still loads
    // (degraded: empty workspace), which is honest, rather than confidently wrong.
    if (ready) {
      // Install the browser keyword retriever over the SAME seeded files so Ask
      // can search them (the desktop's native Tauri RAG isn't available here).
      installDemoRetrieval(getSampleForProfession(profession).files, DEMO_WORKSPACE_ROOT);
      // Advisor pack (the default /try): seed the Webb Household client + its
      // fully-filled, cited Client Map and open its hub, so the demo lands on the
      // Client Map — the first thing a visitor sees — instead of the file browser.
      if (profession === 'advisor') {
        await seedWebDemoClientMap();
      }
    } else {
      console.warn(
        '[web-demo] workspace not fully seeded — skipping retrieval + Client Map so nothing cites a file that is not on disk.',
      );
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
