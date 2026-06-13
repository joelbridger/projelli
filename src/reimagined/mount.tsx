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
  // Satoshi via Fontshare — the keepance.com typeface.
  const pre = document.createElement('link');
  pre.rel = 'preconnect';
  pre.href = 'https://api.fontshare.com';
  pre.crossOrigin = 'anonymous';
  const link = document.createElement('link');
  link.id = 'kp-fonts';
  link.rel = 'stylesheet';
  link.href = 'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,800,900&display=swap';
  document.head.append(pre, link);
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
