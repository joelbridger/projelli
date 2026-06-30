/**
 * MattersHome — full-page, Clio-grade matters table.
 *
 * The landing surface for the reimagined matter-centric shell. Reads directly
 * from the live matterStore; clicking a row focuses AI on that client.
 * Self-contained: no required props. Wire it as `mattersContent` in
 * Spine to replace the placeholder.
 *
 * Styling: Tailwind utilities + CSS vars from globals.css (--kp-navy, --kp-blue,
 * --kp-accent, --color-border, --color-muted-foreground). Inline styles for
 * anything that requires a CSS variable directly. Light theme; no dark mode.
 */

import { useEffect, useState, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Briefcase, Lock, Plus, FolderOpen, CheckCircle2, Circle, MessageSquare, FileText, Mail, ChevronUp, ChevronDown, Archive, ArchiveRestore } from 'lucide-react';
import { useMatters, useActiveMatters, useArchivedMatters, useActiveMatterId, useMatterStore } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { MatterHub } from '@/features/matters/MatterHub';
import { useApiKeys } from '@/platform/hooks/useApiKeys';
import { mailIsConnected, gmailIsConnected, mailImapIsConnected } from '@/platform/utils/mail-commands';
import type { Matter } from '@/platform/types/matter';
import type { AuditEntry } from '@/platform/types/audit';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { Button, SearchField, Badge, Eyebrow, Card, EmptyState, Callout, SurfaceToolbar } from '@/ui/kp';
import { SK_SETUP_CARD_DISMISSED, EV_OPEN_SETTINGS, EV_OPEN_MATTER_MANAGER, EV_MATTER_LAUNCH } from '@/config/identity';

/** localStorage key for dismissing the setup card. */
const SETUP_CARD_DISMISSED_KEY = SK_SETUP_CARD_DISMISSED;

/** Number of matters above which the search box is shown. */
const SEARCH_THRESHOLD = 5;

export interface MattersHomeProps {
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  /**
   * The scoped per-client surfaces for the open hub's sub-tabs, supplied by the
   * shell (AppSurfaceRouter), which owns each surface's handler wiring. Forwarded
   * verbatim to the MatterHub. Absent when MattersHome is rendered standalone.
   */
  renderClientDocuments?: () => ReactNode;
  renderClientEmail?: () => ReactNode;
  renderClientActivity?: () => ReactNode;
}

// ── Sort state ─────────────────────────────────────────────────────────────

type SortKey = 'name' | 'privilege' | 'documents' | 'created';
type SortDir = 'asc' | 'desc';

interface SortState {
  key: SortKey;
  dir: SortDir;
}

const DEFAULT_SORT: SortState = { key: 'name', dir: 'asc' };

function matterRowGridColumns(showConfidentialityColumn: boolean): string {
  return showConfidentialityColumn
    ? 'minmax(0, 1fr) 100px 140px 120px'
    : 'minmax(0, 1fr) 140px 120px';
}

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
  const entityLabel = useEntityLabel();
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
    window.dispatchEvent(new CustomEvent(EV_OPEN_SETTINGS, { detail: { category } }));
  };

  const stepStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 0',
  };
  const iconDone: React.CSSProperties = { width: 'var(--kp-icon-md)', height: 'var(--kp-icon-md)', color: 'var(--kp-success)', flex: 'none' };
  const iconTodo: React.CSSProperties = { width: 'var(--kp-icon-md)', height: 'var(--kp-icon-md)', color: 'var(--color-muted-foreground)', flex: 'none' };
  const stepLabel: React.CSSProperties = {
    flex: 1,
    fontSize: 'var(--kp-font-sm)',
    lineHeight: 'var(--kp-leading-normal)',
    color: 'var(--kp-navy)',
    textAlign: 'left',
  };

  return (
    <div data-testid="get-started-card">
    <Callout
      variant="info"
      onDismiss={dismiss}
    >
      <div>
        <Eyebrow style={{ marginBottom: 8 }}>Get started</Eyebrow>

        {/* Step 1: Create first matter */}
        <div style={stepStyle}>
          {hasMatter
            ? <CheckCircle2 style={iconDone} />
            : <Circle style={iconTodo} />
          }
          {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
          <span style={stepLabel}>Create your first {entityLabel.one}</span>
          {!hasMatter && (
            <Button
              variant="secondary"
              size="sm"
              data-testid="get-started-create-matter"
              onClick={() => {
                window.dispatchEvent(new CustomEvent(EV_OPEN_MATTER_MANAGER));
              }}
            >
              Create
            </Button>
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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { navigateTo('ai'); }}
            >
              Set up
            </Button>
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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { navigateTo('integrations'); }}
            >
              Set up
            </Button>
          )}
        </div>
      </div>
    </Callout>
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
  const entityLabel = useEntityLabel();
  // Non-color cue: the Lock icon + text label provide a redundant
  // indicator beyond color alone, satisfying the a11y requirement.
  return (
    <Badge variant="privilege" size="sm" icon={Lock}>{entityLabel.confidentialityBadge}</Badge>
  );
}

function SamplePill() {
  return (
    <span data-testid="sample-matter-pill" style={{ marginLeft: 6, display: 'inline-flex' }}>
      <Badge variant="sample" size="sm">Sample</Badge>
    </span>
  );
}

interface MatterRowProps {
  matter: Matter;
  isActive: boolean;
  showConfidentialityColumn: boolean;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
}

/** Allowed surfaces for matter-launch quick-actions. */
type MatterSurface = 'search' | 'files' | 'email';

function MatterRow({ matter, isActive, showConfidentialityColumn, onSelect, onArchive }: MatterRowProps) {
  const { t } = useTranslation();
  // The search surface is "Ask"; keep this quick-action consistent.
  const askActionLabel = 'Ask';
  const label = matterLabel(matter);
  const folderCount = matter.folderPaths.length;
  const [hovered, setHovered] = useState(false);

  const launchSurface = (surface: MatterSurface, e: React.MouseEvent) => {
    // Prevent the button click from also firing onSelect twice
    e.stopPropagation();
    onSelect(matter.id);
    window.dispatchEvent(
      new CustomEvent(EV_MATTER_LAUNCH, {
        detail: { matterId: matter.id, surface },
      }),
    );
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
        data-testid={`matter-row-${matter.id}`}
        onClick={() => { onSelect(matter.id); }}
        style={{
          display: 'grid',
          gridTemplateColumns: matterRowGridColumns(showConfidentialityColumn),
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
                fontSize: 'var(--kp-font-md)',
                fontWeight: 'var(--kp-weight-semibold)',
                color: 'var(--kp-navy)',
                fontFamily: 'Satoshi, sans-serif',
                lineHeight: 'var(--kp-leading-snug)',
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
                fontSize: 'var(--kp-font-xs)',
                color: 'var(--color-muted-foreground)',
                fontWeight: 'var(--kp-weight-regular)',
              }}
            >
              {matter.client}
            </div>
          )}
        </div>

        {showConfidentialityColumn && (
          <div style={{ paddingRight: 12 }}>
            {matter.privileged && <PrivilegePill />}
          </div>
        )}

        {/* Documents / scope */}
        <div
          style={{
            fontSize: 'var(--kp-font-sm)',
            lineHeight: 'var(--kp-leading-normal)',
            color: 'var(--color-muted-foreground)',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <FolderOpen style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 1.75, flex: 'none' }} />
          {folderCount === 0
            ? 'No folders'
            : folderCount === 1
            ? '1 folder'
            : `${String(folderCount)} folders`}
        </div>

        {/* Created */}
        <div
          style={{
            fontSize: 'var(--kp-font-xs)',
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
        <Button
          variant="secondary"
          size="sm"
          data-testid={`matter-launch-ask-${matter.id}`}
          aria-label={`${askActionLabel} ${label}`}
          iconLeft={MessageSquare}
          onClick={(e) => { launchSurface('search', e); }}
        >
          {askActionLabel}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          data-testid={`matter-launch-documents-${matter.id}`}
          aria-label={`Open documents for ${label}`}
          iconLeft={FileText}
          onClick={(e) => { launchSurface('files', e); }}
        >
          Documents
        </Button>
        <Button
          variant="secondary"
          size="sm"
          data-testid={`matter-launch-email-${matter.id}`}
          aria-label={`Open email for ${label}`}
          iconLeft={Mail}
          onClick={(e) => { launchSurface('email', e); }}
        >
          Email
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid={`matter-archive-${matter.id}`}
          aria-label={t('matter.home.archive')}
          iconLeft={Archive}
          onClick={(e) => { e.stopPropagation(); onArchive(matter.id); }}
          style={{ marginLeft: 'auto' }}
        >
          {t('matter.home.archive')}
        </Button>
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

interface MattersEmptyStateProps {
  entityOne: string;
  entityOther: string;
}

function MattersEmptyState({ entityOne, entityOther }: MattersEmptyStateProps) {
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
      <EmptyState
        icon={Briefcase}
        title={`No ${entityOther} yet`}
        body={`Create your first ${entityOne} to keep one client's documents and emails together.`}
        actions={
          /* Stub button — full creation requires folder-picking via MatterManagerDialog */
          <Button
            variant="primary"
            size="md"
            iconLeft={Plus}
            onClick={() => {
              // Full matter creation requires folder-picking; the MatterManagerDialog
              // is the canonical entry point. Dispatching a custom event lets any
              // parent listening (e.g. App.tsx) open that dialog without a prop chain.
              window.dispatchEvent(new CustomEvent(EV_OPEN_MATTER_MANAGER));
            }}
          >
            New {entityOne}
          </Button>
        }
      />
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
  confidentialityColumnLabel: string;
  showConfidentialityColumn: boolean;
  sort: SortState;
  onSort: (key: SortKey) => void;
}

function TableHeader({ entityOneLabel, confidentialityColumnLabel, showConfidentialityColumn, sort, onSort }: TableHeaderProps) {
  const baseColStyle: React.CSSProperties = {
    padding: '10px 20px 10px 0',
  };

  const colBtnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: matterRowGridColumns(showConfidentialityColumn),
        padding: '0 20px',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div style={{ ...baseColStyle, paddingLeft: 3 }}>
        <button
          type="button"
          style={colBtnStyle}
          onClick={() => { onSort('name'); }}
          aria-label={`Sort by ${entityOneLabel}${sort.key === 'name' ? (sort.dir === 'asc' ? ', currently ascending' : ', currently descending') : ''}`}
        >
          <span className={`kp-eyebrow${sort.key === 'name' ? ' kp-eyebrow--primary' : ''}`}>{entityOneLabel}</span>
          <SortIndicator col="name" sort={sort} />
        </button>
      </div>
      {showConfidentialityColumn && (
        <div style={baseColStyle}>
          <button
            type="button"
            style={colBtnStyle}
            onClick={() => { onSort('privilege'); }}
            aria-label={`Sort by ${confidentialityColumnLabel}${sort.key === 'privilege' ? (sort.dir === 'asc' ? ', currently ascending' : ', currently descending') : ''}`}
          >
            <span className={`kp-eyebrow${sort.key === 'privilege' ? ' kp-eyebrow--primary' : ''}`}>{confidentialityColumnLabel}</span>
            <SortIndicator col="privilege" sort={sort} />
          </button>
        </div>
      )}
      <div style={baseColStyle}>
        <button
          type="button"
          style={colBtnStyle}
          onClick={() => { onSort('documents'); }}
          aria-label={`Sort by Documents${sort.key === 'documents' ? (sort.dir === 'asc' ? ', currently ascending' : ', currently descending') : ''}`}
        >
          <span className={`kp-eyebrow${sort.key === 'documents' ? ' kp-eyebrow--primary' : ''}`}>Documents</span>
          <SortIndicator col="documents" sort={sort} />
        </button>
      </div>
      <div style={baseColStyle}>
        <button
          type="button"
          style={colBtnStyle}
          onClick={() => { onSort('created'); }}
          aria-label={`Sort by Created${sort.key === 'created' ? (sort.dir === 'asc' ? ', currently ascending' : ', currently descending') : ''}`}
        >
          <span className={`kp-eyebrow${sort.key === 'created' ? ' kp-eyebrow--primary' : ''}`}>Created</span>
          <SortIndicator col="created" sort={sort} />
        </button>
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export function MattersHome({ onAuditLog, renderClientDocuments, renderClientEmail, renderClientActivity }: MattersHomeProps = {}) {
  const { t } = useTranslation();
  const activeMatters = useActiveMatters();
  const archivedMatters = useArchivedMatters();
  const activeMatterId = useActiveMatterId();
  const setActiveMatter = useMatterStore((s) => s.setActiveMatter);
  const setMatterArchived = useMatterStore((s) => s.setMatterArchived);
  // Hub-open state lives in the store's ephemeral clientMapHubId so it survives
  // the MattersHome remount a surface switch causes — returning to the Client
  // Map tab after drilling into a client's Documents/Email lands back on that
  // client's hub, not the all-clients overview.
  const clientMapHubId = useMatterStore((s) => s.clientMapHubId);
  const setClientMapHubId = useMatterStore((s) => s.setClientMapHubId);
  // The hub is shown for the active client only: a stale clientMapHubId left
  // over from a client switch (clientMapHubId !== activeMatterId) falls back to
  // the overview rather than showing the wrong client's hub.
  const hubMatterId = clientMapHubId !== null && clientMapHubId === activeMatterId ? clientMapHubId : null;
  const openHub = (id: string) => {
    setActiveMatter(id);
    setClientMapHubId(id);
  };
  const closeHub = () => {
    setClientMapHubId(null);
  };
  const entityLabel = useEntityLabel();
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Sort state — default alphabetical by name
  const [sortState, setSort] = useState<SortState>(DEFAULT_SORT);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  };

  const openCount = activeMatters.length;
  const totalFolders = activeMatters.reduce((sum, m) => sum + m.folderPaths.length, 0);
  const showConfidentialityColumn = activeMatters.some((m) => m.privileged);

  // If the confidentiality column is hidden, never sort by it. Derive the
  // effective sort instead of resetting it in an effect (which would trigger
  // cascading renders).
  const sort =
    !showConfidentialityColumn && sortState.key === 'privilege' ? DEFAULT_SORT : sortState;

  // Filter by search query (active matters only)
  const filteredMatters = useMemo(() => {
    if (!searchQuery.trim()) return activeMatters;
    const q = searchQuery.trim().toLowerCase();
    return activeMatters.filter((m) => {
      const name = matterLabel(m).toLowerCase();
      const client = m.client.toLowerCase();
      return name.includes(q) || client.includes(q);
    });
  }, [activeMatters, searchQuery]);

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

  const showSearch = activeMatters.length > SEARCH_THRESHOLD;

  // If a hub is open, render MatterHub instead of the table
  if (hubMatterId !== null) {
    return (
      <MatterHub
        // Remount the whole hub when the client changes, so NO per-client local
        // state (the scoped Documents folder, Email selections, Activity detail,
        // the Ask box) can survive an A->B switch into the next client (matter
        // isolation — a reused instance otherwise leaks A's state into B).
        key={hubMatterId}
        matterId={hubMatterId}
        onBack={closeHub}
        {...(onAuditLog ? { onAuditLog } : {})}
        {...(renderClientDocuments ? { renderDocuments: renderClientDocuments } : {})}
        {...(renderClientEmail ? { renderEmail: renderClientEmail } : {})}
        {...(renderClientActivity ? { renderActivity: renderClientActivity } : {})}
      />
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flex: 1,
        minWidth: 0,
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
        overflowY: 'auto',
      }}
    >
      {/* Page header */}
      <div style={{ padding: 'var(--kp-surface-header-pad)', borderBottom: '1px solid var(--color-border)' }}>
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
        />
      </div>

      {/* Toolbar */}
      <SurfaceToolbar>
        <Button
          variant="primary"
          size="md"
          iconLeft={Plus}
          onClick={() => {
            window.dispatchEvent(new CustomEvent(EV_OPEN_MATTER_MANAGER));
          }}
        >
          New {entityLabel.one}
        </Button>
        {showSearch && (
          <SearchField
            data-testid="matters-search-input"
            value={searchQuery}
            onChange={(v) => { setSearchQuery(v); }}
            onClear={() => { setSearchQuery(''); }}
            placeholder={`Search ${entityLabel.other}...`}
            aria-label={`Search ${entityLabel.other}`}
            size="md"
            style={{ flex: 1, minWidth: 240 }}
          />
        )}
      </SurfaceToolbar>

      {/* Table card — top gap below the header; surface gap keeps it off the divider line. */}
      <Card
        variant="flat"
        style={{
          margin: 'var(--kp-surface-gap) var(--kp-gutter) var(--kp-gutter)',
          overflow: 'hidden',
        }}
      >
        {activeMatters.length === 0 && archivedMatters.length === 0 ? (
          <MattersEmptyState entityOne={entityLabel.one} entityOther={entityLabel.other} />
        ) : (
          <>
            {activeMatters.length > 0 && (
              <>
                <TableHeader
                  entityOneLabel={entityLabel.One}
                  confidentialityColumnLabel={entityLabel.confidentialityColumn}
                  showConfidentialityColumn={showConfidentialityColumn}
                  sort={sort}
                  onSort={toggleSort}
                />
                <div>
                  {sortedMatters.length === 0 ? (
                    <div
                      data-testid="matters-no-search-results"
                      style={{
                        padding: '24px 20px',
                        fontSize: 'var(--kp-font-sm)',
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
                        showConfidentialityColumn={showConfidentialityColumn}
                        onSelect={(id) => { openHub(id); }}
                        onArchive={(id) => { setMatterArchived(id, true); }}
                      />
                    ))
                  )}
                </div>
              </>
            )}

            {/* Archived matters section — only shown when there are archived matters */}
            {archivedMatters.length > 0 && (
              <div
                data-testid="archived-matters-section"
                style={{
                  borderTop: activeMatters.length > 0 ? '1px solid var(--color-border)' : undefined,
                }}
              >
                <button
                  type="button"
                  data-testid="archived-matters-toggle"
                  onClick={() => { setArchivedExpanded((v) => !v); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '10px 20px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 'var(--kp-font-xs)',
                    color: 'var(--color-muted-foreground)',
                    fontWeight: 500,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Archive style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', flex: 'none' }} aria-hidden />
                    {t('matter.home.archived-section-label')} ({archivedMatters.length})
                  </span>
                  {archivedExpanded
                    ? <ChevronUp style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', flex: 'none' }} aria-hidden />
                    : <ChevronDown style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', flex: 'none' }} aria-hidden />}
                </button>

                {archivedExpanded && (
                  <div>
                    {archivedMatters.map((m) => (
                      <div
                        key={m.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '10px 20px',
                          borderTop: '1px solid var(--color-border)',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 'var(--kp-font-sm)',
                            fontWeight: 500,
                            color: 'var(--color-muted-foreground)',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                          }}>
                            {m.name || m.id}
                          </div>
                          {m.client && m.client !== m.name && (
                            <div style={{
                              fontSize: 'var(--kp-font-xs)',
                              color: 'var(--color-muted-foreground)',
                              opacity: 0.7,
                            }}>
                              {m.client}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          data-testid={`matter-restore-${m.id}`}
                          iconLeft={ArchiveRestore}
                          onClick={() => { setMatterArchived(m.id, false); }}
                          aria-label={t('matter.home.restore')}
                        >
                          {t('matter.home.restore')}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
