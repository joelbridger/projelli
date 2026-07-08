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

import { Fragment, useMemo, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreVertical, Plus, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button, IconButton, Eyebrow, RailShellActionMenu, RailShellHeader } from '@/ui/kp';
import { DropdownMenuItem } from '@/ui/dropdown-menu';
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

function RailItem({
  session,
  active,
  onSelect,
}: {
  session: RecentAskSession;
  active: boolean;
  onSelect: (chatId: string) => void;
}) {
  const label = session.label.length > 60 ? `${session.label.slice(0, 60)}…` : session.label;
  const title = session.dateLabel ? `${session.label} · ${session.dateLabel}` : session.label;
  return (
    <button
      type="button"
      data-testid="rail-conversation-item"
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'true' : undefined}
      title={title}
      onClick={() => { onSelect(session.chatId); }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid transparent',
        background: active ? 'var(--kp-accent-soft)' : 'transparent',
        color: active ? 'var(--kp-navy)' : 'var(--color-foreground)',
        fontSize: 'var(--kp-rail-row-title-font-size)',
        fontWeight: active ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-medium)',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e: MouseEvent<HTMLButtonElement>) => {
        if (!active) e.currentTarget.style.background = 'var(--kp-accent-softer)';
      }}
      onMouseLeave={(e: MouseEvent<HTMLButtonElement>) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{label}</span>
      {session.dateLabel && (
        <span style={{ fontSize: 'var(--kp-rail-row-meta-font-size)', color: 'var(--kp-text-faint)', fontWeight: 'var(--kp-weight-regular)', flex: 'none' }}>
          {session.dateLabel}
        </span>
      )}
    </button>
  );
}

export function ConversationsRail({
  groups,
  activeChatId,
  onSelect,
  onNewQuestion,
  collapsed,
  onToggleCollapsed,
}: ConversationsRailProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
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
      <RailShellHeader
        title={t('ask.conversations.title')}
        search={{
          value: query,
          onChange: setQuery,
          onClear: () => { setQuery(''); },
          placeholder: t('ask.conversations.search-placeholder'),
          label: t('ask.conversations.search-placeholder'),
          testId: 'rail-conversation-search',
          toggleTestId: 'rail-search-toggle',
        }}
        createAction={(
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
              fontSize: 'var(--kp-font-sm)',
              fontWeight: 700,
            }}
          >
            {t('ask.conversations.new')}
          </Button>
        )}
        menuAction={(
          <RailShellActionMenu icon={MoreVertical} label={t('ask.conversations.more-actions')}>
            <DropdownMenuItem onSelect={onNewQuestion}>
              {t('ask.conversations.new-question')}
            </DropdownMenuItem>
          </RailShellActionMenu>
        )}
        collapseAction={(
          <IconButton
            icon={PanelLeftClose}
            label={t('ask.conversations.hide')}
            size="sm"
            variant="ghost"
            onClick={onToggleCollapsed}
            data-testid="rail-toggle"
          />
        )}
      />

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
