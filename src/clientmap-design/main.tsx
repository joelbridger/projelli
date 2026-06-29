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
import { SourcePanel } from '@/features/ask/SourcePanel';
import { TurnBlock } from '@/features/ask/TurnBlock';
import type { AnswerCitation, AskTurn } from '@/features/ask/askHelpers';
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
    console.log('[design] open source', r);
  };
  const onEditItem = (sectionKey: string, itemId: string): void => {
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

// ── SOURCES column preview (?sources=1) — the restyled Ask source panel in
// isolation, since the web-demo's Webb client can't trigger a live cited answer.
const SOURCE_CITES: AnswerCitation[] = [
  { n: 1, label: 'Financial Plan Summary.md', excerpt: "Goals: retire at 60, fund both kids' college. Hold the moderate-growth allocation; rebalance once a year.", path: null, locator: '', verified: true },
  { n: 2, label: 'Review Notes.md', excerpt: 'Tanya got a raise. They can push another $400/month into savings. The $96k old 401(k) is still at the prior custodian.', path: null, locator: '', verified: true },
  { n: 3, label: 'Beneficiary Designations.md', excerpt: "The old 401(k) still lists Jessica Reyes, Marcus's first wife, as the sole primary beneficiary, dated 2019.", path: null, locator: '', verified: true },
];

function SourcesPreview() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background)', display: 'flex', justifyContent: 'flex-end' }}>
      <div
        style={{
          width: 360,
          borderLeft: '1px solid var(--kp-divider)',
          background: 'var(--kp-bg-soft)',
          padding: 'var(--kp-surface-gap) var(--kp-card-pad)',
          minHeight: '100vh',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <SourcePanel citations={SOURCE_CITES} selectedN={null} onSelect={() => {}} />
      </div>
    </div>
  );
}

// ── Answer-formatting preview (?answer=1) — renders the REAL TurnBlock /
// CitationText against a fabricated Webb answer (the web-demo Webb client can't
// trigger a live cited answer without an AI key). Mirrors the demo refs.
function cite(n: number, label: string, excerpt: string): AnswerCitation {
  return { n, label, excerpt, path: `/Webb Household/${label}`, locator: '', verified: true, matterId: DESIGN_MATTER_ID };
}
const ANSWER_TURNS: AskTurn[] = [
  {
    question: 'What should I know before my next meeting with the Webb household?',
    answer:
      "**Where things stand.** The Webbs want to retire at 60 and put both kids through college; the plan is moderate-growth, rebalanced once a year. {1}\n\n" +
      "**What changed since last meeting.** Tanya got a raise, so they can add $400/month to savings, and the old employer 401(k) (about $96k) still hasn't been rolled over. {2}\n\n" +
      "**Watch this.** ==The old 401(k) still names Marcus's ex-wife, Jessica Reyes, as the sole beneficiary, dated 2019.== If it isn't fixed before the rollover, that account would pass to her, not Tanya. {3}\n\n" +
      '**Talking points.** Start the rollover (it also fixes the beneficiary gap), confirm the Roth conversion amount before December, and raise the brokerage auto-contribution. {1}',
    citations: [
      cite(1, 'Financial Plan Summary.md', 'Goals: retire at 60, fund both kids’ college. Hold the moderate-growth allocation; rebalance once a year.'),
      cite(2, 'Review Notes.md', 'Tanya got a raise. They can push another $400/month into savings. The $96k old 401(k) is still at the prior custodian.'),
      cite(3, 'Beneficiary Designations.md', 'The old 401(k) still lists Jessica Reyes, Marcus’s first wife, as the sole primary beneficiary, dated 2019.'),
    ],
    sources: [],
  },
  {
    question: 'Draft a follow-up email asking for the missing beneficiary information.',
    answer:
      "Here's a short draft you can send.\n\n" +
      '```email\n' +
      'To: Marcus Webb\n' +
      'Subject: Quick item before we finalize your rollover\n\n' +
      'Hi Marcus,\n\n' +
      'Before we move your old 401(k) into your IRA, I want to confirm one detail on the current account. Our records show the beneficiary there still lists a name from before your 2019 update. Could you confirm the latest beneficiary form for that account?\n\n' +
      "Once that's set, the rollover puts everything under the right designations.\n\n" +
      'Thanks,\n' +
      '[Your name]\n' +
      '```',
    citations: [cite(3, 'Beneficiary Designations.md', 'The old 401(k) still lists Jessica Reyes as the sole primary beneficiary, dated 2019.')],
    sources: [],
  },
];

function AnswerPreview() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-background)', fontFamily: 'var(--font-sans)' }}>
      <div
        style={{
          maxWidth: 820,
          margin: '0 auto',
          padding: '26px 30px',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        {ANSWER_TURNS.map((turn, i) => (
          <TurnBlock
            key={i}
            turn={turn}
            turnIdx={i}
            selectedTurnIdx={null}
            selected={null}
            onCitationSelect={() => {}}
            isSaving={false}
            isPersisted={false}
          />
        ))}
      </div>
    </div>
  );
}

const showSources = params.get('sources') === '1';
const showAnswer = params.get('answer') === '1';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element');
}
createRoot(rootElement).render(
  <StrictMode>
    {showAnswer ? <AnswerPreview /> : showSources ? <SourcesPreview /> : <HubMockup />}
  </StrictMode>,
);
