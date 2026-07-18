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

import {
  useEffect,
  useState,
  useMemo,
  type ReactNode,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Users,
  List,
  Lock,
  Plus,
  CheckCircle2,
  Circle,
  MessageSquare,
  FileText,
  Mail,
  ChevronUp,
  ChevronDown,
  Archive,
  ArchiveRestore,
  MoreVertical,
  Mic,
  Clock,
  ClipboardList,
} from 'lucide-react';
import {
  useMatters,
  useActiveMatters,
  useArchivedMatters,
  useActiveMatterId,
  useMatterStore,
} from '@/platform/matter/matterStore';
import {
  issueMatterScopeSelection,
  requestMatterScopeSelection,
} from '@/platform/client-context';
import { matterLabel } from '@/platform/rag/matterResolver';
import { MatterHub } from '@/features/matters/MatterHub';
import { TodaysMeetingsStrip } from '@/features/meetings/TodaysMeetingsStrip';
import { RequestsBoardContainer } from '@/features/intake/RequestsBoardContainer';
import { useApiKeys } from '@/platform/hooks/useApiKeys';
import {
  mailIsConnected,
  gmailIsConnected,
  mailImapIsConnected,
} from '@/platform/utils/mail-commands';
import type { Matter } from '@/platform/types/matter';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { AuditEntry } from '@/platform/types/audit';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import {
  Button,
  SearchField,
  Badge,
  Eyebrow,
  Card,
  EmptyState,
  Callout,
  SurfaceToolbar,
  IconButton,
  SegmentedToggle,
} from '@/ui/kp';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import {
  SK_SETUP_CARD_DISMISSED,
  SK_CLIENTS_HOME_VIEW,
  EV_OPEN_SETTINGS,
  EV_OPEN_MATTER_MANAGER,
  EV_OPEN_CLIENT_SETTINGS,
  EV_MATTER_LAUNCH,
} from '@/config/identity';
import type { MattersSurfaceMode } from '@/platform/state/appNavigationStore';

/** localStorage key for dismissing the setup card. */
const SETUP_CARD_DISMISSED_KEY = SK_SETUP_CARD_DISMISSED;

/** Number of matters above which the search box is shown. */
const SEARCH_THRESHOLD = 5;

type ClientsHomeView = 'list' | 'board';
const CLIENTS_HOME_VIEW_KEY = SK_CLIENTS_HOME_VIEW;

function readClientsHomeView(): ClientsHomeView {
  try {
    return localStorage.getItem(CLIENTS_HOME_VIEW_KEY) === 'board'
      ? 'board'
      : 'list';
  } catch (error: unknown) {
    console.debug('Could not read clients home view preference:', error);
    return 'list';
  }
}

function writeClientsHomeView(view: ClientsHomeView): void {
  try {
    localStorage.setItem(CLIENTS_HOME_VIEW_KEY, view);
  } catch (error: unknown) {
    console.debug('Could not save clients home view preference:', error);
  }
}

export interface MattersHomeProps {
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  /**
   * The scoped per-client surfaces for the open hub's sub-tabs, supplied by the
   * shell (AppSurfaceRouter), which owns each surface's handler wiring. Forwarded
   * verbatim to the MatterHub. Absent when MattersHome is rendered standalone.
   */
  /**
   * Handed the exact `Matter` the open hub is rendering (from MatterHub), so the
   * scoped Documents surface reads its `folderPaths`/id from the client actually
   * on screen, not a stale outer "active matter" closure in the shell.
  */
  renderClientDocuments?: (matter: Matter | null) => ReactNode;
  renderClientEmail?: () => ReactNode;
  renderClientActivity?: (options?: { clientMapSectionKey?: string; clientMapSectionTitle?: string }) => ReactNode;
  /** Forwarded verbatim to MatterHub's Meetings sub-tab (see MatterHubProps). */
  workspaceService?: WorkspaceService | null;
  clientMapMode?: MattersSurfaceMode;
  onClientMapModeChange?: ((mode: MattersSurfaceMode) => void) | undefined;
}

// ── Sort state ─────────────────────────────────────────────────────────────

type SortKey = 'name' | 'privilege' | 'created';
type SortDir = 'asc' | 'desc';

interface SortState {
  key: SortKey;
  dir: SortDir;
}

const DEFAULT_SORT: SortState = { key: 'name', dir: 'asc' };

function matterRowGridColumns(showConfidentialityColumn: boolean): string {
  return showConfidentialityColumn
    ? 'minmax(180px, 1fr) 112px 96px 36px'
    : 'minmax(180px, 1fr) 96px 36px';
}

// ── Get Started card ───────────────────────────────────────────────────────

/**
 * GetStartedCard — compact, dismissible setup card shown inside the empty
 * state. Uses the same live checks as SetupChecklist (useApiKeys + async
 * mail-connection probes). Disappears once dismissed or once all steps are
 * done.
 */
function GetStartedCard() {
  const { t } = useTranslation();
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
  if (dismissed || (hasMatter && aiConnected && emailConnected === true))
    return null;

  const navigateTo = (category: 'ai' | 'integrations') => {
    window.dispatchEvent(
      new CustomEvent(EV_OPEN_SETTINGS, { detail: { category } })
    );
  };

  const stepStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 0',
  };
  const iconDone: React.CSSProperties = {
    width: 'var(--kp-icon-md)',
    height: 'var(--kp-icon-md)',
    color: 'var(--kp-success)',
    flex: 'none',
  };
  const iconTodo: React.CSSProperties = {
    width: 'var(--kp-icon-md)',
    height: 'var(--kp-icon-md)',
    color: 'var(--color-muted-foreground)',
    flex: 'none',
  };
  const stepLabel: React.CSSProperties = {
    flex: 1,
    fontSize: 'var(--kp-font-sm)',
    lineHeight: 'var(--kp-leading-normal)',
    color: 'var(--kp-navy)',
    textAlign: 'left',
  };

  return (
    <div data-testid="get-started-card">
      <Callout variant="info" onDismiss={dismiss}>
        <div>
          <Eyebrow style={{ marginBottom: 8 }}>
            {t('matter.home.get-started.eyebrow')}
          </Eyebrow>

          {/* Step 1: Create first matter */}
          <div style={stepStyle}>
            {hasMatter ? (
              <CheckCircle2 style={iconDone} />
            ) : (
              <Circle style={iconTodo} />
            )}
            <span style={stepLabel}>
              {t('matter.home.get-started.step1', { entity: entityLabel.one })}
            </span>
            {!hasMatter && (
              <Button
                variant="secondary"
                size="sm"
                data-testid="get-started-create-matter"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent(EV_OPEN_MATTER_MANAGER));
                }}
              >
                {t('matter.home.get-started.create-action')}
              </Button>
            )}
          </div>

          {/* Step 2: Connect AI */}
          <div style={stepStyle}>
            {aiConnected ? (
              <CheckCircle2 style={iconDone} />
            ) : (
              <Circle style={iconTodo} />
            )}
            <span style={stepLabel}>{t('matter.home.get-started.step2')}</span>
            {!aiConnected && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigateTo('ai');
                }}
              >
                {t('matter.home.get-started.setup-action')}
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
            <span
              style={{
                ...stepLabel,
                opacity: emailConnected === null ? 0.5 : 1,
              }}
            >
              {t('matter.home.get-started.step3')}
            </span>
            {emailConnected === false && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigateTo('integrations');
                }}
              >
                {t('matter.home.get-started.setup-action')}
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
    <Badge variant="privilege" size="sm" icon={Lock}>
      {entityLabel.confidentialityBadge}
    </Badge>
  );
}

function SamplePill() {
  return (
    <span
      data-testid="sample-matter-pill"
      style={{ marginLeft: 6, display: 'inline-flex' }}
    >
      <Badge variant="sample" size="sm">
        Sample
      </Badge>
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
type MatterSurface = 'search' | 'files' | 'email' | 'meetings' | 'audit';

function MatterRow({
  matter,
  isActive,
  showConfidentialityColumn,
  onSelect,
  onArchive,
}: MatterRowProps) {
  const { t } = useTranslation();
  // The search surface is "Ask"; keep this quick-action consistent.
  const askActionLabel = t('spine.nav.ask');
  const label = matterLabel(matter);
  const [hovered, setHovered] = useState(false);

  const launchSurface = (surface: MatterSurface, e: MouseEvent) => {
    // Prevent menu clicks from also opening the default Client Map row target.
    e.stopPropagation();
    onSelect(matter.id);
    window.dispatchEvent(
      new CustomEvent(EV_MATTER_LAUNCH, {
        detail: { matterId: matter.id, surface },
      })
    );
  };

  const rowBackground = isActive
    ? 'var(--kp-action-bg)'
    : hovered
      ? 'var(--color-muted)'
      : 'transparent';
  return (
    <div
      data-testid={`matter-row-shell-${matter.id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: matterRowGridColumns(showConfidentialityColumn),
        alignItems: 'center',
        gap: 'var(--kp-space-sm)',
        width: '100%',
        padding: '14px 20px',
        background: rowBackground,
        borderLeft: isActive
          ? '3px solid var(--kp-accent)'
          : '3px solid transparent',
        borderBottom: '1px solid var(--kp-divider)',
        transition:
          'background var(--kp-duration-fast) var(--kp-ease-standard)',
      }}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      onClick={() => {
        onSelect(matter.id);
      }}
    >
      {/* Client name — click to open this client's hub. */}
      <button
        type="button"
        data-testid={`matter-row-${matter.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(matter.id);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--kp-space-xs)',
          width: '100%',
          minWidth: 0,
          padding: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ minWidth: 0 }}>
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
      </button>

      <div
        data-testid={`matter-quick-actions-${matter.id}`}
        style={{
          display: 'contents',
        }}
      >
        {showConfidentialityColumn && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            {matter.privileged && <PrivilegePill />}
          </div>
        )}

        <div
          style={{
            fontSize: 'var(--kp-font-xs)',
            color: 'var(--color-muted-foreground)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {formatDate(matter.createdAt)}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              icon={MoreVertical}
              label={t('matter.home.row-menu-aria', { name: label })}
              variant="ghost"
              size="sm"
              data-testid={`matter-actions-menu-${matter.id}`}
              onClick={(e) => {
                e.stopPropagation();
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              data-testid={`matter-menu-open-client-${matter.id}`}
              onClick={() => {
                onSelect(matter.id);
              }}
            >
              {t('matter.home.open-client')}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid={`matter-launch-ask-${matter.id}`}
              aria-label={t('matter.home.ask-aria', { name: label })}
              onClick={(e) => {
                launchSurface('search', e);
              }}
            >
              <MessageSquare size={14} aria-hidden="true" />
              <span data-testid={`matter-menu-ask-${matter.id}`}>
                {askActionLabel}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid={`matter-launch-documents-${matter.id}`}
              aria-label={t('matter.home.open-documents-aria', { name: label })}
              onClick={(e) => {
                launchSurface('files', e);
              }}
            >
              <FileText size={14} aria-hidden="true" />
              <span data-testid={`matter-menu-documents-${matter.id}`}>
                {t('matter.hub.tab-documents')}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid={`matter-launch-email-${matter.id}`}
              aria-label={t('matter.home.open-email-aria', { name: label })}
              onClick={(e) => {
                launchSurface('email', e);
              }}
            >
              <Mail size={14} aria-hidden="true" />
              {t('matter.hub.tab-email')}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid={`matter-launch-meetings-${matter.id}`}
              aria-label={t('matter.home.open-meetings-aria', { name: label })}
              onClick={(e) => {
                launchSurface('meetings', e);
              }}
            >
              <Mic size={14} aria-hidden="true" />
              {t('matter.hub.tab-meetings')}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid={`matter-launch-activity-${matter.id}`}
              aria-label={t('matter.home.open-activity-aria', { name: label })}
              onClick={(e) => {
                launchSurface('audit', e);
              }}
            >
              <Clock size={14} aria-hidden="true" />
              {t('matter.hub.tab-activity')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid={`matter-settings-${matter.id}`}
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(
                  new CustomEvent(EV_OPEN_CLIENT_SETTINGS, {
                    detail: { matterId: matter.id },
                  })
                );
              }}
            >
              {t('matter.home.client-settings')}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid={`matter-archive-${matter.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onArchive(matter.id);
              }}
            >
              {t('matter.home.archive')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
  const { t } = useTranslation();
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
        icon={Users}
        title={t('matter.home.empty-title', { entityOther })}
        body={t('matter.home.empty-body', { entityOne })}
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
            {t('matter.home.new-client', { entity: entityOne })}
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
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          opacity: 0.3,
          marginLeft: 3,
        }}
      >
        <ChevronUp style={{ width: 9, height: 9, marginBottom: -3 }} />
        <ChevronDown style={{ width: 9, height: 9 }} />
      </span>
    );
  }
  return sort.dir === 'asc' ? (
    <ChevronUp
      aria-hidden="true"
      style={{ width: 11, height: 11, marginLeft: 3, flex: 'none' }}
    />
  ) : (
    <ChevronDown
      aria-hidden="true"
      style={{ width: 11, height: 11, marginLeft: 3, flex: 'none' }}
    />
  );
}

interface TableHeaderProps {
  entityOneLabel: string;
  confidentialityColumnLabel: string;
  showConfidentialityColumn: boolean;
  sort: SortState;
  onSort: (key: SortKey) => void;
}

/** aria-label for a sortable column header, appending the current sort
 *  direction only when this column is the active sort key. */
function sortByAria(
  column: string,
  active: boolean,
  dir: SortDir,
  t: TFunction
): string {
  const direction = !active
    ? ''
    : dir === 'asc'
      ? t('matter.home.sort-asc-suffix')
      : t('matter.home.sort-desc-suffix');
  return t('matter.home.sort-by-aria', { column, direction });
}

function TableHeader({
  entityOneLabel,
  confidentialityColumnLabel,
  showConfidentialityColumn,
  sort,
  onSort,
}: TableHeaderProps) {
  const { t } = useTranslation();
  const createdLabel = t('matter.home.col-created');
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
        gap: 'var(--kp-space-sm)',
        padding: '0 20px',
        borderBottom: '1px solid var(--kp-divider)',
        background: 'var(--color-muted)',
      }}
    >
      <div style={{ ...baseColStyle, paddingLeft: 3 }}>
        <button
          type="button"
          style={colBtnStyle}
          onClick={() => {
            onSort('name');
          }}
          aria-label={sortByAria(
            entityOneLabel,
            sort.key === 'name',
            sort.dir,
            t
          )}
        >
          <span
            className={`kp-eyebrow${sort.key === 'name' ? ' kp-eyebrow--primary' : ''}`}
          >
            {entityOneLabel}
          </span>
          <SortIndicator col="name" sort={sort} />
        </button>
      </div>
      <div aria-hidden="true" />
      {showConfidentialityColumn && (
        <div style={baseColStyle}>
          <button
            type="button"
            style={colBtnStyle}
            onClick={() => {
              onSort('privilege');
            }}
            aria-label={sortByAria(
              confidentialityColumnLabel,
              sort.key === 'privilege',
              sort.dir,
              t
            )}
          >
            <span
              className={`kp-eyebrow${sort.key === 'privilege' ? ' kp-eyebrow--primary' : ''}`}
            >
              {confidentialityColumnLabel}
            </span>
            <SortIndicator col="privilege" sort={sort} />
          </button>
        </div>
      )}
      <div style={baseColStyle}>
        <button
          type="button"
          style={colBtnStyle}
          onClick={() => {
            onSort('created');
          }}
          aria-label={sortByAria(
            createdLabel,
            sort.key === 'created',
            sort.dir,
            t
          )}
        >
          <span
            className={`kp-eyebrow${sort.key === 'created' ? ' kp-eyebrow--primary' : ''}`}
          >
            {createdLabel}
          </span>
          <SortIndicator col="created" sort={sort} />
        </button>
      </div>
      <div aria-hidden="true" />
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export function MattersHome({
  onAuditLog,
  renderClientDocuments,
  renderClientEmail,
  renderClientActivity,
  workspaceService,
  clientMapMode = 'client-map',
  onClientMapModeChange,
}: MattersHomeProps = {}) {
  const { t } = useTranslation();
  const activeMatters = useActiveMatters();
  const archivedMatters = useArchivedMatters();
  const activeMatterId = useActiveMatterId();
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
  const hubMatterId =
    clientMapMode !== 'all-clients' && clientMapHubId !== null && clientMapHubId === activeMatterId
      ? clientMapHubId
      : null;
  const openHub = (id: string) => {
    const request = issueMatterScopeSelection(id);
    void requestMatterScopeSelection(request)
      .then((result) => {
        if (result.kind === 'refused') return;
        onClientMapModeChange?.('client-map');
        setClientMapHubId(id);
      })
      .catch((error: unknown) => {
        console.error('[Client Map] Client scope selection failed.', error);
      });
  };
  const closeHub = () => {
    onClientMapModeChange?.('all-clients');
    setClientMapHubId(null);
  };
  const entityLabel = useEntityLabel();
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [clientsHomeView, setClientsHomeView] =
    useState<ClientsHomeView>(readClientsHomeView);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Sort state — default alphabetical by name
  const [sortState, setSort] = useState<SortState>(DEFAULT_SORT);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    );
  };

  const showConfidentialityColumn = activeMatters.some((m) => m.privileged);

  // If the confidentiality column is hidden, never sort by it. Derive the
  // effective sort instead of resetting it in an effect (which would trigger
  // cascading renders).
  const sort =
    !showConfidentialityColumn && sortState.key === 'privilege'
      ? DEFAULT_SORT
      : sortState;

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
      } else {
        // sort.key === 'created'
        cmp = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [filteredMatters, sort]);

  const showSearch = activeMatters.length > SEARCH_THRESHOLD;
  const setHomeView = (view: ClientsHomeView) => {
    setClientsHomeView(view);
    writeClientsHomeView(view);
  };

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
        {...(renderClientDocuments
          ? { renderDocuments: renderClientDocuments }
          : {})}
        {...(renderClientEmail ? { renderEmail: renderClientEmail } : {})}
        {...(renderClientActivity
          ? { renderActivity: renderClientActivity }
          : {})}
        workspaceService={workspaceService ?? null}
      />
    );
  }

  const header = (
    <div
      style={{
        padding: 'var(--kp-surface-header-pad)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <SurfaceHeader
        Icon={Users}
        iconColor="var(--kp-accent)"
        title={entityLabel.Other}
      />
    </div>
  );

  const newClientButton = (
    <Button
      variant="primary"
      size="md"
      iconLeft={Plus}
      onClick={() => {
        window.dispatchEvent(new CustomEvent(EV_OPEN_MATTER_MANAGER));
      }}
    >
      {t('matter.home.new-client', { entity: entityLabel.one })}
    </Button>
  );
  const openNewClient = () => {
    window.dispatchEvent(new CustomEvent(EV_OPEN_MATTER_MANAGER));
  };
  const viewToggle = (
    <SegmentedToggle<ClientsHomeView>
      ariaLabel={t('intake.board.view-toggle-aria')}
      size="sm"
      variant="filled"
      value={clientsHomeView}
      onChange={setHomeView}
      data-testid="clients-home-view-toggle"
      options={[
        {
          value: 'list',
          label: t('intake.board.view-list'),
          icon: List,
          testId: 'clients-home-view-list',
        },
        {
          value: 'board',
          label: t('intake.board.view-board'),
          icon: ClipboardList,
          testId: 'clients-home-view-board',
        },
      ]}
    />
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
        overflowY: 'auto',
      }}
      data-testid="matters-home-scroll"
    >
      {/* Page header */}
      {header}

      <div style={{ margin: 'var(--kp-surface-gap) var(--kp-gutter) 0' }}>
        <TodaysMeetingsStrip onOpenClient={openHub} />
      </div>

      {/* Toolbar */}
      <SurfaceToolbar>
        {newClientButton}
        {viewToggle}
        {showSearch && clientsHomeView === 'list' && (
          <SearchField
            data-testid="matters-search-input"
            value={searchQuery}
            onChange={(v) => {
              setSearchQuery(v);
            }}
            onClear={() => {
              setSearchQuery('');
            }}
            placeholder={t('matter.home.search-placeholder', {
              entity: entityLabel.other,
            })}
            aria-label={t('matter.home.search-aria', {
              entity: entityLabel.other,
            })}
            size="md"
            style={{ flex: 1, minWidth: 240, marginLeft: 'auto' }}
          />
        )}
      </SurfaceToolbar>

      {/* Table card — top gap below the header; surface gap keeps it off the divider line. */}
      <Card
        variant="flat"
        style={{
          margin: 'var(--kp-surface-gap) var(--kp-gutter) var(--kp-gutter)',
          overflow: 'hidden',
          borderColor: 'var(--kp-divider)',
        }}
      >
        {clientsHomeView === 'board' ? (
          <RequestsBoardContainer onNewClient={openNewClient} />
        ) : activeMatters.length === 0 && archivedMatters.length === 0 ? (
          <MattersEmptyState
            entityOne={entityLabel.one}
            entityOther={entityLabel.other}
          />
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
                      {t('matter.home.no-match', { entity: entityLabel.other })}
                    </div>
                  ) : (
                    sortedMatters.map((m) => (
                      <MatterRow
                        key={m.id}
                        matter={m}
                        isActive={m.id === activeMatterId}
                        showConfidentialityColumn={showConfidentialityColumn}
                        onSelect={(id) => {
                          openHub(id);
                        }}
                        onArchive={(id) => {
                          setMatterArchived(id, true);
                        }}
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
                  borderTop:
                    activeMatters.length > 0
                      ? '1px solid var(--color-border)'
                      : undefined,
                }}
              >
                <button
                  type="button"
                  data-testid="archived-matters-toggle"
                  onClick={() => {
                    setArchivedExpanded((v) => !v);
                  }}
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
                  <span
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Archive
                      style={{
                        width: 'var(--kp-icon-sm)',
                        height: 'var(--kp-icon-sm)',
                        flex: 'none',
                      }}
                      aria-hidden
                    />
                    {t('matter.home.archived-section-label')} (
                    {archivedMatters.length})
                  </span>
                  {archivedExpanded ? (
                    <ChevronUp
                      style={{
                        width: 'var(--kp-icon-sm)',
                        height: 'var(--kp-icon-sm)',
                        flex: 'none',
                      }}
                      aria-hidden
                    />
                  ) : (
                    <ChevronDown
                      style={{
                        width: 'var(--kp-icon-sm)',
                        height: 'var(--kp-icon-sm)',
                        flex: 'none',
                      }}
                      aria-hidden
                    />
                  )}
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
                          <div
                            style={{
                              fontSize: 'var(--kp-font-sm)',
                              fontWeight: 500,
                              color: 'var(--color-muted-foreground)',
                              overflow: 'hidden',
                              whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {m.name || m.id}
                          </div>
                          {m.client && m.client !== m.name && (
                            <div
                              style={{
                                fontSize: 'var(--kp-font-xs)',
                                color: 'var(--color-muted-foreground)',
                                opacity: 0.7,
                              }}
                            >
                              {m.client}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          data-testid={`matter-restore-${m.id}`}
                          iconLeft={ArchiveRestore}
                          onClick={() => {
                            setMatterArchived(m.id, false);
                          }}
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
