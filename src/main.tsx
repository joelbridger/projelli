import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { TooltipProvider } from '@/components/ui/tooltip';
import './styles/globals.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Failed to find root element');
}

createRoot(rootElement).render(
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
