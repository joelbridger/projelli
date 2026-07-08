import '@/i18n';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConversationsRail } from './ConversationsRail';

describe('ConversationsRail', () => {
  it('renames a conversation from the row pencil', () => {
    const onRename = vi.fn();
    render(
      <ConversationsRail
        groups={[
          {
            key: 'recent',
            title: null,
            items: [{ chatId: 'ask-1', label: 'What is the ILIT issue?', dateLabel: 'Jun 24 10:00 AM' }],
          },
        ]}
        activeChatId="ask-1"
        onSelect={vi.fn()}
        onNewQuestion={vi.fn()}
        onRename={onRename}
        collapsed={false}
        onToggleCollapsed={vi.fn()}
      />,
    );

    expect(screen.getByTestId('conversations-rail').style.width).toBe('var(--kp-rail-width)');

    fireEvent.click(screen.getByTestId('rail-conversation-rename'));
    fireEvent.change(screen.getByTestId('rail-conversation-rename-input'), { target: { value: 'ILIT planning' } });
    fireEvent.keyDown(screen.getByTestId('rail-conversation-rename-input'), { key: 'Enter' });

    expect(onRename).toHaveBeenCalledWith('ask-1', 'ILIT planning');
  });
});
