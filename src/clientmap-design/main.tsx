// src/clientmap-design/main.tsx
//
// DESIGN HARNESS (dev only) — mounts the REAL Client Map UI against a rich,
// fully-filled fixture so the design can be iterated fast with hot-reload.
// Served via clientmap-design.html. Not part of the shipped app bundle.
//
// Toggle the two layouts with ?view=flat (the card-stack ClientMapView) vs the
// default tabbed ClientMapPanel, so both can be compared during iteration.
/* eslint-disable keepance-i18n/no-hardcoded-string */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { CSSProperties } from 'react';
import '../styles/globals.css';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { ClientMapView } from '@/features/matters/ClientMapView';
import { Card, Eyebrow } from '@/ui/kp';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { answerQuestion, flagForClient } from '@/platform/clientMap/guidedInterview';
import type { SourceRef } from '@/platform/clientMap/types';
import { buildDesignClientMap, DESIGN_MATTER_ID, DESIGN_CLIENT_NAME } from './richFixture';

// Always re-seed on load so edits to the fixture win over any persisted copy.
useClientMapStore.getState().setMap(DESIGN_MATTER_ID, buildDesignClientMap());

const params = new URLSearchParams(window.location.search);
const useFlat = params.get('view') === 'flat';

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: '#f5f7fa',
  fontFamily: 'var(--font-sans)',
  color: 'var(--kp-navy)',
  padding: '28px 24px 64px',
};

const containerStyle: CSSProperties = {
  maxWidth: 1140,
  margin: '0 auto',
};

const ribbonStyle: CSSProperties = {
  maxWidth: 1140,
  margin: '0 auto 18px',
  display: 'flex',
  alignItems: 'baseline',
  gap: 12,
  flexWrap: 'wrap',
};

function Handlers() {
  const map = useClientMapStore((s) => s.maps[DESIGN_MATTER_ID]);
  if (map === undefined) return null;

  const onOpenSource = (r: SourceRef): void => {
    // Design harness: real app opens the cited document/email. Here we just log.
    // eslint-disable-next-line no-console
    console.log('[design] open source', r);
  };
  const onEditItem = (sectionKey: string, itemId: string): void => {
    // eslint-disable-next-line no-console
    console.log('[design] edit item', sectionKey, itemId);
  };
  const onAnswerQuestion = (gap: { text: string; sectionKey: string }): void => {
    const a = window.prompt(`Your answer for: ${gap.text}`);
    if (a != null && a.trim() !== '') {
      answerQuestion(DESIGN_MATTER_ID, gap.sectionKey, a.trim(), gap.text);
    }
  };
  const onFlagForClient = (gap: { text: string }): void => {
    flagForClient(DESIGN_MATTER_ID, gap.text);
  };

  return useFlat ? (
    <ClientMapView
      map={map}
      onOpenSource={onOpenSource}
      onEditItem={onEditItem}
      onAnswerQuestion={onAnswerQuestion}
      onFlagForClient={onFlagForClient}
    />
  ) : (
    <ClientMapPanel
      map={map}
      onOpenSource={onOpenSource}
      onEditItem={onEditItem}
      onAnswerQuestion={onAnswerQuestion}
      onFlagForClient={onFlagForClient}
    />
  );
}

function DesignHarness() {
  return (
    <div style={pageStyle}>
      <div style={ribbonStyle}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>
          Client Map · design preview
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-muted-foreground)' }}>
          {useFlat ? 'flat view (?view=flat)' : 'tabbed panel — add ?view=flat to compare the flat layout'}
        </span>
      </div>
      <div style={containerStyle}>
        <Card variant="raised" style={{ padding: 20 }}>
          <Eyebrow>Client Map</Eyebrow>
          <h2 style={{ margin: '2px 0 16px', fontSize: 22, fontWeight: 700, color: 'var(--kp-navy)' }}>
            {DESIGN_CLIENT_NAME}
          </h2>
          <Handlers />
        </Card>
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element');
}
createRoot(rootElement).render(
  <StrictMode>
    <DesignHarness />
  </StrictMode>,
);
