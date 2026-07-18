/**
 * Spine — the matter-centric navy "Spine" nav, brand-matched to lantern.com.
 * The CRM 3-tab IA: Home · Clients · Ask. Documents, Email, Activity Log,
 * Privacy Center, and Settings are reached via the gear menu, the Ask source
 * filter, and Client Map quick actions — they stay routable content surfaces,
 * just not rail tabs. The binder spine of the case file.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  MoreVertical,
  Trash2,
  Pencil,
} from 'lucide-react';
import {
  useActiveMatters,
  useActiveMatterId,
  useMatterStore,
} from '@/platform/matter/matterStore';
import {
  useClientGroups,
  useClientGroupStore,
} from '@/platform/matter/clientGroupStore';
import { AccountIdentity } from './AccountIdentity';
import { matterLabel } from '@/platform/rag/matterResolver';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { IconButton } from '@/ui/kp';
import { getOrderedAppSurfaces } from '@/app/shell/registry/appSurfaceRegistry';
import { useAppSurfaceRegistry } from '@/app/shell/runtime/useAppSurfaceRegistry';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import {
  EV_OPEN_ACCOUNT,
  EV_OPEN_MATTER_MANAGER,
  EV_OPEN_NEW_GROUP,
  EV_MATTER_LAUNCH,
} from '@/config/identity';
import {
  issueAllMattersScopeSelection,
  requestMatterScopeSelection,
} from '@/platform/client-context';

interface SpineProps {
  fileTreeContent?: React.ReactNode;
  searchContent?: React.ReactNode;
  workflowContent?: React.ReactNode;
  aiAssistantContent?: React.ReactNode;
  auditContent?: React.ReactNode;
  trashContent?: React.ReactNode;
  mattersContent?: React.ReactNode;
  emailContent?: React.ReactNode | undefined;
  schedulingContent?: React.ReactNode | undefined;
  settingsContent?: React.ReactNode | undefined;
  privacyContent?: React.ReactNode | undefined;
  activeTab?: string | undefined;
  onTabChange?: ((tab: string) => void) | undefined;
  onAllClientsSelect?: (() => void) | undefined;
  allClientsSelected?: boolean | undefined;
  collapsed?: boolean | undefined;
  onCollapsedChange?: ((next: boolean) => void) | undefined;
}

export function Spine({
  activeTab = 'matters',
  onTabChange,
  onAllClientsSelect,
  allClientsSelected,
  collapsed = false,
  onCollapsedChange,
}: SpineProps) {
  const { t } = useTranslation();
  const { descriptors } = useAppSurfaceRegistry();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const clientSearchRef = useRef<HTMLInputElement | null>(null);
  // Collapsible "Clients" section: open by default (the active client should
  // still be visible without an extra click), but no longer force-stretched
  // to fill the rest of the rail — it sizes to its own content/cap instead.
  const [clientsOpen, setClientsOpen] = useState(true);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [clientSearchExpanded, setClientSearchExpanded] = useState(false);
  // Archived clients stay reachable via the Client Map's archived section
  // (MattersHome) and the Clients management dialog — the rail switcher
  // only ever lists the active roster, so archiving a client actually
  // shrinks this list instead of leaving it there forever.
  const matters = useActiveMatters();
  const activeMatterId = useActiveMatterId();
  const setClientMapHubId = useMatterStore((s) => s.setClientMapHubId);
  const setClientMapHubTab = useMatterStore((s) => s.setClientMapHubTab);
  // Client groups (feedback line 13). Rendered as collapsible sections under
  // "All clients"; membership is local-first (ids only).
  const groups = useClientGroups();
  const deleteGroup = useClientGroupStore((s) => s.deleteGroup);
  const renameGroup = useClientGroupStore((s) => s.renameGroup);
  // Which groups are collapsed in the rail (default expanded). Keyed by id.
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  // Inline rename: the group id being renamed and its working text.
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const entityLabel = useEntityLabel();
  const newClientLabel = t('spine.new-client', { entity: entityLabel.one });
  const filteredMatters = (() => {
    const q = clientSearchQuery.trim().toLowerCase();
    if (!q) return matters;
    return matters.filter(
      (m) =>
        matterLabel(m).toLowerCase().includes(q) ||
        m.client.toLowerCase().includes(q)
    );
  })();
  // C2: search is ALWAYS an icon that expands on demand — never an always-open
  // bar, and never dependent on how many clients exist (threshold UI changes
  // shape as data grows, so users can't build habits).
  const clientSearchVisible =
    clientSearchExpanded || clientSearchQuery.trim().length > 0;

  useEffect(() => {
    if (clientSearchExpanded && clientsOpen) {
      clientSearchRef.current?.focus();
    }
  }, [clientSearchExpanded, clientsOpen]);

  // Placement and order come from the same descriptors the outlet uses.
  // The current registry preserves D11's three visible destinations exactly.
  const nav = getOrderedAppSurfaces('primary', descriptors);
  const active = descriptors.some((descriptor) => descriptor.id === activeTab)
    ? activeTab
    : 'matters';
  const allClientsActive =
    allClientsSelected ?? (active === 'matters' && activeMatterId === null);

  // A single client row, reused by the flat list and by each group section.
  // When rendered inside a group, `groupId` is set so the handle differs from
  // the flat-list row — a client that lives in a group AND the flat list never
  // produces a duplicate handle. The data-testid is written as two inline
  // template literals so the static handle-guard scanner sees both.
  const renderClientRow = (m: (typeof matters)[number], groupId?: string) => {
    const on = m.id === activeMatterId && !allClientsActive;
    const fullLabel = matterLabel(m);
    const displayLabel = m.client.trim() || fullLabel;
    return (
      <button
        key={groupId ? `g-${groupId}-${m.id}` : m.id}
        type="button"
        data-testid={!groupId ? `spine-client-row-${m.id}` : `spine-group-client-row-${groupId}-${m.id}`}
        title={fullLabel}
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent(EV_MATTER_LAUNCH, {
              detail: { matterId: m.id, surface: 'matters' },
            })
          );
        }}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          border: 0,
          cursor: 'pointer',
          background: on ? 'var(--kp-side-active-bg)' : 'transparent',
          color: 'var(--kp-side-fg)',
          padding: 'var(--kp-space-xs) var(--kp-space-sm)',
          borderRadius: 'var(--radius-md)',
          position: 'relative',
        }}
      >
        {on && (
          <span
            style={{
              position: 'absolute',
              left: 3,
              top: 8,
              bottom: 8,
              width: 3,
              borderRadius: 3,
              background: 'var(--kp-side-accent)',
            }}
          />
        )}
        <div
          style={{
            fontSize: 'var(--kp-font-sm)',
            fontWeight: 'var(--kp-weight-semibold)',
            color: 'var(--kp-side-fg)',
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {displayLabel}
        </div>
      </button>
    );
  };

  // Resolve a group's live members (drops stale ids — e.g. a since-deleted
  // client, or a matter from another workspace) and apply the active search
  // filter so a searching user sees matching group members too.
  const membersOf = (matterIds: string[]) =>
    matterIds
      .map((id) => filteredMatters.find((m) => m.id === id))
      .filter((m): m is (typeof matters)[number] => m !== undefined);

  const commitRename = (groupId: string) => {
    if (renameDraft.trim()) renameGroup(groupId, renameDraft);
    setRenamingGroupId(null);
    setRenameDraft('');
  };

  if (collapsed) {
    return (
      <nav
        aria-label={t('spine.aria.primary-nav')}
        style={{
          width: 56,
          background: 'var(--kp-side-bg)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          paddingTop: 'var(--kp-space-xs)',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: 2,
            background: 'var(--kp-side-edge)',
            opacity: 1,
          }}
        />
        <IconButton
          icon={ChevronRight}
          label={t('layout.sidebar.expand-aria')}
          variant="ghost"
          size="sm"
          onClick={() => onCollapsedChange?.(false)}
          style={{
            color: 'var(--kp-side-fg-dim)',
            marginBottom: 'var(--kp-space-xs)',
          }}
        />
        {nav.map(({ id, labelKey, legacyLabel, icon: Icon }) => {
          const label = legacyLabel ?? t(labelKey);
          return (
            <button
              key={id}
              type="button"
              title={label}
              aria-current={
                active === id && !(id === 'matters' && allClientsActive)
                  ? 'page'
                  : undefined
              }
              data-testid={`spine-nav-collapsed-${id}`}
              onClick={() => onTabChange?.(id)}
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-lg)',
                border: 0,
                cursor: 'pointer',
                color:
                  active === id && !(id === 'matters' && allClientsActive)
                    ? 'var(--kp-side-fg)'
                    : 'var(--kp-side-fg-dim)',
                background:
                  active === id && !(id === 'matters' && allClientsActive)
                    ? 'var(--kp-side-active-bg)'
                    : 'transparent',
              }}
            >
              <Icon size={18} style={{ margin: '0 auto' }} strokeWidth={1.75} />
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <AccountIdentity
          collapsed
          onOpen={() => {
            window.dispatchEvent(new CustomEvent(EV_OPEN_ACCOUNT));
          }}
        />
        <div style={{ height: 'var(--kp-space-xs)' }} />
      </nav>
    );
  }

  return (
    <div
      data-testid="sidebar"
      style={{ display: 'flex', height: '100%', minHeight: 0 }}
    >
      {/* Navy spine */}
      <nav
        aria-label={t('spine.aria.primary-nav')}
        data-testid="spine-nav"
        style={{
          width: 212,
          background: 'var(--kp-side-bg)',
          color: 'var(--kp-side-fg)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          position: 'relative',
          flex: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: 2,
            background: 'var(--kp-side-edge)',
            opacity: 1,
          }}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: 'var(--kp-space-xs) 10px',
            flex: 'none',
          }}
        >
          {nav.map(({ id, labelKey, legacyLabel, icon: Icon }) => {
            const label = legacyLabel ?? t(labelKey);
            // The Client Map tab yields its highlight while All Clients mode is on.
            const on = active === id && !(id === 'matters' && allClientsActive);
            return (
              <button
                key={id}
                type="button"
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                aria-current={on ? 'page' : undefined}
                onClick={() => onTabChange?.(id)}
                data-testid={`spine-nav-${id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--kp-space-sm)',
                  width: '100%',
                  padding: 'var(--kp-space-xs) var(--kp-space-sm)',
                  borderRadius: 'var(--radius-md)',
                  border: 0,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 'var(--kp-font-sm)',
                  position: 'relative',
                  fontWeight: on
                    ? 'var(--kp-weight-semibold)'
                    : 'var(--kp-weight-medium)',
                  color: on ? 'var(--kp-side-fg)' : 'var(--kp-side-fg-dim)',
                  background: on ? 'var(--kp-side-active-bg)' : 'transparent',
                }}
              >
                {on && (
                  <span
                    style={{
                      position: 'absolute',
                      left: 3,
                      width: 3,
                      height: 18,
                      borderRadius: 3,
                      background: 'var(--kp-side-accent)',
                    }}
                  />
                )}
                <Icon
                  size={16}
                  strokeWidth={1.75}
                  style={{ flex: 'none', opacity: on ? 1 : 0.9 }}
                />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
        <div
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            borderTop: '1px solid var(--kp-side-border)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header row toggles the section and carries the "+ New client" affordance. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--kp-space-xs)',
              padding: 'var(--kp-space-xs) 10px 6px',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setClientsOpen((v) => !v);
              }}
              aria-expanded={clientsOpen}
              data-testid="spine-clients-toggle"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                border: 0,
                background: 'transparent',
                cursor: 'pointer',
                padding: 0,
                color: 'var(--kp-side-fg-faint)',
              }}
            >
              <ChevronDown
                size={12}
                strokeWidth={2.5}
                style={{
                  transform: clientsOpen ? undefined : 'rotate(-90deg)',
                  transition: 'transform 0.15s',
                  flex: 'none',
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 'var(--kp-weight-bold)',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                }}
              >
                {entityLabel.Other}
              </span>
            </button>
            {!clientSearchVisible && (
              <button
                type="button"
                data-testid="spine-client-search-toggle"
                title={t('spine.find-client')}
                aria-label={t('spine.find-client')}
                onClick={() => {
                  setClientsOpen(true);
                  setClientSearchExpanded(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  borderRadius: 'var(--radius-md)',
                  border: 0,
                  background: 'transparent',
                  color: 'var(--kp-side-fg-dim)',
                  cursor: 'pointer',
                  flex: 'none',
                }}
              >
                <Search size={14} strokeWidth={2} />
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="spine-new-client"
                  title={t('spine.add-menu')}
                  aria-label={t('spine.add-menu')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22,
                    height: 22,
                    borderRadius: 'var(--radius-md)',
                    border: 0,
                    background: 'transparent',
                    color: 'var(--kp-side-fg-dim)',
                    cursor: 'pointer',
                    flex: 'none',
                  }}
                >
                  <Plus size={15} strokeWidth={2} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  data-testid="spine-new-client-item"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent(EV_OPEN_MATTER_MANAGER));
                  }}
                >
                  {newClientLabel}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="spine-new-group-item"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent(EV_OPEN_NEW_GROUP));
                  }}
                >
                  {t('spine.new-group')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {clientsOpen && (
            <div
              data-testid="spine-client-list"
              style={{
                flex: '1 1 auto',
                minHeight: 0,
                overflowY: 'auto',
                padding: '0 10px var(--kp-space-xs)',
              }}
            >
              {clientSearchVisible && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    height: 30,
                    padding: '0 8px',
                    marginBottom: 6,
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--kp-side-border)',
                    background: 'var(--kp-side-border)',
                    color: 'var(--kp-side-fg-dim)',
                  }}
                >
                  <Search size={13} strokeWidth={2} style={{ flex: 'none' }} />
                  <input
                    ref={clientSearchRef}
                    data-testid="spine-client-search"
                    type="search"
                    value={clientSearchQuery}
                    onChange={(e) => {
                      setClientSearchQuery(e.currentTarget.value);
                    }}
                    onBlur={() => {
                      // Collapse back to the icon when the field is left empty.
                      if (clientSearchQuery.trim().length === 0) setClientSearchExpanded(false);
                    }}
                    placeholder={t('spine.find-client')}
                    aria-label={t('spine.find-client')}
                    style={{
                      width: '100%',
                      minWidth: 0,
                      border: 0,
                      outline: 'none',
                      background: 'transparent',
                      color: 'var(--kp-side-fg)',
                      fontSize: 'var(--kp-font-sm)',
                      fontFamily: 'inherit',
                    }}
                  />
                </label>
              )}
              <button
                type="button"
                data-testid="spine-all-clients-row"
                aria-current={allClientsActive ? 'page' : undefined}
                onClick={() => {
                  const request = issueAllMattersScopeSelection();
                  void requestMatterScopeSelection(request)
                    .then((result) => {
                      if (result.kind === 'refused') return;
                      onAllClientsSelect?.();
                      setClientMapHubId(null);
                      setClientMapHubTab(null);
                      if (!onAllClientsSelect) onTabChange?.('matters');
                    })
                    .catch((error: unknown) => {
                      console.error('[Spine] All-client scope selection failed.', error);
                    });
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  textAlign: 'left',
                  border: 0,
                  cursor: 'pointer',
                  background: allClientsActive
                    ? 'var(--kp-side-active-bg)'
                    : 'transparent',
                  color: 'var(--kp-side-fg)',
                  padding: 'var(--kp-space-xs) var(--kp-space-sm)',
                  borderRadius: 'var(--radius-md)',
                  position: 'relative',
                  marginBottom: 6,
                }}
              >
                {allClientsActive && (
                  <span
                    style={{
                      position: 'absolute',
                      left: 3,
                      top: 8,
                      bottom: 8,
                      width: 3,
                      borderRadius: 3,
                      background: 'var(--kp-side-accent)',
                    }}
                  />
                )}
                <span
                  style={{
                    fontSize: 'var(--kp-font-sm)',
                    fontWeight: 'var(--kp-weight-bold)',
                    color: 'var(--kp-side-fg)',
                    lineHeight: 1.3,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {t('spine.all-clients')}
                </span>
              </button>

              {/* Client groups (feedback line 13): collapsible sections at the
                  top of the list, under "All clients". A client can appear in a
                  group AND the flat list below. */}
              {groups.map((g) => {
                const gCollapsed = collapsedGroupIds.has(g.id);
                const gMembers = membersOf(g.matterIds);
                // Hide a group during a search that matches none of its members
                // (keeps the search result focused), but always show it otherwise
                // — including when empty (it stays deletable).
                if (clientSearchQuery.trim() && gMembers.length === 0) return null;
                const renaming = renamingGroupId === g.id;
                return (
                  <div key={g.id} data-testid={`spine-group-${g.id}`} style={{ marginBottom: 4 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px var(--kp-space-xs) 2px var(--kp-space-sm)',
                      }}
                    >
                      <button
                        type="button"
                        data-testid={`spine-group-toggle-${g.id}`}
                        aria-expanded={!gCollapsed}
                        onClick={() => {
                          setCollapsedGroupIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(g.id)) next.delete(g.id);
                            else next.add(g.id);
                            return next;
                          });
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          flex: 1,
                          minWidth: 0,
                          border: 0,
                          background: 'transparent',
                          cursor: 'pointer',
                          padding: 0,
                          color: 'var(--kp-side-fg-dim)',
                        }}
                      >
                        <ChevronDown
                          size={11}
                          strokeWidth={2.5}
                          style={{
                            transform: gCollapsed ? 'rotate(-90deg)' : undefined,
                            transition: 'transform 0.15s',
                            flex: 'none',
                          }}
                        />
                        {renaming ? (
                          <input
                            data-testid={`spine-group-rename-input-${g.id}`}
                            autoFocus
                            value={renameDraft}
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                            onChange={(e) => {
                              setRenameDraft(e.currentTarget.value);
                            }}
                            onBlur={() => {
                              commitRename(g.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(g.id);
                              if (e.key === 'Escape') {
                                setRenamingGroupId(null);
                                setRenameDraft('');
                              }
                            }}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              border: '1px solid var(--kp-side-border)',
                              borderRadius: 'var(--radius-sm)',
                              background: 'var(--kp-side-border)',
                              color: 'var(--kp-side-fg)',
                              fontSize: 10,
                              fontFamily: 'inherit',
                              padding: '1px 4px',
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 'var(--kp-weight-bold)',
                              letterSpacing: '0.1em',
                              textTransform: 'uppercase',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {g.name}
                          </span>
                        )}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            data-testid={`spine-group-menu-${g.id}`}
                            title={t('matter.group.section-menu')}
                            aria-label={t('matter.group.section-menu')}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 18,
                              height: 18,
                              borderRadius: 'var(--radius-sm)',
                              border: 0,
                              background: 'transparent',
                              color: 'var(--kp-side-fg-faint)',
                              cursor: 'pointer',
                              flex: 'none',
                            }}
                          >
                            <MoreVertical size={13} strokeWidth={2} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            data-testid={`spine-group-rename-${g.id}`}
                            onClick={() => {
                              setRenamingGroupId(g.id);
                              setRenameDraft(g.name);
                            }}
                          >
                            <Pencil size={13} aria-hidden="true" />
                            {t('matter.group.rename')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            data-testid={`spine-group-delete-${g.id}`}
                            onClick={() => {
                              deleteGroup(g.id);
                            }}
                          >
                            <Trash2 size={13} aria-hidden="true" />
                            {t('matter.group.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {!gCollapsed && (
                      <div style={{ paddingLeft: 8 }}>
                        {gMembers.length === 0 ? (
                          <div
                            data-testid={`spine-group-empty-${g.id}`}
                            style={{
                              padding: 'var(--kp-space-xs) var(--kp-space-sm)',
                              color: 'var(--kp-side-fg-faint)',
                              fontSize: 'var(--kp-font-xs)',
                            }}
                          >
                            {t('matter.group.empty')}
                          </div>
                        ) : (
                          gMembers.map((m) => renderClientRow(m, g.id))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredMatters.map((m) => renderClientRow(m))}
              {clientSearchQuery.trim() && filteredMatters.length === 0 && (
                <div
                  data-testid="spine-client-search-empty"
                  style={{
                    padding: 'var(--kp-space-xs) var(--kp-space-sm)',
                    color: 'var(--kp-side-fg-faint)',
                    fontSize: 'var(--kp-font-xs)',
                    fontWeight: 'var(--kp-weight-medium)',
                  }}
                >
                  {t('spine.no-clients-found')}
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0 }} />
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            borderTop: '1px solid var(--kp-side-border)',
            flex: 'none',
          }}
        >
          <AccountIdentity
            onOpen={() => {
              window.dispatchEvent(new CustomEvent(EV_OPEN_ACCOUNT));
            }}
          />
          <button
            type="button"
            onClick={() => onCollapsedChange?.(true)}
            title={t('layout.sidebar.collapse-aria')}
            aria-label={t('layout.sidebar.collapse-aria')}
            style={{
              border: 0,
              borderLeft: '1px solid var(--kp-side-border)',
              background: 'transparent',
              color: 'var(--kp-side-fg-faint)',
              cursor: 'pointer',
              padding: '0 var(--kp-space-sm)',
              display: 'flex',
              alignItems: 'center',
              flex: 'none',
            }}
          >
            <ChevronLeft size={16} />
          </button>
        </div>
      </nav>
    </div>
  );
}
