/**
 * ReimaginedMattersHome — full-page, Clio-grade matters table.
 *
 * The landing surface for the reimagined matter-centric shell. Reads directly
 * from the live matterStore; clicking a row focuses AI on that client.
 * Self-contained: no required props. Wire it as `mattersContent` in
 * ReimaginedSpine to replace the placeholder.
 *
 * Styling: Tailwind utilities + CSS vars from globals.css (--kp-navy, --kp-blue,
 * --kp-accent, --color-border, --color-muted-foreground). Inline styles for
 * anything that requires a CSS variable directly. Light theme; no dark mode.
 */

import { useEffect, useState } from 'react';
import { Briefcase, Lock, Plus, FolderOpen, Scale, CheckCircle2, Circle, X, MessageSquare, FileText, Mail } from 'lucide-react';
import { useMatters, useActiveMatterId, useMatterStore } from '@/stores/matterStore';
import { matterLabel } from '@/modules/memory/matterResolver';
import { useApiKeys } from '@/hooks/useApiKeys';
import { mailIsConnected, gmailIsConnected, mailImapIsConnected } from '@/utils/mail-commands';
import type { Matter } from '@/types/matter';

/** localStorage key for dismissing the setup card. */
const SETUP_CARD_DISMISSED_KEY = 'keepance:setup-card-dismissed';

// ── Get Started card ───────────────────────────────────────────────────────

/**
 * GetStartedCard — compact, dismissible setup card shown inside the empty
 * state. Uses the same live checks as SetupChecklist (useApiKeys + async
 * mail-connection probes). Disappears once dismissed or once both steps are
 * done.
 */
function GetStartedCard() {
  const { apiKeys } = useApiKeys();
  const aiConnected = apiKeys.some((k) => k.isValid);
  const [emailConnected, setEmailConnected] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SETUP_CARD_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      mailIsConnected().catch(() => false),
      gmailIsConnected().catch(() => false),
      mailImapIsConnected().catch(() => false),
    ]).then(([m365, gmail, imap]) => {
      if (!cancelled) setEmailConnected(m365 || gmail || imap);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(SETUP_CARD_DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  // Hide once dismissed or both steps are complete
  if (dismissed || (aiConnected && emailConnected === true)) return null;

  const navigateTo = (category: 'ai' | 'integrations') => {
    window.dispatchEvent(new CustomEvent('keepance:open-settings', { detail: { category } }));
  };

  const stepStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 0',
  };
  const iconDone: React.CSSProperties = { width: 16, height: 16, color: '#059669', flex: 'none' };
  const iconTodo: React.CSSProperties = { width: 16, height: 16, color: '#9ca3af', flex: 'none' };
  const stepLabel: React.CSSProperties = {
    flex: 1,
    fontSize: 13,
    color: 'var(--kp-navy)',
    textAlign: 'left',
  };
  const stepBtn: React.CSSProperties = {
    padding: '3px 10px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 5,
    border: '1px solid rgba(10,37,64,0.22)',
    background: '#fff',
    color: 'var(--kp-navy)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      data-testid="get-started-card"
      style={{
        margin: '0 0 20px',
        border: '1px solid rgba(10,37,64,0.14)',
        borderRadius: 8,
        background: 'rgba(10,37,64,0.03)',
        padding: '14px 16px',
        position: 'relative',
      }}
    >
      {/* Dismiss */}
      <button
        type="button"
        data-testid="get-started-card-dismiss"
        aria-label="Dismiss setup card"
        onClick={dismiss}
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#9ca3af',
          padding: 2,
          lineHeight: 1,
        }}
      >
        <X style={{ width: 13, height: 13 }} />
      </button>

      <p
        style={{
          margin: '0 0 8px',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--color-muted-foreground)',
        }}
      >
        Get started
      </p>

      {/* Step: Connect AI */}
      <div style={stepStyle}>
        {aiConnected
          ? <CheckCircle2 style={iconDone} />
          : <Circle style={iconTodo} />
        }
        {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
        <span style={stepLabel}>Connect an AI</span>
        {!aiConnected && (
          <button
            type="button"
            style={stepBtn}
            onClick={() => { navigateTo('ai'); }}
          >
            Set up
          </button>
        )}
      </div>

      {/* Step: Connect email */}
      <div style={stepStyle}>
        {emailConnected === null ? (
          <Circle style={{ ...iconTodo, opacity: 0.4 }} />
        ) : emailConnected ? (
          <CheckCircle2 style={iconDone} />
        ) : (
          <Circle style={iconTodo} />
        )}
        <span style={{ ...stepLabel, opacity: emailConnected === null ? 0.5 : 1 }}>
          Connect email
        </span>
        {emailConnected === false && (
          <button
            type="button"
            style={stepBtn}
            onClick={() => { navigateTo('integrations'); }}
          >
            Set up
          </button>
        )}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────

function PrivilegePill() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.03em',
        background: 'rgba(10,37,64,0.07)',
        color: 'var(--kp-navy)',
        border: '1px solid rgba(10,37,64,0.18)',
        whiteSpace: 'nowrap',
      }}
    >
      <Lock style={{ width: 10, height: 10, strokeWidth: 2 }} />
      Privileged
    </span>
  );
}

function SamplePill() {
  return (
    <span
      data-testid="sample-matter-pill"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.03em',
        background: 'rgba(16,185,129,0.09)',
        color: '#065f46',
        border: '1px solid rgba(16,185,129,0.28)',
        whiteSpace: 'nowrap',
        marginLeft: 6,
      }}
    >
      Sample
    </span>
  );
}

interface MatterRowProps {
  matter: Matter;
  isActive: boolean;
  onSelect: (id: string) => void;
}

/** Allowed surfaces for matter-launch quick-actions. */
type MatterSurface = 'search' | 'files' | 'email';

function MatterRow({ matter, isActive, onSelect }: MatterRowProps) {
  const label = matterLabel(matter);
  const folderCount = matter.folderPaths.length;
  const [hovered, setHovered] = useState(false);

  const launchSurface = (surface: MatterSurface, e: React.MouseEvent) => {
    // Prevent the button click from also firing onSelect twice
    e.stopPropagation();
    onSelect(matter.id);
    window.dispatchEvent(
      new CustomEvent('keepance:matter-launch', {
        detail: { matterId: matter.id, surface },
      }),
    );
  };

  const quickActionBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 9px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    border: '1px solid rgba(10,37,64,0.18)',
    background: '#fff',
    color: 'var(--kp-navy)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    letterSpacing: '0.01em',
    lineHeight: 1,
    transition: 'background 0.1s',
  };

  return (
    <div
      style={{ borderBottom: '1px solid var(--color-border)' }}
      onMouseEnter={() => { setHovered(true); }}
      onMouseLeave={() => { setHovered(false); }}
    >
      {/* Primary row — click to select */}
      <button
        type="button"
        data-testid={`reimagined-matter-row-${matter.id}`}
        onClick={() => { onSelect(matter.id); }}
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 100px 140px 120px',
          alignItems: 'center',
          gap: 0,
          width: '100%',
          padding: '12px 20px 8px',
          background: isActive
            ? 'rgba(10,37,64,0.04)'
            : hovered
            ? 'rgba(10,37,64,0.02)'
            : 'transparent',
          borderLeft: isActive ? '3px solid var(--kp-navy)' : '3px solid transparent',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background 0.12s',
          borderBottom: 'none',
        }}
      >
        {/* Matter name + client */}
        <div style={{ paddingRight: 16 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--kp-navy)',
              fontFamily: 'Satoshi, sans-serif',
              lineHeight: 1.3,
              marginBottom: 2,
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 4,
            }}
          >
            {label}
            {matter.isSample && <SamplePill />}
          </div>
          {matter.client && matter.client !== matter.name && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-muted-foreground)',
                fontWeight: 400,
              }}
            >
              {matter.client}
            </div>
          )}
        </div>

        {/* Privilege */}
        <div style={{ paddingRight: 12 }}>
          {matter.privileged && <PrivilegePill />}
        </div>

        {/* Documents / scope */}
        <div
          style={{
            fontSize: 13,
            color: 'var(--color-muted-foreground)',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <FolderOpen style={{ width: 13, height: 13, strokeWidth: 1.75, flex: 'none' }} />
          {folderCount === 0
            ? 'No folders'
            : folderCount === 1
            ? '1 folder'
            : `${String(folderCount)} folders`}
        </div>

        {/* Created */}
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-muted-foreground)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatDate(matter.createdAt)}
        </div>
      </button>

      {/* Quick-action row — visible at rest (reduced opacity), full opacity on hover */}
      <div
        data-testid={`matter-quick-actions-${matter.id}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingLeft: '23px',
          paddingRight: 20,
          paddingBottom: 8,
          opacity: hovered ? 1 : 0.55,
          transition: 'opacity 0.15s',
          background: isActive ? 'rgba(10,37,64,0.04)' : hovered ? 'rgba(10,37,64,0.02)' : 'transparent',
          borderLeft: isActive ? '3px solid var(--kp-navy)' : '3px solid transparent',
        }}
      >
        <button
          type="button"
          data-testid={`matter-launch-ask-${matter.id}`}
          aria-label={`Ask AI about ${label}`}
          style={{
            ...quickActionBtn,
            background: hovered ? 'rgba(10,37,64,0.05)' : '#fff',
          }}
          onClick={(e) => { launchSurface('search', e); }}
        >
          <MessageSquare style={{ width: 11, height: 11, strokeWidth: 2, flex: 'none' }} />
          Ask
        </button>
        <button
          type="button"
          data-testid={`matter-launch-documents-${matter.id}`}
          aria-label={`Open documents for ${label}`}
          style={{
            ...quickActionBtn,
            background: hovered ? 'rgba(10,37,64,0.05)' : '#fff',
          }}
          onClick={(e) => { launchSurface('files', e); }}
        >
          <FileText style={{ width: 11, height: 11, strokeWidth: 2, flex: 'none' }} />
          Documents
        </button>
        <button
          type="button"
          data-testid={`matter-launch-email-${matter.id}`}
          aria-label={`Open email for ${label}`}
          style={{
            ...quickActionBtn,
            background: hovered ? 'rgba(10,37,64,0.05)' : '#fff',
          }}
          onClick={(e) => { launchSurface('email', e); }}
        >
          <Mail style={{ width: 11, height: 11, strokeWidth: 2, flex: 'none' }} />
          Email
        </button>
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 40px 64px',
        textAlign: 'center',
        gap: 12,
      }}
    >
      {/* Setup card — shown before matters exist so first-run value is obvious */}
      <div style={{ width: '100%', maxWidth: 340, marginBottom: 8 }}>
        <GetStartedCard />
      </div>
      <Scale
        style={{
          width: 36,
          height: 36,
          color: 'var(--color-muted-foreground)',
          strokeWidth: 1.5,
          marginBottom: 4,
        }}
      />
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--kp-navy)',
          fontFamily: 'Satoshi, sans-serif',
        }}
      >
        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
        No matters yet
        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--color-muted-foreground)',
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
        Create your first matter to keep one client's documents and emails together.
        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
      </div>
      {/* Stub button — full creation requires folder-picking via MatterManagerDialog */}
      <button
        type="button"
        style={{
          marginTop: 8,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 16px',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          background: 'var(--kp-navy)',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'Satoshi, sans-serif',
        }}
        onClick={() => {
          // Full matter creation requires folder-picking; the MatterManagerDialog
          // is the canonical entry point. Dispatching a custom event lets any
          // parent listening (e.g. App.tsx) open that dialog without a prop chain.
          window.dispatchEvent(new CustomEvent('keepance:open-matter-manager'));
        }}
      >
        <Plus style={{ width: 14, height: 14, strokeWidth: 2 }} />
        New matter
      </button>
    </div>
  );
}

// ── Table header ───────────────────────────────────────────────────────────

function TableHeader() {
  const colStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-muted-foreground)',
    padding: '10px 20px 10px 0',
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 100px 140px 120px',
        padding: '0 20px',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div style={{ ...colStyle, paddingLeft: 3 }}>Matter</div>
      <div style={colStyle}>Privilege</div>
      <div style={colStyle}>Documents</div>
      <div style={colStyle}>Created</div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export function ReimaginedMattersHome() {
  const matters = useMatters();
  const activeMatterId = useActiveMatterId();
  const setActiveMatter = useMatterStore((s) => s.setActiveMatter);

  const openCount = matters.length;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
        overflowY: 'auto',
      }}
    >
      {/* Page header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          padding: '28px 24px 20px',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 4,
            }}
          >
            <Briefcase
              style={{
                width: 18,
                height: 18,
                color: 'var(--kp-navy)',
                strokeWidth: 1.75,
                flex: 'none',
              }}
            />
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                color: 'var(--kp-navy)',
                letterSpacing: '-0.01em',
                lineHeight: 1.2,
              }}
            >
              Matters
            </h1>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: 'var(--color-muted-foreground)',
              lineHeight: 1.4,
            }}
          >
            {openCount === 0
              ? 'No matters open'
              : openCount === 1
              ? '1 matter open'
              : `${String(openCount)} matters open`}
            {openCount > 0
              ? ' — click a row to focus AI on that client.'
              : '.'}
          </p>
        </div>

        {/* New matter button — stub; real creation via MatterManagerDialog */}
        <button
          type="button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            background: 'var(--kp-navy)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flex: 'none',
          }}
          onClick={() => {
            window.dispatchEvent(new CustomEvent('keepance:open-matter-manager'));
          }}
        >
          <Plus style={{ width: 14, height: 14, strokeWidth: 2 }} />
          New matter
        </button>
      </div>

      {/* Table card */}
      <div
        style={{
          margin: '0 24px 24px',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        {matters.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <TableHeader />
            <div>
              {matters.map((m) => (
                <MatterRow
                  key={m.id}
                  matter={m}
                  isActive={m.id === activeMatterId}
                  onSelect={setActiveMatter}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
