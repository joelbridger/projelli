/**
 * Spine — the matter-centric navy "Spine" nav, brand-matched to lantern.com.
 * The 3-tab IA: Client Map · Ask · Workflows. Documents, Email, Activity Log,
 * Privacy Center, and Settings are reached via the gear menu, the Ask source
 * filter, and Client Map quick actions — they stay routable content surfaces,
 * just not rail tabs. The binder spine of the case file.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  ListChecks,
  Map as MapIcon,
  Plus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  type LucideIcon,
} from 'lucide-react';
import {
  useActiveMatters,
  useActiveMatterId,
  useMatterStore,
} from '@/platform/matter/matterStore';
import { AccountIdentity } from './AccountIdentity';
import { matterLabel } from '@/platform/rag/matterResolver';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { IconButton } from '@/ui/kp';
import {
  EV_OPEN_ACCOUNT,
  EV_OPEN_MATTER_MANAGER,
  EV_MATTER_LAUNCH,
} from '@/config/identity';

type SpineTab =
  | 'matters'
  | 'files'
  | 'search'
  | 'workflows'
  | 'audit'
  | 'email'
  | 'settings'
  | 'privacy';

interface SpineProps {
  fileTreeContent?: React.ReactNode;
  searchContent?: React.ReactNode;
  workflowContent?: React.ReactNode;
  aiAssistantContent?: React.ReactNode;
  auditContent?: React.ReactNode;
  trashContent?: React.ReactNode;
  mattersContent?: React.ReactNode;
  emailContent?: React.ReactNode | undefined;
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
  fileTreeContent,
  searchContent,
  workflowContent,
  auditContent,
  mattersContent,
  emailContent,
  settingsContent,
  privacyContent,
  activeTab = 'matters',
  onTabChange,
  onAllClientsSelect,
  allClientsSelected,
  collapsed = false,
  onCollapsedChange,
}: SpineProps) {
  const { t } = useTranslation();
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
  const setActiveMatter = useMatterStore((s) => s.setActiveMatter);
  const setClientMapHubId = useMatterStore((s) => s.setClientMapHubId);
  const setClientMapHubTab = useMatterStore((s) => s.setClientMapHubTab);
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

  // The 3-tab IA. The internal ids are KEPT (matters/search/workflows) so the
  // surface router + testids are unchanged; only the labels and placement move.
  // Documents/Email/Activity Log/Privacy Center/Settings are reached via the
  // gear menu, Ask source filter, and Client Map quick actions — they stay
  // routable content ids (see `content` below), just not rail tabs.
  const nav: { id: SpineTab; label: string; Icon: LucideIcon }[] = [
    { id: 'matters', label: t('spine.nav.client-map'), Icon: MapIcon },
    { id: 'search', label: t('spine.nav.ask'), Icon: Sparkles },
    { id: 'workflows', label: t('spine.nav.workflows'), Icon: ListChecks },
  ];

  const content: Record<SpineTab, React.ReactNode> = {
    matters: mattersContent,
    files: fileTreeContent,
    search: searchContent,
    email: emailContent,
    workflows: workflowContent,
    audit: auditContent,
    privacy: privacyContent,
    settings: settingsContent,
  };

  const active =
    (activeTab as SpineTab) in content ? (activeTab as SpineTab) : 'matters';
  const allClientsActive =
    allClientsSelected ?? (active === 'matters' && activeMatterId === null);

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
        {nav.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            aria-current={active === id && !(id === 'matters' && allClientsActive) ? 'page' : undefined}
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
        ))}
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
          {nav.map(({ id, label, Icon }) => {
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
            flex: 'none',
            minHeight: 0,
            borderTop: '1px solid var(--kp-side-border)',
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
            <button
              type="button"
              data-testid="spine-new-client"
              title={newClientLabel}
              aria-label={newClientLabel}
              onClick={() => {
                window.dispatchEvent(new CustomEvent(EV_OPEN_MATTER_MANAGER));
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
              <Plus size={15} strokeWidth={2} />
            </button>
          </div>
          {clientsOpen && (
            <div
              style={{
                maxHeight: 280,
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
                  if (onAllClientsSelect) {
                    onAllClientsSelect();
                  }
                  setActiveMatter(null);
                  setClientMapHubId(null);
                  setClientMapHubTab(null);
                  if (!onAllClientsSelect) {
                    onTabChange?.('matters');
                  }
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
              {filteredMatters.map((m) => {
                const on = m.id === activeMatterId && !allClientsActive;
                const fullLabel = matterLabel(m);
                const displayLabel = m.client.trim() || fullLabel;
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`spine-client-row-${m.id}`}
                    title={fullLabel}
                    onClick={() => {
                      // Rail client clicks always mean "open this client's map",
                      // never "restore wherever this client was last".
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
                      background: on
                        ? 'var(--kp-side-active-bg)'
                        : 'transparent',
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
              })}
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
