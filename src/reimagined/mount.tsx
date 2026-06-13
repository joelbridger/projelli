/**
 * Reimagined UI prototype — isolated mount.
 *
 * Rendered only when the page is loaded with `?reimagined` (see src/main.tsx).
 * This is the Phase 2 design prototype for the matter-centric reimagining:
 * a navigable, beautiful shell over mock data on the real stack, so the
 * direction can be validated before any production wiring. The production
 * app is never touched by this code path.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import '../styles/globals.css';
import './styles.css';
import { ReimaginedApp } from './ReimaginedApp';

function ensureFonts() {
  if (document.getElementById('kp-fonts')) return;
  const pre1 = document.createElement('link');
  pre1.rel = 'preconnect';
  pre1.href = 'https://fonts.googleapis.com';
  const pre2 = document.createElement('link');
  pre2.rel = 'preconnect';
  pre2.href = 'https://fonts.gstatic.com';
  pre2.crossOrigin = 'anonymous';
  const link = document.createElement('link');
  link.id = 'kp-fonts';
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?' +
    'family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&' +
    'family=IBM+Plex+Sans:wght@400;500;600;700&' +
    'family=IBM+Plex+Mono:wght@400;500;600&display=swap';
  document.head.append(pre1, pre2, link);
}

export function mountReimagined(rootElement: HTMLElement): void {
  ensureFonts();
  document.title = 'Keepance — reimagined';
  createRoot(rootElement).render(
    <StrictMode>
      <TooltipProvider delayDuration={250} skipDelayDuration={100}>
        <div className="kp-app">
          <ReimaginedApp />
        </div>
      </TooltipProvider>
    </StrictMode>,
  );
}
