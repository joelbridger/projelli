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

import { Fragment } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { Plus, MessageSquare, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button, IconButton, Eyebrow } from '@/ui/kp';
import type { RecentAskSession } from './askHelpers';

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

const RAIL_WIDTH = 264;
const RAIL_COLLAPSED_WIDTH = 52;

const railBase: CSSProperties = {
  flexShrink: 0,
  borderRight: '1px solid var(--color-border)',
  background: 'var(--color-secondary)',
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
  return (
    <button
      type="button"
      data-testid="rail-conversation-item"
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'true' : undefined}
      title={session.label}
      onClick={() => { onSelect(session.chatId); }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--kp-space-xs)',
        padding: 'var(--kp-space-xs) var(--kp-space-sm)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid transparent',
        background: active ? 'rgba(10, 37, 64, 0.09)' : 'transparent',
        color: active ? 'var(--kp-navy)' : 'var(--color-foreground)',
        fontSize: 'var(--kp-font-xs)',
        fontWeight: active ? 'var(--kp-weight-medium)' : 'var(--kp-weight-regular)',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e: MouseEvent<HTMLButtonElement>) => {
        if (!active) e.currentTarget.style.background = 'rgba(10, 37, 64, 0.05)';
      }}
      onMouseLeave={(e: MouseEvent<HTMLButtonElement>) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <MessageSquare
        size={13}
        strokeWidth={1.75}
        style={{ color: 'var(--kp-navy)', flex: 'none', opacity: active ? 0.8 : 0.5 }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {session.dateLabel && (
          <span style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)', marginTop: 1 }}>
            {session.dateLabel}
          </span>
        )}
      </span>
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
  const hasAny = groups.some((g) => g.items.length > 0);

  if (collapsed) {
    return (
      <nav
        data-testid="conversations-rail"
        data-collapsed="true"
        aria-label="Conversations"
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
          label="Show conversations"
          size="sm"
          variant="ghost"
          onClick={onToggleCollapsed}
          data-testid="rail-toggle"
        />
        <IconButton
          icon={Plus}
          label="New question"
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
      aria-label="Conversations"
      style={{ ...railBase, width: RAIL_WIDTH }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--kp-space-xs)',
          padding: 'var(--kp-space-sm) var(--kp-space-sm) var(--kp-space-2xs)',
        }}
      >
        <Eyebrow style={{ margin: 0 }}>Conversations</Eyebrow>
        <IconButton
          icon={PanelLeftClose}
          label="Hide conversations"
          size="xs"
          variant="ghost"
          onClick={onToggleCollapsed}
          data-testid="rail-toggle"
        />
      </div>

      <div style={{ padding: `0 var(--kp-space-sm) var(--kp-space-xs)` }}>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={Plus}
          onClick={onNewQuestion}
          fullWidth
          data-testid="rail-new-question"
          style={{ justifyContent: 'flex-start' }}
        >
          New question
        </Button>
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
            {/* eslint-disable keepance-i18n/no-hardcoded-string */}
            Your conversations will appear here.
            {/* eslint-enable keepance-i18n/no-hardcoded-string */}
          </p>
        ) : (
          groups.map((group) =>
            group.items.length > 0 ? (
              <Fragment key={group.key}>
                <div style={{ marginTop: 'var(--kp-space-sm)' }}>
                  {group.title && (
                    <Eyebrow style={{ marginBottom: 'var(--kp-space-2xs)' }}>{group.title}</Eyebrow>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
