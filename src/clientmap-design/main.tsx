// src/clientmap-design/main.tsx
//
// DESIGN HARNESS (dev only) — renders the per-client hub framing (Ask-style
// surface header + clean horizontal sub-tabs) wrapped around the REAL,
// redesigned ClientMapPanel, so the Client Map can be iterated to match the
// calm, flat, ChatGPT-clean Ask screen. Served via clientmap-design.html.
// Not part of the shipped app bundle.
//
// Toggle: ?view=flat renders the card-stack ClientMapView for comparison.
/* eslint-disable keepance-i18n/no-hardcoded-string */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CSSProperties } from 'react';
import { Briefcase, Map as MapIcon, FileText, Mail, Clock } from 'lucide-react';
import '../styles/globals.css';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { ClientMapView } from '@/features/matters/ClientMapView';
import { Badge } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { answerQuestion, flagForClient } from '@/platform/clientMap/guidedInterview';
import type { SourceRef } from '@/platform/clientMap/types';
import { buildDesignClientMap, DESIGN_MATTER_ID } from './richFixture';

// Always re-seed on load so edits to the fixture win over any persisted copy.
useClientMapStore.getState().setMap(DESIGN_MATTER_ID, buildDesignClientMap());

const params = new URLSearchParams(window.location.search);
const useFlat = params.get('view') === 'flat';

// ── The Ask-style app surface (mirrors the real hub frame) ────────────────────
const surfaceStyle: CSSProperties = {
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-background)',
  fontFamily: 'var(--font-sans)',
  color: 'var(--kp-navy)',
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  padding: 'var(--kp-surface-header-pad)',
  borderBottom: '1px solid var(--color-border)',
  flexShrink: 0,
};

const SUB_TABS = [
  { id: 'overview', label: 'Overview', Icon: MapIcon },
  { id: 'documents', label: 'Documents', Icon: FileText },
  { id: 'email', label: 'Email', Icon: Mail },
  { id: 'activity', label: 'Activity', Icon: Clock },
] as const;

function SubTabBar({ active }: { active: string }) {
  return (
    <div
      role="tablist"
      aria-label="Client sections"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 2,
        padding: '0 var(--kp-gutter)',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-background)',
        flexShrink: 0,
      }}
    >
      {SUB_TABS.map(({ id, label, Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 14px',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--kp-navy)' : '2px solid transparent',
              background: 'transparent',
              color: isActive ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
              fontWeight: isActive ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-medium)',
              fontSize: 'var(--kp-font-sm)',
              fontFamily: 'inherit',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            <Icon style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2 }} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ClientMapRegion() {
  const map = useClientMapStore((s) => s.maps[DESIGN_MATTER_ID]);
  if (map === undefined) return null;

  const onOpenSource = (r: SourceRef): void => {
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

  if (useFlat) {
    // Flat card-stack view for comparison — left-aligned in the breathing gutter.
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'var(--kp-surface-gap) var(--kp-gutter) var(--kp-space-3xl)' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <ClientMapView
            map={map}
            onOpenSource={onOpenSource}
            onEditItem={onEditItem}
            onAnswerQuestion={onAnswerQuestion}
            onFlagForClient={onFlagForClient}
          />
        </div>
      </div>
    );
  }

  // The redesigned panel fills the surface; rail + content, no card, no box.
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <ClientMapPanel
        map={map}
        onOpenSource={onOpenSource}
        onEditItem={onEditItem}
        onAnswerQuestion={onAnswerQuestion}
        onFlagForClient={onFlagForClient}
      />
    </div>
  );
}

function HubMockup() {
  const [active] = useState('overview');
  return (
    <div style={surfaceStyle}>
      <div style={headerStyle}>
        <SurfaceHeader
          Icon={Briefcase}
          title="Webb Household"
          description={<><span>Marcus &amp; Tanya Webb</span><span> · </span><span>Created Sep 4, 2025</span></>}
          actions={<Badge variant="sample" size="sm">Sample</Badge>}
        />
      </div>
      <SubTabBar active={active} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ClientMapRegion />
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
    <HubMockup />
  </StrictMode>,
);
