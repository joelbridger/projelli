/**
 * ConversationsRail — the persistent, always-visible left rail of saved Ask
 * conversations (the ChatGPT-style history list).
 *
 * Purely presentational: it renders the session groups it is handed and reports
 * clicks back up. All the save/switch machinery (aiChatStore sessions,
 * handleNewAsk, handleLoadSession) lives in useAsk — the rail only surfaces it.
 *
 * - "New question" sits at the top and always starts a fresh thread.
 * - Conversations are grouped (e.g. this client's threads vs. everything else),
 *   with the active thread highlighted.
 * - Collapsible to a thin strip when horizontal space is tight; the collapsed
 *   preference is owned by the parent so it can persist it.
 *
 * Light theme, accessible (a labelled <nav>, icon-only buttons carry labels).
 */

import { Fragment, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, PanelLeftClose, PanelLeftOpen, Search, Pencil } from 'lucide-react';
import { Button, IconButton, Eyebrow, SearchField } from '@/ui/kp';
import type { RecentAskSession } from './askHelpers';
// Single source of truth for the rail widths (shared with the Ask responsive
// breakpoints so the two never drift — QA-6).
import { RAIL_WIDTH, RAIL_COLLAPSED_WIDTH } from './askResponsive';

export interface RailGroup {
  /** Stable key for React. */
  key: string;
  /** Section heading; null renders an ungrouped flat list. */
  title: string | null;
  items: RecentAskSession[];
}

export interface ConversationsRailProps {
  groups: RailGroup[];
  activeChatId: string;
  onSelect: (chatId: string) => void;
  onNewQuestion: () => void;
  onRename: (chatId: string, title: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const railBase: CSSProperties = {
  flexShrink: 0,
  borderRight: '1px solid var(--kp-divider)',
  background: 'var(--color-background)',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

function eventStartedInNestedControl(currentTarget: HTMLElement, target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest('button,input,textarea,select,[role="button"],[role="textbox"],[role="menuitem"]');
  return Boolean(interactive && interactive !== currentTarget);
}

function RailItem({
  session,
  active,
  onSelect,
  onRename,
}: {
  session: RecentAskSession;
  active: boolean;
  onSelect: (chatId: string) => void;
  onRename: (chatId: string, title: string) => void;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(session.label);
  const skipRenameBlurRef = useRef(false);
  const label = session.label.length > 60 ? `${session.label.slice(0, 60)}…` : session.label;
  const title = session.dateLabel ? `${session.label} · ${session.dateLabel}` : session.label;
  const saveRename = () => {
    onRename(session.chatId, draft);
    setRenaming(false);
  };
  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (eventStartedInNestedControl(event.currentTarget, event.target)) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(session.chatId);
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="rail-conversation-item"
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'true' : undefined}
      aria-label={title}
      title={title}
      onClick={(event: MouseEvent<HTMLDivElement>) => {
        if (eventStartedInNestedControl(event.currentTarget, event.target)) return;
        onSelect(session.chatId);
      }}
      onKeyDown={handleRowKeyDown}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid transparent',
        background: active ? 'var(--kp-accent-soft)' : 'transparent',
        color: active ? 'var(--kp-navy)' : 'var(--color-foreground)',
        fontSize: '13px',
        fontWeight: active ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-medium)',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e: MouseEvent<HTMLDivElement>) => {
        if (!active) e.currentTarget.style.background = 'var(--kp-accent-softer)';
      }}
      onMouseLeave={(e: MouseEvent<HTMLDivElement>) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      {renaming ? (
        <input
          data-testid="rail-conversation-rename-input"
          aria-label={t('ask.conversations.rename')}
          autoFocus
          value={draft}
          onChange={(event) => { setDraft(event.target.value); }}
          onBlur={() => {
            if (skipRenameBlurRef.current) {
              skipRenameBlurRef.current = false;
              return;
            }
            saveRename();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') saveRename();
            if (event.key === 'Escape') {
              skipRenameBlurRef.current = true;
              setDraft(session.label);
              setRenaming(false);
            }
          }}
          style={{
            minWidth: 0,
            flex: 1,
            height: 24,
            border: '1px solid var(--kp-divider)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 6px',
            fontSize: '12px',
          }}
        />
      ) : (
        <>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{label}</span>
          {session.dateLabel && (
            <span style={{ fontSize: '11px', color: 'var(--kp-text-faint)', fontWeight: 'var(--kp-weight-regular)', flex: 'none' }}>
              {session.dateLabel}
            </span>
          )}
          <button
            type="button"
            data-testid="rail-conversation-rename"
            aria-label={t('ask.conversations.rename')}
            title={t('ask.conversations.rename')}
            onClick={() => {
              skipRenameBlurRef.current = false;
              setDraft(session.label);
              setRenaming(true);
            }}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-muted-foreground)', cursor: 'pointer', flex: 'none' }}
          >
            <Pencil aria-hidden="true" style={{ width: 12, height: 12 }} />
          </button>
        </>
      )}
    </div>
  );
}

export function ConversationsRail({
  groups,
  activeChatId,
  onSelect,
  onNewQuestion,
  onRename,
  collapsed,
  onToggleCollapsed,
}: ConversationsRailProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return groups;
    return groups.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLocaleLowerCase().includes(normalizedQuery)),
    }));
  }, [groups, normalizedQuery]);
  const hasAny = groups.some((g) => g.items.length > 0);
  const hasFiltered = filteredGroups.some((g) => g.items.length > 0);
  const visibleGroupCount = filteredGroups.filter((g) => g.items.length > 0).length;
  const showSearchField = searchOpen || query.trim().length > 0;

  if (collapsed) {
    return (
      <nav
        data-testid="conversations-rail"
        data-collapsed="true"
        aria-label={t('ask.conversations.title')}
        style={{
          ...railBase,
          width: RAIL_COLLAPSED_WIDTH,
          alignItems: 'center',
          gap: 'var(--kp-space-xs)',
          padding: 'var(--kp-space-sm) 0',
        }}
      >
        <IconButton
          icon={PanelLeftOpen}
          label={t('ask.conversations.show')}
          size="sm"
          variant="ghost"
          onClick={onToggleCollapsed}
          data-testid="rail-toggle"
        />
        <IconButton
          icon={Plus}
          label={t('ask.conversations.new-question')}
          size="sm"
          variant="secondary"
          onClick={onNewQuestion}
          data-testid="rail-new-question"
        />
      </nav>
    );
  }

  return (
    <nav
      data-testid="conversations-rail"
      data-collapsed="false"
      aria-label={t('ask.conversations.title')}
      style={{ ...railBase, width: RAIL_WIDTH }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          padding: 'var(--kp-space-2xs) var(--kp-space-sm) 0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconButton
            icon={Search}
            label={t('ask.conversations.search-placeholder')}
            size="xs"
            variant={showSearchField ? 'secondary' : 'ghost'}
            onClick={() => { setSearchOpen((open) => !open); }}
            data-testid="rail-search-toggle"
          />
          <Button
            variant="ghost"
            size="sm"
            iconLeft={Plus}
            onClick={onNewQuestion}
            data-testid="rail-new-question"
            style={{
              height: 30,
              padding: '0 8px',
              borderRadius: 8,
              fontSize: '13px',
              fontWeight: 700,
            }}
          >
            {t('ask.conversations.new')}
          </Button>
        </div>
        <IconButton
          icon={PanelLeftClose}
          label={t('ask.conversations.hide')}
          size="xs"
          variant="ghost"
          onClick={onToggleCollapsed}
          data-testid="rail-toggle"
        />
      </div>

      <div style={{ padding: `0 var(--kp-space-sm) var(--kp-space-xs)` }}>
        {showSearchField && (
          <SearchField
            icon={Search}
            value={query}
            onChange={setQuery}
            placeholder={t('ask.conversations.search-placeholder')}
            aria-label={t('ask.conversations.search-placeholder')}
            data-testid="rail-conversation-search"
            size="sm"
            style={{ marginTop: 8, width: '100%' }}
          />
        )}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: `0 var(--kp-space-sm) var(--kp-space-sm)`,
        }}
      >
        {!hasAny ? (
          <p
            style={{
              margin: 'var(--kp-space-sm) var(--kp-space-2xs)',
              fontSize: 'var(--kp-font-xs)',
              color: 'var(--color-muted-foreground)',
              lineHeight: 1.5,
            }}
          >
            {t('ask.conversations.empty')}
          </p>
        ) : !hasFiltered ? (
          <p
            data-testid="rail-conversation-search-empty"
            style={{
              margin: 'var(--kp-space-sm) var(--kp-space-2xs)',
              fontSize: 'var(--kp-font-xs)',
              color: 'var(--color-muted-foreground)',
              lineHeight: 1.5,
            }}
          >
            {t('ask.conversations.no-results')}
          </p>
        ) : (
          filteredGroups.map((group) =>
            group.items.length > 0 ? (
              <Fragment key={group.key}>
                <div style={{ marginTop: 'var(--kp-space-sm)' }}>
                  {group.title && visibleGroupCount > 1 && (
                    <Eyebrow style={{ marginBottom: 'var(--kp-space-2xs)' }}>{group.title}</Eyebrow>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {group.items.map((item) => (
                      <RailItem
                        key={item.chatId}
                        session={item}
                        active={item.chatId === activeChatId}
                        onSelect={onSelect}
                        onRename={onRename}
                      />
                    ))}
                  </div>
                </div>
              </Fragment>
            ) : null,
          )
        )}
      </div>
    </nav>
  );
}
