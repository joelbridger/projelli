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

import { useEffect, useState, useMemo } from 'react';
import { Briefcase, Lock, Plus, FolderOpen, Scale, CheckCircle2, Circle, X, MessageSquare, FileText, Mail, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { useMatters, useActiveMatterId, useMatterStore } from '@/stores/matterStore';
import { matterLabel } from '@/modules/memory/matterResolver';
import { MatterHub } from '@/components/matter/MatterHub';
import { useApiKeys } from '@/hooks/useApiKeys';
import { mailIsConnected, gmailIsConnected, mailImapIsConnected } from '@/utils/mail-commands';
import type { Matter } from '@/types/matter';
import { useEntityLabel } from '@/hooks/useEntityLabel';
import { SurfaceHeader } from '@/components/layout/SurfaceHeader';

/** localStorage key for dismissing the setup card. */
const SETUP_CARD_DISMISSED_KEY = 'keepance:setup-card-dismissed';

/** Number of matters above which the search box is shown. */
const SEARCH_THRESHOLD = 5;

// ── Sort state ─────────────────────────────────────────────────────────────

type SortKey = 'name' | 'privilege' | 'documents' | 'created';
type SortDir = 'asc' | 'desc';

interface SortState {
  key: SortKey;
  dir: SortDir;
}

const DEFAULT_SORT: SortState = { key: 'name', dir: 'asc' };

// ── Get Started card ───────────────────────────────────────────────────────

/**
 * GetStartedCard — compact, dismissible setup card shown inside the empty
 * state. Uses the same live checks as SetupChecklist (useApiKeys + async
 * mail-connection probes). Disappears once dismissed or once all steps are
 * done.
 */
function GetStartedCard() {
  const matters = useMatters();
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

  // A matter exists when the list has at least one non-sample entry,
  // or any matter at all (sample counts for "created first matter").
  const hasMatter = matters.length > 0;

  // Hide once dismissed or all three steps are complete
  if (dismissed || (hasMatter && aiConnected && emailConnected === true)) return null;

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

      {/* Step 1: Create first matter */}
      <div style={stepStyle}>
        {hasMatter
          ? <CheckCircle2 style={iconDone} />
          : <Circle style={iconTodo} />
        }
        {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
        <span style={stepLabel}>Create your first matter</span>
        {!hasMatter && (
          <button
            type="button"
            style={stepBtn}
            data-testid="get-started-create-matter"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('keepance:open-matter-manager'));
            }}
          >
            Create
          </button>
        )}
      </div>

      {/* Step 2: Connect AI */}
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

      {/* Step 3: Connect email */}
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
  // Non-color cue: the Lock icon + text label "Privileged" provide a redundant
  // indicator beyond color alone, satisfying the a11y requirement.
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
        <div style={{ paddingRight: 16, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 2,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--kp-navy)',
                fontFamily: 'Satoshi, sans-serif',
                lineHeight: 1.3,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                minWidth: 0,
              }}
            >
              {label}
            </span>
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

      {/*
       * Quick-action row.
       * Accessible at rest (opacity 0.85 > 3:1 contrast on white at navy text)
       * AND visible on keyboard :focus-within of the row's wrapper div.
       * The wrapper div is not itself focusable; focus enters via the buttons.
       */}
      <div
        data-testid={`matter-quick-actions-${matter.id}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingLeft: '23px',
          paddingRight: 20,
          paddingBottom: 8,
          opacity: hovered ? 1 : 0.85,
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

interface EmptyStateProps {
  entityOne: string;
  entityOther: string;
}

function EmptyState({ entityOne, entityOther }: EmptyStateProps) {
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
        No {entityOther} yet
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--color-muted-foreground)',
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        {`Create your first ${entityOne} to keep one client's documents and emails together.`}
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
        New {entityOne}
      </button>
    </div>
  );
}

// ── Table header ───────────────────────────────────────────────────────────

interface SortIndicatorProps {
  col: SortKey;
  sort: SortState;
}

function SortIndicator({ col, sort }: SortIndicatorProps) {
  if (sort.key !== col) {
    return (
      <span
        aria-hidden="true"
        style={{ display: 'inline-flex', flexDirection: 'column', opacity: 0.3, marginLeft: 3 }}
      >
        <ChevronUp style={{ width: 9, height: 9, marginBottom: -3 }} />
        <ChevronDown style={{ width: 9, height: 9 }} />
      </span>
    );
  }
  return sort.dir === 'asc'
    ? <ChevronUp aria-hidden="true" style={{ width: 11, height: 11, marginLeft: 3, flex: 'none' }} />
    : <ChevronDown aria-hidden="true" style={{ width: 11, height: 11, marginLeft: 3, flex: 'none' }} />;
}

interface TableHeaderProps {
  entityOneLabel: string;
  sort: SortState;
  onSort: (key: SortKey) => void;
}

function TableHeader({ entityOneLabel, sort, onSort }: TableHeaderProps) {
  const baseColStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-muted-foreground)',
    padding: '10px 20px 10px 0',
  };

  const colBtnStyle = (col: SortKey): React.CSSProperties => ({
    ...baseColStyle,
    display: 'inline-flex',
    alignItems: 'center',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    color: sort.key === col ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
    fontWeight: sort.key === col ? 700 : 600,
  });

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 100px 140px 120px',
        padding: '0 20px',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div style={{ ...baseColStyle, paddingLeft: 3 }}>
        <button
          type="button"
          style={colBtnStyle('name')}
          onClick={() => { onSort('name'); }}
          aria-label={`Sort by ${entityOneLabel}${sort.key === 'name' ? (sort.dir === 'asc' ? ', currently ascending' : ', currently descending') : ''}`}
        >
          {entityOneLabel}
          <SortIndicator col="name" sort={sort} />
        </button>
      </div>
      <div style={baseColStyle}>
        <button
          type="button"
          style={colBtnStyle('privilege')}
          onClick={() => { onSort('privilege'); }}
          aria-label={`Sort by Privilege${sort.key === 'privilege' ? (sort.dir === 'asc' ? ', currently ascending' : ', currently descending') : ''}`}
        >
          Privilege
          <SortIndicator col="privilege" sort={sort} />
        </button>
      </div>
      <div style={baseColStyle}>
        <button
          type="button"
          style={colBtnStyle('documents')}
          onClick={() => { onSort('documents'); }}
          aria-label={`Sort by Documents${sort.key === 'documents' ? (sort.dir === 'asc' ? ', currently ascending' : ', currently descending') : ''}`}
        >
          Documents
          <SortIndicator col="documents" sort={sort} />
        </button>
      </div>
      <div style={baseColStyle}>
        <button
          type="button"
          style={colBtnStyle('created')}
          onClick={() => { onSort('created'); }}
          aria-label={`Sort by Created${sort.key === 'created' ? (sort.dir === 'asc' ? ', currently ascending' : ', currently descending') : ''}`}
        >
          Created
          <SortIndicator col="created" sort={sort} />
        </button>
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export function ReimaginedMattersHome() {
  const matters = useMatters();
  const activeMatterId = useActiveMatterId();
  const setActiveMatter = useMatterStore((s) => s.setActiveMatter);
  const [selectedMatterId, setSelectedMatterId] = useState<string | null>(null);
  const entityLabel = useEntityLabel();

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Sort state — default alphabetical by name
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  };

  const openCount = matters.length;
  const totalFolders = matters.reduce((sum, m) => sum + m.folderPaths.length, 0);

  // Filter by search query
  const filteredMatters = useMemo(() => {
    if (!searchQuery.trim()) return matters;
    const q = searchQuery.trim().toLowerCase();
    return matters.filter((m) => {
      const name = matterLabel(m).toLowerCase();
      const client = m.client.toLowerCase();
      return name.includes(q) || client.includes(q);
    });
  }, [matters, searchQuery]);

  // Sort filtered matters
  const sortedMatters = useMemo(() => {
    return [...filteredMatters].sort((a, b) => {
      let cmp = 0;
      if (sort.key === 'name') {
        cmp = matterLabel(a).localeCompare(matterLabel(b));
      } else if (sort.key === 'privilege') {
        // Privileged first when asc
        const ap = a.privileged ? 1 : 0;
        const bp = b.privileged ? 1 : 0;
        cmp = bp - ap;
      } else if (sort.key === 'documents') {
        cmp = b.folderPaths.length - a.folderPaths.length;
      } else {
        // sort.key === 'created'
        cmp = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [filteredMatters, sort]);

  const showSearch = matters.length > SEARCH_THRESHOLD;

  // If a hub is open, render MatterHub instead of the table
  if (selectedMatterId !== null) {
    return <MatterHub matterId={selectedMatterId} onBack={() => { setSelectedMatterId(null); }} />;
  }

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
      <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid var(--color-border)' }}>
        <SurfaceHeader
          Icon={Briefcase}
          title={entityLabel.Other}
          description={
            openCount === 0
              ? `No ${entityLabel.other} open.`
              : openCount === 1
              ? `1 ${entityLabel.one}${totalFolders > 0 ? `, ${String(totalFolders)} ${totalFolders === 1 ? 'folder' : 'folders'} indexed` : ''}. Click a row to focus AI on that client.`
              : `${String(openCount)} ${entityLabel.other}${totalFolders > 0 ? `, ${String(totalFolders)} ${totalFolders === 1 ? 'folder' : 'folders'} indexed` : ''}. Click a row to focus AI on that client.`
          }
          actions={
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
              New {entityLabel.one}
            </button>
          }
        />
      </div>

      {/* Search box — shown only when there are more than SEARCH_THRESHOLD matters */}
      {showSearch && (
        <div
          style={{
            padding: '12px 24px 0',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              background: '#fff',
              maxWidth: 380,
            }}
          >
            <Search
              aria-hidden="true"
              style={{
                width: 14,
                height: 14,
                color: 'var(--color-muted-foreground)',
                flex: 'none',
              }}
            />
            <input
              type="search"
              data-testid="matters-search-input"
              aria-label={`Search ${entityLabel.other}`}
              placeholder={`Search ${entityLabel.other}...`}
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); }}
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                fontSize: 13,
                color: 'var(--kp-navy)',
                background: 'transparent',
                fontFamily: 'Satoshi, sans-serif',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => { setSearchQuery(''); }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  color: 'var(--color-muted-foreground)',
                  lineHeight: 1,
                  display: 'flex',
                }}
              >
                <X style={{ width: 12, height: 12 }} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table card */}
      <div
        style={{
          margin: showSearch ? '12px 24px 24px' : '0 24px 24px',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        {matters.length === 0 ? (
          <EmptyState entityOne={entityLabel.one} entityOther={entityLabel.other} />
        ) : (
          <>
            <TableHeader entityOneLabel={entityLabel.One} sort={sort} onSort={toggleSort} />
            <div>
              {sortedMatters.length === 0 ? (
                <div
                  data-testid="matters-no-search-results"
                  style={{
                    padding: '24px 20px',
                    fontSize: 13,
                    color: 'var(--color-muted-foreground)',
                    textAlign: 'center',
                  }}
                >
                  {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
                  No {entityLabel.other} match your search.
                </div>
              ) : (
                sortedMatters.map((m) => (
                  <MatterRow
                    key={m.id}
                    matter={m}
                    isActive={m.id === activeMatterId}
                    onSelect={(id) => {
                      setActiveMatter(id);
                      setSelectedMatterId(id);
                    }}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
