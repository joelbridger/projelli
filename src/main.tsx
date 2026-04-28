import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { TooltipProvider } from '@/components/ui/tooltip';
import './styles/globals.css';
import i18n from './i18n';
import { detectLocale } from './lib/locale-detect';
import { useSettingsStore } from './stores/settingsStore';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Failed to find root element');
}

/**
 * Bootstrap the locale: prefer the user's explicit language override, then
 * fall back to OS detection. Fire-and-forget — the app starts in English
 * (i18n default) and updates to the detected locale once the async detection
 * resolves. Errors are swallowed; the default 'en' remains active.
 */
async function bootstrapLocale(): Promise<void> {
  const userLang = useSettingsStore.getState().language;
  const lang = userLang ?? (await detectLocale());
  await i18n.changeLanguage(lang);
}

bootstrapLocale().catch(() => {
  // fall back to English on any error; i18n already initialized to 'en'
});

async function bootstrap() {
  if (import.meta.env['VITE_MARKETING_CAPTURE'] === '1') {
    const { mountMarketingCaptureBridge } = await import('./dev/marketing-capture-bridge');
    mountMarketingCaptureBridge();
  }

  createRoot(rootElement as HTMLElement).render(
    <StrictMode>
      {/*
        UX-23: single Tooltip Provider at root. delayDuration=300ms means
        tooltips appear after a small pause (avoids noise) and hide instantly
        when the user moves to another tooltipped element (because Radix shares
        the timer across triggers under a single provider).
      */}
      <TooltipProvider delayDuration={300} skipDelayDuration={100}>
        <App />
      </TooltipProvider>
    </StrictMode>
  );
}

bootstrap();
